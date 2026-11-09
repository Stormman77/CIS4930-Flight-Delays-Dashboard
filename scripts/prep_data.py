"""Prepare the BTS on-time data for the dashboard backend.

Reads the raw BTS zip and the OurAirports CSV, and writes:
  data/flights_cube.csv.gz  one row per date, scheduled hour, origin and carrier
  data/airports.csv         name, city, coordinates and map flag for each origin

No flights are removed, no outliers are clipped and no values are imputed.
Run from the project root:  python scripts/prep_data.py
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_AIRPORTS = ROOT / "data" / "raw" / "airports.csv"
OUT_CUBE = ROOT / "data" / "flights_cube.csv.gz"
OUT_AIRPORTS = ROOT / "data" / "airports.csv"

KEYS = ["date", "hour", "origin", "carrier"]
CAUSES = {
    "CARRIER_DELAY": "carrier_delay",
    "WEATHER_DELAY": "weather_delay",
    "NAS_DELAY": "nas_delay",
    "SECURITY_DELAY": "security_delay",
    "LATE_AIRCRAFT_DELAY": "late_aircraft_delay",
}
MEASURES = ["flights", "arrived", "cancelled", "diverted", "late", "delay_min", *CAUSES.values()]

# Scheduled hours 0-4 hold about 0.2% of flights, so they share one bucket.
# In the cube, hour 4 means "12am-4am"; hours 5-23 are single hours.
OVERNIGHT_HOUR = 4

# d3.geoAlbersUsa draws the 50 states and DC but not these BTS state codes.
OFF_MAP_STATES = {"PR", "VI", "TT"}
US_COUNTRIES = ["US", "PR", "VI", "GU", "MP", "AS"]
TYPE_RANK = {"large_airport": 0, "medium_airport": 1, "small_airport": 2}

# West Palm Beach is coded PBI in the BTS data but DJT in OurAirports.
OURAIRPORTS_TO_BTS_CODE = {"DJT": "PBI"}


def find_raw_zip():
    matches = sorted(ROOT.glob("T_ONTIME_REPORTING_*.zip"))
    if len(matches) != 1:
        raise SystemExit(f"Expected one T_ONTIME_REPORTING_*.zip in {ROOT}, found {len(matches)}")
    return matches[0]


def load_flights(path):
    raw = pd.read_csv(path, low_memory=False)
    flights = pd.DataFrame({
        "date": pd.to_datetime(raw["FL_DATE"], format="%m/%d/%Y %I:%M:%S %p").dt.strftime("%Y-%m-%d"),
        "hour": (raw["CRS_DEP_TIME"] // 100).clip(lower=OVERNIGHT_HOUR).astype(int),
        "origin": raw["ORIGIN"],
        "carrier": raw["OP_UNIQUE_CARRIER"],
        "city": raw["ORIGIN_CITY_NAME"],
        "flights": 1,
        "cancelled": raw["CANCELLED"].astype(int),
        "diverted": raw["DIVERTED"].astype(int),
        # BTS leaves these blank for cancelled and diverted flights, and leaves
        # the cause columns blank for flights under 15 minutes late. Summing
        # skips blanks, so neither group adds to the delay totals.
        "late": raw["ARR_DEL15"],
        "delay_min": raw["ARR_DELAY_NEW"],
        **{new: raw[old] for old, new in CAUSES.items()},
    })
    flights["arrived"] = flights["flights"] - flights["cancelled"] - flights["diverted"]
    return flights


def build_cube(flights):
    cube = flights.groupby(KEYS, as_index=False, sort=True)[MEASURES].sum()
    cube[MEASURES] = cube[MEASURES].round().astype(int)
    return cube


def build_airports(flights):
    origins = flights.groupby("origin", as_index=False).agg(city=("city", "first"))
    origins["state"] = origins["city"].str[-2:]

    # keep_default_na=False stops codes and regions being read as missing.
    lookup = pd.read_csv(RAW_AIRPORTS, keep_default_na=False, low_memory=False)
    lookup["iata_code"] = lookup["iata_code"].replace(OURAIRPORTS_TO_BTS_CODE)
    lookup = lookup[lookup["iata_code"].isin(origins["origin"]) & lookup["iso_country"].isin(US_COUNTRIES)].copy()

    # A code can appear on more than one record, for example a closed field.
    lookup["rank"] = lookup["type"].map(TYPE_RANK).fillna(9)
    lookup["no_service"] = lookup["scheduled_service"] != "yes"
    lookup = lookup.sort_values(["no_service", "rank"]).drop_duplicates("iata_code")

    airports = origins.merge(
        lookup[["iata_code", "name", "latitude_deg", "longitude_deg"]],
        left_on="origin", right_on="iata_code", how="left",
    ).rename(columns={"latitude_deg": "lat", "longitude_deg": "lon"})
    airports["lat"] = pd.to_numeric(airports["lat"])
    airports["lon"] = pd.to_numeric(airports["lon"])

    missing = airports.loc[airports["lat"].isna(), "origin"].tolist()
    if missing:
        raise SystemExit(f"No coordinates found for origins: {missing}")

    airports["mappable"] = (~airports["state"].isin(OFF_MAP_STATES)).astype(int)
    return airports[["origin", "name", "city", "state", "lat", "lon", "mappable"]]


def verify(flights, airports):
    """Re-read the saved files and compare every total with the source rows."""
    cube = pd.read_csv(OUT_CUBE)
    saved_airports = pd.read_csv(OUT_AIRPORTS, keep_default_na=False)

    source = flights[MEASURES].sum().round().astype(int)
    saved = cube[MEASURES].sum()
    report = pd.DataFrame({"source": source, "cube": saved})
    report["match"] = report["source"] == report["cube"]
    print(report.to_string())

    problems = []
    if not report["match"].all():
        problems.append("measure totals differ")
    if cube.duplicated(KEYS).any():
        problems.append("duplicate cube keys")
    if not cube["hour"].between(OVERNIGHT_HOUR, 23).all():
        problems.append("hour out of range")
    if (cube["late"] > cube["arrived"]).any():
        problems.append("more late flights than arrived flights")
    if set(cube["origin"]) != set(saved_airports["origin"]):
        problems.append("cube origins and airport list differ")
    if len(saved_airports) != len(airports):
        problems.append("airport row count changed on save")
    if problems:
        raise SystemExit("VERIFY FAILED: " + "; ".join(problems))

    print(f"\nCube: {len(cube):,} rows, {cube['date'].min()} to {cube['date'].max()}, "
          f"{cube['carrier'].nunique()} carriers, {cube['origin'].nunique()} origins")
    print(f"Airports: {len(saved_airports)} ({int(saved_airports['mappable'].sum())} on the map)")
    print("All checks passed.")


def main():
    flights = load_flights(find_raw_zip())
    cube = build_cube(flights)
    airports = build_airports(flights)

    OUT_CUBE.parent.mkdir(parents=True, exist_ok=True)
    cube.to_csv(OUT_CUBE, index=False)
    airports.to_csv(OUT_AIRPORTS, index=False)
    verify(flights, airports)


if __name__ == "__main__":
    main()
