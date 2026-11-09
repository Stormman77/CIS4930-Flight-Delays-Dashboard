import { state, setState } from "../state.js";
import {
  app, TRANSITION_MS, transitionEase, metric, metricColor, metricTitle, metricShort, metricDomain, metricAxisLabel, axisTitle,
  fmtInt, fmtPct, showTip, hideTip, tipRow, emptyNote, drawGrid, isSmallSample,
} from "../shared.js";

const HALF_DAY = 12 * 3600 * 1000;

export function createTimeline() {
  const W = 620, H = 252;
  const margin = { top: 14, right: 14, bottom: 40, left: 54 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top - margin.bottom;

  const parse = d3.timeParse("%Y-%m-%d");
  const toKey = d3.timeFormat("%Y-%m-%d");
  const dayLabel = d3.timeFormat("%a, %b %-d");
  const first = parse(app.meta.date_range.start);
  const last = parse(app.meta.date_range.end);

  // Each day owns the band from 12 hours before to 12 hours after its midnight.
  const x = d3.scaleTime()
    .domain([new Date(+first - HALF_DAY), new Date(+last + HALF_DAY)])
    .range([0, iW]);
  const y = d3.scaleLinear().range([iH, 0]);

  const svg = d3.select("#timeline-chart").append("svg").attr("viewBox", `0 0 ${W} ${H}`);
  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const grid = plot.append("g").attr("class", "grid");
  plot.append("g").attr("class", "axis").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(d3.timeDay.every(4)).tickFormat(d3.timeFormat("%b %-d")).tickSizeOuter(0));
  const yAxis = plot.append("g").attr("class", "axis");
  axisTitle(plot, iW / 2, iH + 34, { text: "Flight date (2026)" });
  const yTitle = axisTitle(plot, -42, iH / 2, { rotate: true });
  const areaPath = plot.append("path").attr("fill-opacity", 0.1);
  const linePath = plot.append("path").attr("fill", "none").attr("stroke-width", 2)
    .attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
  const peak = plot.append("text").attr("class", "peak-label");

  const crosshair = plot.append("g").attr("class", "crosshair").style("display", "none");
  const crossLine = crosshair.append("line").attr("y1", 0).attr("y2", iH);
  const crossDot = crosshair.append("circle").attr("r", 4.5);

  const note = emptyNote(plot, iW / 2, iH / 2);

  const line = d3.line().defined((d) => d.value !== null).x((d) => x(d.day)).y((d) => y(d.value)).curve(d3.curveMonotoneX);
  const area = d3.area().defined((d) => d.value !== null).x((d) => x(d.day)).y0(iH).y1((d) => y(d.value)).curve(d3.curveMonotoneX);

  let rows = [];

  function snap([x0, x1]) {
    const clamp = (d) => new Date(Math.min(+last, Math.max(+first, +d3.timeDay.round(x.invert(d)))));
    return [clamp(x0), clamp(x1)];
  }

  const brush = d3.brushX().extent([[0, 0], [iW, iH]]).on("brush end", onBrush);
  const brushLayer = plot.append("g").attr("class", "brush").call(brush);

  function onBrush({ selection, sourceEvent, type }) {
    if (!sourceEvent) return; // ignore moves made by this code
    if (!selection) {
      if (state.dates) setState({ dates: null });
      return;
    }
    const [a, b] = snap(selection);
    if (type === "end") brushLayer.call(brush.move, [x(new Date(+a - HALF_DAY)), x(new Date(+b + HALF_DAY))]);
    const next = [toKey(a), toKey(b)];
    if (!state.dates || state.dates[0] !== next[0] || state.dates[1] !== next[1]) setState({ dates: next });
  }

  const bisect = d3.bisector((d) => d.day).center;

  brushLayer
    .on("pointermove.tip", (event) => {
      if (!rows.length) return;
      const d = rows[bisect(rows, x.invert(d3.pointer(event, plot.node())[0]))];
      if (d.value === null) {
        crosshair.style("display", "none");
        hideTip();
        return;
      }
      crosshair.style("display", null);
      crossLine.attr("x1", x(d.day)).attr("x2", x(d.day));
      crossDot.attr("cx", x(d.day)).attr("cy", y(d.value)).attr("fill", metricColor());
      showTip(event, `<strong>${dayLabel(d.day)}</strong>
        ${tipRow(metricShort(), fmtPct(d.value))}
        ${tipRow("Flights", fmtInt(d.flights))}
        ${tipRow("Cancelled", fmtInt(d.cancelled))}`);
    })
    .on("pointerleave.tip", () => {
      crosshair.style("display", "none");
      hideTip();
    });

  function render(summary) {
    rows = summary.timeline.map((d) => ({ ...d, day: parse(d.date), value: metric(d) }));
    const values = rows.map((d) => d.value).filter((v) => v !== null);
    const hasData = values.length > 0;
    const color = metricColor();

    d3.select("#timeline-title").text(metricTitle());
    yTitle.text(metricAxisLabel());
    y.domain(metricDomain(values));

    const t = () => d3.transition().duration(TRANSITION_MS).ease(transitionEase);
    drawGrid(grid, y, iW, 4);
    yAxis.transition(t()).call(d3.axisLeft(y).ticks(4).tickFormat((v) => `${v}%`).tickSizeOuter(0));
    linePath.attr("stroke", color).transition(t()).attr("d", hasData ? line(rows) : "");
    areaPath.attr("fill", color).transition(t()).attr("d", hasData ? area(rows) : "");
    note.style("display", hasData ? "none" : null);

    const reliable = rows.filter((d) => d.value !== null && !isSmallSample(d));
    const top = reliable.length ? d3.greatest(reliable, (d) => d.value) : null;
    peak.style("display", top ? null : "none");
    if (top) {
      const px = x(top.day);
      peak.attr("text-anchor", px > iW - 60 ? "end" : px < 60 ? "start" : "middle")
        .text(`${d3.timeFormat("%b %-d")(top.day)}: ${fmtPct(top.value)}`)
        .transition(t()).attr("x", px).attr("y", Math.max(10, y(top.value) - 8));
    }

    if (!state.dates && d3.brushSelection(brushLayer.node())) brushLayer.call(brush.move, null);
  }

  return { render };
}
