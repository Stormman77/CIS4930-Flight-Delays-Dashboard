// The single source of truth for the selection. Views read it and call
// setState; no view keeps a private copy or updates another view directly.

export const state = {
  dates: null,            // ["YYYY-MM-DD", "YYYY-MM-DD"] or null
  airports: new Set(),
  carriers: new Set(),
  cause: null,            // a cause key, or null for "% late"
};

const listeners = new Set();

export function onChange(listener) {
  listeners.add(listener);
}

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((listener) => listener(patch));
}

export function clearAll() {
  setState({ dates: null, airports: new Set(), carriers: new Set(), cause: null });
}

// Click selects one item (or clears it if it's the only one selected);
// Shift+click adds or removes it.
export function toggled(current, value, additive) {
  const next = new Set(additive ? current : []);
  if (additive) {
    if (next.has(value)) next.delete(value);
    else next.add(value);
  } else if (!(current.size === 1 && current.has(value))) {
    next.add(value);
  }
  return next;
}

export function hasFilters() {
  return Boolean(state.dates || state.airports.size || state.carriers.size || state.cause);
}
