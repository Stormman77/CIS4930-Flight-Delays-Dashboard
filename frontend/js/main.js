import { state, onChange, clearAll, setState, hasFilters } from "./state.js";
import { API_BASE, app, setMeta, fmtInt, fmtPct, hideTip, selectedCausesLabel } from "./shared.js";
import { createTimeline } from "./views/timeline.js";
import { createHours } from "./views/hours.js";
import { createMap } from "./views/map.js";
import { createCarriers } from "./views/carriers.js";

const STATES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const DEBOUNCE_MS = 150;

const dashboard = document.getElementById("dashboard");
const banner = document.getElementById("error-banner");

let views = [];
let summary = null;
let debounceTimer = null;
let activeRequest = null;

async function getJson(path, options) {
  const response = await fetch(API_BASE + path, options);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function showError() {
  banner.textContent = `Can't reach the data server at ${API_BASE}. Start the backend (see README), then reload this page.`;
  banner.hidden = false;
}

function summaryQuery() {
  const params = new URLSearchParams();
  if (state.dates) {
    params.set("start", state.dates[0]);
    params.set("end", state.dates[1]);
  }
  if (state.airports.size) params.set("airports", [...state.airports].join(","));
  if (state.carriers.size) params.set("carriers", [...state.carriers].join(","));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function renderViews() {
  views.forEach((view) => view.render(summary));
  renderFilterBar();
}

async function fetchSummary() {
  activeRequest?.abort();
  const request = new AbortController();
  activeRequest = request;
  dashboard.classList.add("is-loading");
  try {
    summary = await getJson(`/api/summary${summaryQuery()}`, { signal: request.signal });
    banner.hidden = true;
    renderViews();
  } catch (error) {
    if (error.name !== "AbortError") showError();
  } finally {
    if (activeRequest === request) dashboard.classList.remove("is-loading");
  }
}

function dateLabel([start, end]) {
  const parse = d3.timeParse("%Y-%m-%d");
  const day = d3.timeFormat("%b %-d");
  if (start === end) return day(parse(start));
  const [a, b] = [parse(start), parse(end)];
  return `${day(a)}–${a.getMonth() === b.getMonth() ? d3.timeFormat("%-d")(b) : day(b)}`;
}

function chips() {
  const list = [];
  if (state.dates) list.push({ label: dateLabel(state.dates), clear: { dates: null } });
  if (state.airports.size) {
    const codes = [...state.airports];
    const label = codes.length <= 4 ? codes.join(", ") : `${codes.length} airports`;
    list.push({ label, clear: { airports: new Set() } });
  }
  if (state.carriers.size) {
    const names = new Map(app.meta.carriers.map((c) => [c.code, c.name]));
    const codes = [...state.carriers];
    const label = codes.length <= 2 ? codes.map((c) => names.get(c)).join(", ") : `${codes.length} carriers`;
    list.push({ label, clear: { carriers: new Set() } });
  }
  if (state.causes.size) list.push({ label: `Cause: ${selectedCausesLabel()}`, clear: { causes: new Set() } });
  return list;
}

function renderFilterBar() {
  if (summary) {
    const { flights, arrived, late } = summary.totals;
    d3.select("#filter-count").html(
      `${fmtInt(flights)} flights <span>· ${fmtPct(arrived ? (late / arrived) * 100 : null)} arrived late</span>`
    );
  }
  const items = chips();
  d3.select("#filter-chips").selectAll("button.chip").data(items, (d) => d.label)
    .join("button")
    .attr("class", "chip")
    .attr("type", "button")
    .attr("aria-label", (d) => `Remove filter ${d.label}`)
    .text((d) => `${d.label}  ×`)
    .on("click", (event, d) => setState(d.clear));
  d3.select("#filter-chips").selectAll("span.filter-hint").data(items.length ? [] : [0])
    .join("span").attr("class", "filter-hint").text("All flights. Select in any chart to filter.");
  document.getElementById("clear-all").disabled = !hasFilters();
}

async function boot() {
  let geo;
  try {
    const [meta, states] = await Promise.all([getJson("/api/meta"), d3.json(STATES_URL)]);
    setMeta(meta);
    geo = states;
  } catch {
    showError();
    return;
  }

  views = [createTimeline(), createHours(), createMap(geo), createCarriers()];
  document.getElementById("clear-all").addEventListener("click", clearAll);

  onChange((patch) => {
    hideTip(); // the hovered mark may move or disappear
    renderFilterBar();
    // Causes are a display choice, so they need no new data from the server.
    if (Object.keys(patch).length === 1 && "causes" in patch) {
      renderViews();
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchSummary, DEBOUNCE_MS);
  });

  await fetchSummary();
}

boot();
