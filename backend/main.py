"""JSON API for the flight delay dashboard.

Loads the prepared cube once at startup and aggregates it per request.
Run from the project root:
  uvicorn main:app --app-dir backend --port 8000
Interactive docs are served at http://localhost:8000/docs
"""
from datetime import date
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

CAUSES = [
    {"key": "carrier_delay", "label": "Carrier"},
    {"key": "weather_delay", "label": "Weather"},
    {"key": "nas_delay", "label": "National Air System"},
    {"key": "security_delay", "label": "Security"},
    {"key": "late_aircraft_delay", "label": "Late aircraft"},
]
MEASURES = ["flights", "arrived", "cancelled", "diverted", "late", "delay_min", *[c["key"] for c in CAUSES]]

CARRIER_NAMES = {
    "AA": "American Airlines",
    "AS": "Alaska Airlines",
    "B6": "JetBlue",
    "DL": "Delta Air Lines",
    "F9": "Frontier Airlines",
    "G4": "Allegiant Air",
    "MQ": "Envoy Air",
    "OH": "PSA Airlines",
    "OO": "SkyWest Airlines",
    "UA": "United Airlines",
    "WN": "Southwest Airlines",
    "YX": "Republic Airways",
}

# Hour 4 in the cube is the combined 12am-4am bucket (see scripts/prep_data.py).
OVERNIGHT_HOUR = 4

cube = pd.read_csv(
    DATA_DIR / "flights_cube.csv.gz",
    parse_dates=["date"],
    dtype={"origin": "category", "carrier": "category"},
)
airports = pd.read_csv(DATA_DIR / "airports.csv", keep_default_na=False)
airports["mappable"] = airports["mappable"].astype(bool)

ALL_DATES = pd.DatetimeIndex(sorted(cube["date"].unique()), name="date")
ALL_HOURS = pd.Index(sorted(cube["hour"].unique()), name="hour")

app = FastAPI(title="Flight Delay Dashboard API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


def parse_codes(value):
    return [code for code in (value or "").split(",") if code]


def group(rows, key, index=None):
    """Sum every measure by key, optionally filling absent keys with zeros."""
    out = rows.groupby(key, observed=True)[MEASURES].sum()
    if index is not None:
        out = out.reindex(index, fill_value=0)
    return out.reset_index()


@app.get("/api/meta")
def meta():
    """Static lookups the frontend needs before its first summary request."""
    return {
        "date_range": {
            "start": ALL_DATES[0].strftime("%Y-%m-%d"),
            "end": ALL_DATES[-1].strftime("%Y-%m-%d"),
        },
        "hours": ALL_HOURS.tolist(),
        "overnight_hour": OVERNIGHT_HOUR,
        "causes": CAUSES,
        "carriers": [
            {"code": code, "name": CARRIER_NAMES.get(code, code)}
            for code in sorted(cube["carrier"].unique())
        ],
        "airports": airports.to_dict(orient="records"),
    }


@app.get("/api/summary")
def summary(
    start: date | None = Query(None, description="First date, inclusive"),
    end: date | None = Query(None, description="Last date, inclusive"),
    airports: str | None = Query(None, description="Comma-separated origin codes"),
    carriers: str | None = Query(None, description="Comma-separated carrier codes"),
):
    """Return every view's data for the current selection.

    A view ignores the filter it controls, so the timeline stays complete while
    its own date brush is active and the map keeps showing unselected airports.
    The selected delay cause is not a filter: each row carries all five causes
    and the browser chooses which to display.
    """
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="start must not be after end")

    in_dates = pd.Series(True, index=cube.index)
    if start:
        in_dates &= cube["date"] >= pd.Timestamp(start)
    if end:
        in_dates &= cube["date"] <= pd.Timestamp(end)

    airport_codes = parse_codes(airports)
    at_airports = cube["origin"].isin(airport_codes) if airport_codes else pd.Series(True, index=cube.index)

    carrier_codes = parse_codes(carriers)
    by_carriers = cube["carrier"].isin(carrier_codes) if carrier_codes else pd.Series(True, index=cube.index)

    matching = cube[in_dates & at_airports & by_carriers]

    timeline = group(cube[at_airports & by_carriers], "date", ALL_DATES)
    timeline["date"] = timeline["date"].dt.strftime("%Y-%m-%d")

    return {
        "totals": {m: int(matching[m].sum()) for m in MEASURES},
        "timeline": timeline.to_dict(orient="records"),
        "hours": group(matching, "hour", ALL_HOURS).to_dict(orient="records"),
        "airports": group(cube[in_dates & by_carriers], "origin").to_dict(orient="records"),
        "carriers": group(cube[in_dates & at_airports], "carrier").to_dict(orient="records"),
    }
