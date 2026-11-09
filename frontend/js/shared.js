import { state } from "./state.js";

// Change this one line to point the dashboard at a deployed backend.
// 127.0.0.1 avoids a ~2 second IPv6 fallback that "localhost" can hit on Windows.
export const API_BASE = "http://127.0.0.1:8000";

export const TRANSITION_MS = 300;
export const transitionEase = d3.easeCubicOut;

// Stacking order and colors are fixed, so a cause keeps its color everywhere.
export const CAUSE_COLORS = {
  late_aircraft_delay: "#2a78d6",
  carrier_delay: "#eb6834",
  nas_delay: "#1baf7a",
  weather_delay: "#eda100",
  security_delay: "#e87ba4",
};
export const CAUSE_KEYS = Object.keys(CAUSE_COLORS);
export const PCT_LATE_COLOR = "#6250d6";
export const SMALL_SAMPLE_COLOR = "#c3c2b7";
export const MIN_FLIGHTS = 30;

export const app = { meta: null, causeLabels: {} };

export function setMeta(meta) {
  app.meta = meta;
  app.causeLabels = Object.fromEntries(meta.causes.map((c) => [c.key, c.label]));
}

export const fmtInt = d3.format(",");
export const fmtPct = (v) => (v === null ? "n/a" : `${v.toFixed(1)}%`);

export const causeMinutes = (d) => CAUSE_KEYS.reduce((sum, key) => sum + d[key], 0);

// The one measure the timeline, map and carrier views share.
export function metric(d) {
  if (!state.cause) return d.arrived ? (d.late / d.arrived) * 100 : null;
  const total = causeMinutes(d);
  return total ? (d[state.cause] / total) * 100 : null;
}

export const metricColor = () => (state.cause ? CAUSE_COLORS[state.cause] : PCT_LATE_COLOR);

export const metricTitle = () =>
  state.cause ? `${app.causeLabels[state.cause]} share of delay minutes` : "Share of flights arriving 15+ minutes late";

export const metricAxisLabel = () =>
  state.cause ? "Share of delay minutes (%)" : "Arrived flights 15+ min late (%)";

export const metricShort = () => (state.cause ? `${app.causeLabels[state.cause]} share` : "Late");

// Percentage axes stay fixed so selections can be compared; "% late" holds at
// 0-60 and only widens to 100 when a small selection goes past 60.
export function metricDomain(values) {
  if (state.cause) return [0, 100];
  return [0, d3.max(values) > 60 ? 100 : 60];
}

export const isSmallSample = (d) => d.arrived < MIN_FLIGHTS;

const tip = d3.select("#tooltip");

function moveTip(event) {
  const node = tip.node();
  const { offsetWidth: w, offsetHeight: h } = node;
  const flipX = event.clientX + 16 + w > window.innerWidth - 8;
  const flipY = event.clientY - h - 12 < 8;
  const x = flipX ? event.pageX - w - 16 : event.pageX + 16;
  const y = flipY ? event.pageY + 16 : event.pageY - h - 12;
  node.style.transform = `translate(${x}px, ${y}px)`;
}

export function showTip(event, html) {
  tip.html(html).style("opacity", 1);
  moveTip(event);
}

export function hideTip() {
  tip.style("opacity", 0);
}

export const tipRow = (label, value, color) =>
  `<div class="tip-row">${color ? `<span class="swatch" style="background:${color}"></span>` : ""}<span>${label}</span><b>${value}</b></div>`;

export function axisTitle(parent, x, y, { rotate = false, text = "" } = {}) {
  return parent.append("text").attr("class", "axis-label").attr("text-anchor", "middle")
    .attr("transform", `translate(${x},${y})${rotate ? " rotate(-90)" : ""}`).text(text);
}

export function emptyNote(svg, x, y) {
  return svg.append("text").attr("class", "empty-note").attr("x", x).attr("y", y)
    .text("No flights match this selection").style("display", "none");
}

// Shared hairline axis styling for a chart's y grid.
export function drawGrid(selection, scale, width, ticks) {
  selection.transition().duration(TRANSITION_MS).ease(transitionEase)
    .call(d3.axisLeft(scale).ticks(ticks).tickSize(-width).tickFormat(""));
}
