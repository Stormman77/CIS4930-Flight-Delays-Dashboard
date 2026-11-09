import { state, setState, toggled } from "../state.js";
import {
  app, TRANSITION_MS, transitionEase, metric, metricColor, metricTitle, metricShort, metricDomain, metricAxisLabel, axisTitle,
  SMALL_SAMPLE_COLOR, isSmallSample, fmtInt, fmtPct, showTip, hideTip, tipRow, emptyNote,
} from "../shared.js";

const MAX_BAR = 24;

function barPath(width, height) {
  const r = Math.min(4, width, height / 2);
  return `M0,0H${width - r}Q${width},0 ${width},${r}V${height - r}Q${width},${height} ${width - r},${height}H0Z`;
}

export function createCarriers() {
  const W = 620, H = 340;
  const margin = { top: 4, right: 52, bottom: 38, left: 128 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top - margin.bottom;

  const names = new Map(app.meta.carriers.map((c) => [c.code, c.name]));
  const x = d3.scaleLinear().range([0, iW]);
  const y = d3.scaleBand().range([0, iH]).padding(0.24);

  const svg = d3.select("#carriers-chart").append("svg").attr("viewBox", `0 0 ${W} ${H}`);
  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const grid = plot.append("g").attr("class", "grid").attr("transform", `translate(0,${iH})`);
  const xAxis = plot.append("g").attr("class", "axis").attr("transform", `translate(0,${iH})`);
  const xTitle = axisTitle(plot, iW / 2, iH + 33);
  const rowsLayer = plot.append("g");
  const note = emptyNote(plot, iW / 2, iH / 2);

  function tipHtml(d) {
    return `<strong>${names.get(d.carrier)}</strong> (${d.carrier})
      ${tipRow(metricShort(), fmtPct(metric(d)))}
      ${tipRow("Flights", fmtInt(d.flights))}
      ${tipRow("Cancelled", fmtInt(d.cancelled))}`;
  }

  function render(summary) {
    const rows = summary.carriers
      .map((d) => ({ ...d, value: metric(d) }))
      .sort((a, b) => d3.descending(a.value ?? -1, b.value ?? -1));

    const values = rows.filter((d) => !isSmallSample(d)).map((d) => d.value).filter((v) => v !== null);
    x.domain(metricDomain(values));
    // Bars keep one thickness however many carriers remain.
    const slot = iH / app.meta.carriers.length;
    y.domain(rows.map((d) => d.carrier)).range([0, slot * rows.length]);
    const barHeight = Math.min(MAX_BAR, y.bandwidth());
    const barY = (y.bandwidth() - barHeight) / 2;

    d3.select("#carriers-title").text(`${metricTitle()}, by carrier`);
    xTitle.text(metricAxisLabel());

    const t = () => d3.transition().duration(TRANSITION_MS).ease(transitionEase);
    grid.transition(t()).call(d3.axisBottom(x).ticks(5).tickSize(-iH).tickFormat(""));
    xAxis.transition(t()).call(d3.axisBottom(x).ticks(5).tickFormat((v) => `${v}%`).tickSizeOuter(0));

    const color = metricColor();
    const fill = (d) => (isSmallSample(d) ? SMALL_SAMPLE_COLOR : color);
    const barWidth = (d) => x(Math.min(d.value ?? 0, x.domain()[1]));

    const groups = rowsLayer.selectAll("g.carrier-row").data(rows, (d) => d.carrier).join((enter) => {
      const g = enter.append("g").attr("class", "carrier-row")
        .attr("transform", (d) => `translate(0,${y(d.carrier)})`).attr("opacity", 0);
      g.append("rect").attr("class", "hit").attr("x", -margin.left).attr("width", W).attr("fill", "transparent");
      g.append("text").attr("class", "carrier-name").attr("x", -8).text((d) => names.get(d.carrier));
      g.append("path").attr("class", "bar").attr("d", barPath(0, barHeight)).attr("fill", fill);
      g.append("text").attr("class", "carrier-value");
      return g;
    });

    groups.classed("is-selected", (d) => state.carriers.has(d.carrier))
      .on("pointermove", (event, d) => showTip(event, tipHtml(d)))
      .on("pointerleave", hideTip)
      .on("click", (event, d) => setState({ carriers: toggled(state.carriers, d.carrier, event.ctrlKey || event.metaKey) }));

    groups.transition(t())
      .attr("transform", (d) => `translate(0,${y(d.carrier)})`)
      .attr("opacity", (d) => (state.carriers.size && !state.carriers.has(d.carrier) ? 0.3 : 1));

    groups.select(".hit").attr("height", y.bandwidth());
    groups.select(".carrier-name").attr("y", y.bandwidth() / 2).attr("dy", "0.35em");
    groups.select(".bar").attr("transform", `translate(0,${barY})`)
      .transition(t()).attr("d", (d) => barPath(barWidth(d), barHeight)).attr("fill", fill);
    groups.select(".carrier-value").attr("y", y.bandwidth() / 2).attr("dy", "0.35em")
      .text((d) => fmtPct(d.value))
      .transition(t()).attr("x", (d) => barWidth(d) + 6);

    note.style("display", rows.length ? "none" : null);
  }

  return { render };
}
