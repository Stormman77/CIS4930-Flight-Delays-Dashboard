import { state, setState, toggled } from "../state.js";
import {
  app, TRANSITION_MS, transitionEase, metric, metricColor, metricTitle, metricShort, metricDomain,
  MIN_FLIGHTS, SMALL_SAMPLE_COLOR, isSmallSample, fmtInt, fmtPct, showTip, hideTip, tipRow, emptyNote,
} from "../shared.js";

const MAX_RADIUS = 18;
const MIN_RADIUS = 2.5;
const HIT_RADIUS = 7;

function rampFor(color) {
  const tint = d3.interpolateLab("#ffffff", color)(0.28);
  return d3.interpolateLab(tint, d3.color(color).darker(1.1).formatHex());
}

export function createMap(geo) {
  const W = 640, H = 340;

  const states = topojson.feature(geo, geo.objects.states);
  states.features = states.features.filter((f) => +f.id <= 56); // drop territories
  const projection = d3.geoAlbersUsa().fitExtent([[6, 6], [W - 6, H - 6]], states);
  const path = d3.geoPath(projection);

  const info = new Map(app.meta.airports.map((a) => [a.origin, a]));
  const positions = new Map();
  app.meta.airports.filter((a) => a.mappable).forEach((a) => {
    const point = projection([a.lon, a.lat]);
    if (point) positions.set(a.origin, point);
  });

  const svg = d3.select("#map-chart").append("svg").attr("viewBox", `0 0 ${W} ${H}`);
  const world = svg.append("g");
  world.append("g").selectAll("path").data(states.features).join("path").attr("class", "state").attr("d", path);
  const bubbles = world.append("g");
  const note = emptyNote(svg, W / 2, H / 2);

  const radius = d3.scaleSqrt().range([0, MAX_RADIUS]);
  const dotRadius = (d) => Math.max(MIN_RADIUS, radius(d.flights));
  let view = d3.zoomIdentity;
  let rows = [];

  function strokeWidth(d) {
    return (state.airports.has(d.origin) ? 2 : 0.8) / view.k;
  }

  function applyZoomToBubbles() {
    bubbles.selectAll(".dot").attr("r", (d) => dotRadius(d) / view.k).attr("stroke-width", strokeWidth);
    bubbles.selectAll(".hit").attr("r", (d) => Math.max(dotRadius(d), HIT_RADIUS) / view.k);
  }

  const zoom = d3.zoom().scaleExtent([1, 12]).translateExtent([[0, 0], [W, H]]).on("zoom", ({ transform }) => {
    view = transform;
    world.attr("transform", transform);
    applyZoomToBubbles();
  });

  const brush = d3.brush().extent([[0, 0], [W, H]]).on("end", ({ selection, sourceEvent }) => {
    if (!sourceEvent || !selection) return;
    const [[x0, y0], [x1, y1]] = selection;
    const inside = rows
      .filter((d) => {
        const [px, py] = view.apply(positions.get(d.origin));
        return px >= x0 && px <= x1 && py >= y0 && py <= y1;
      })
      .map((d) => d.origin);
    brushLayer.call(brush.move, null);
    if (inside.length) setState({ airports: new Set(inside) });
  });
  const brushLayer = svg.append("g").attr("class", "brush").call(brush).style("display", "none");

  const zoomButton = d3.select("#map-mode-zoom");
  const brushButton = d3.select("#map-mode-brush");

  function setMode(mode) {
    const zooming = mode === "zoom";
    if (zooming) svg.call(zoom);
    else svg.on(".zoom", null);
    brushLayer.style("display", zooming ? "none" : null);
    zoomButton.attr("aria-pressed", String(zooming));
    brushButton.attr("aria-pressed", String(!zooming));
  }

  zoomButton.on("click", () => setMode("zoom"));
  brushButton.on("click", () => setMode("brush"));
  d3.select("#map-reset").on("click", () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));
  setMode("zoom");

  function tipHtml(d) {
    const a = info.get(d.origin);
    const value = metric(d);
    return `<strong>${d.origin}</strong> · ${a.city}<br/>${a.name}
      ${tipRow(metricShort(), isSmallSample(d) ? `${fmtPct(value)} (few flights)` : fmtPct(value))}
      ${tipRow("Flights", fmtInt(d.flights))}
      ${tipRow("Cancelled", fmtInt(d.cancelled))}`;
  }

  function renderLegend(ramp, domain) {
    const stops = d3.range(0, 1.01, 0.25).map((t) => ramp(t)).join(",");
    d3.select("#map-legend").html(`
      <span>${domain[0]}%</span>
      <span class="ramp" style="background:linear-gradient(to right,${stops})"></span>
      <span>${domain[1]}%${domain[1] < 100 ? "+" : ""}</span>
      <span class="swatch" style="background:${SMALL_SAMPLE_COLOR};margin-left:8px"></span><span>Fewer than ${MIN_FLIGHTS} flights</span>
      <span style="margin-left:8px">Bubble area = flights in selection</span>`);
  }

  function render(summary) {
    rows = summary.airports.filter((d) => positions.has(d.origin)).sort((a, b) => d3.descending(a.flights, b.flights));
    radius.domain([0, d3.max(rows, (d) => d.flights) || 1]);

    const values = rows.filter((d) => !isSmallSample(d)).map(metric).filter((v) => v !== null);
    const domain = metricDomain(values);
    const ramp = rampFor(metricColor());
    const color = d3.scaleSequential(ramp).domain(domain).clamp(true);
    const fill = (d) => {
      const value = metric(d);
      return isSmallSample(d) || value === null ? SMALL_SAMPLE_COLOR : color(value);
    };

    d3.select("#map-title").text(metricTitle());
    renderLegend(ramp, domain);

    const groups = bubbles.selectAll("g.airport").data(rows, (d) => d.origin).join((enter) => {
      const g = enter.append("g").attr("class", "airport")
        .attr("transform", (d) => `translate(${positions.get(d.origin)})`);
      g.append("circle").attr("class", "dot").attr("r", 0).attr("fill", fill);
      g.append("circle").attr("class", "hit").attr("fill", "transparent");
      return g;
    }).order();

    groups.classed("is-selected", (d) => state.airports.has(d.origin))
      .attr("opacity", (d) => (state.airports.size && !state.airports.has(d.origin) ? 0.3 : 1))
      .on("pointermove", (event, d) => showTip(event, tipHtml(d)))
      .on("pointerleave", hideTip)
      .on("click", (event, d) => setState({ airports: toggled(state.airports, d.origin, event.ctrlKey || event.metaKey) }));

    groups.select(".dot").attr("stroke-width", strokeWidth)
      .transition().duration(TRANSITION_MS).ease(transitionEase)
      .attr("r", (d) => dotRadius(d) / view.k).attr("fill", fill);
    groups.select(".hit").attr("r", (d) => Math.max(dotRadius(d), HIT_RADIUS) / view.k);

    note.style("display", rows.length ? "none" : null);
  }

  return { render };
}
