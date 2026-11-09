import { state, setState, toggled } from "../state.js";
import {
  app, CAUSE_COLORS, CAUSE_KEYS, TRANSITION_MS, transitionEase, causeMinutes,
  fmtInt, showTip, hideTip, tipRow, emptyNote, drawGrid, axisTitle,
} from "../shared.js";

const GAP = 2;
const MAX_BAR = 24;

// A column segment; only the top of the stack gets a rounded end.
function segmentPath(x, top, bottom, width, radius) {
  const r = Math.min(radius, (bottom - top), width / 2);
  return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${bottom}Z`;
}

export function createHours() {
  const W = 560, H = 226;
  const margin = { top: 10, right: 6, bottom: 38, left: 44 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top - margin.bottom;

  const hourLabel = (h) => {
    if (h === app.meta.overnight_hour) return "12–4a";
    if (h < 12) return `${h}a`;
    return h === 12 ? "12p" : `${h - 12}p`;
  };
  const longLabel = (h) => {
    if (h === app.meta.overnight_hour) return "12am to 4:59am";
    const suffix = h < 12 ? "am" : "pm";
    return `${h % 12 || 12}:00 to ${h % 12 || 12}:59${suffix}`;
  };

  const x = d3.scaleBand().domain(app.meta.hours).range([0, iW]).padding(0.14);
  const y = d3.scaleLinear().range([iH, 0]);
  const barWidth = Math.min(MAX_BAR, x.bandwidth());
  const barX = (x.bandwidth() - barWidth) / 2;

  const toggleCause = (event, key) =>
    setState({ causes: toggled(state.causes, key, event.ctrlKey || event.metaKey) });

  d3.select("#hours-legend").selectAll("button").data(CAUSE_KEYS).join("button")
    .attr("class", "legend-item").attr("type", "button")
    .html((key) => `<span class="swatch" style="background:${CAUSE_COLORS[key]}"></span>${app.causeLabels[key]}`)
    .on("click", toggleCause);

  const svg = d3.select("#hours-chart").append("svg").attr("viewBox", `0 0 ${W} ${H}`);
  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const grid = plot.append("g").attr("class", "grid");
  plot.append("g").attr("class", "axis").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).tickFormat(hourLabel).tickSizeOuter(0).tickSize(0));
  const yAxis = plot.append("g").attr("class", "axis");
  axisTitle(plot, iW / 2, iH + 33, { text: "Scheduled departure hour (local time)" });
  axisTitle(plot, -32, iH / 2, { rotate: true, text: "Minutes per arrived flight" });

  const columns = plot.append("g").selectAll("g").data(app.meta.hours).join("g")
    .attr("class", "hour-column")
    .attr("transform", (h) => `translate(${x(h)},0)`);
  columns.append("rect").attr("width", x.bandwidth()).attr("height", iH).attr("fill", "transparent");
  const segments = columns.selectAll("path").data((h) => CAUSE_KEYS.map((key) => ({ h, key }))).join("path")
    .attr("fill", (d) => CAUSE_COLORS[d.key])
    .attr("d", segmentPath(barX, iH, iH, barWidth, 0))
    .on("click", (event, d) => toggleCause(event, d.key));

  const note = emptyNote(plot, iW / 2, iH / 2);
  let byHour = new Map();

  function tipHtml(h) {
    const d = byHour.get(h);
    if (!d || !d.arrived) return `<strong>${longLabel(h)}</strong><div>No arrived flights</div>`;
    const rows = [...CAUSE_KEYS].reverse()
      .map((key) => tipRow(app.causeLabels[key], `${(d[key] / d.arrived).toFixed(1)} min`, CAUSE_COLORS[key]));
    return `<strong>${longLabel(h)}</strong>${rows.join("")}
      ${tipRow("All causes", `${(causeMinutes(d) / d.arrived).toFixed(1)} min`)}
      ${tipRow("Arrived flights", fmtInt(d.arrived))}`;
  }

  columns
    .on("pointermove", (event, h) => showTip(event, tipHtml(h)))
    .on("pointerleave", hideTip);

  function render(summary) {
    byHour = new Map(summary.hours.map((d) => [d.hour, d]));
    const perFlight = (d, key) => (d.arrived ? d[key] / d.arrived : 0);
    const totals = summary.hours.map((d) => (d.arrived ? causeMinutes(d) / d.arrived : 0));
    const hasData = d3.sum(summary.hours, (d) => d.arrived) > 0;

    // Minutes rescale with the selection: one bad day can be several times the monthly level.
    y.domain([0, Math.max(5, d3.max(totals))]).nice(5);

    drawGrid(grid, y, iW, 5);
    yAxis.transition().duration(TRANSITION_MS).ease(transitionEase)
      .call(d3.axisLeft(y).ticks(5).tickSizeOuter(0));

    segments
      .attr("opacity", (d) => (state.causes.size && !state.causes.has(d.key) ? 0.22 : 1))
      .transition().duration(TRANSITION_MS).ease(transitionEase)
      .attr("d", (d) => {
        const row = byHour.get(d.h);
        const index = CAUSE_KEYS.indexOf(d.key);
        const below = d3.sum(CAUSE_KEYS.slice(0, index), (key) => perFlight(row, key));
        const value = perFlight(row, d.key);
        const isTop = !CAUSE_KEYS.slice(index + 1).some((key) => y(0) - y(perFlight(row, key)) > GAP + 0.5);
        const rawBottom = y(below);
        const bottom = index > 0 && below > 0 ? rawBottom - GAP : rawBottom;
        const top = Math.min(bottom, y(below + value));
        return segmentPath(barX, top, bottom, barWidth, isTop ? 4 : 0);
      });

    note.style("display", hasData ? "none" : null);
    d3.select("#hours-legend").selectAll("button")
      .attr("aria-pressed", (key) => String(state.causes.has(key)));
  }

  return { render };
}
