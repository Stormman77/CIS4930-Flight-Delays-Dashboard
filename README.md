# Why Flights Run Late

An interactive dashboard of U.S. flight delays in June 2026, built for CIS 4930/5930 Assignment 2.
It asks where delays come from and whether they build through the day.

The project has a FastAPI backend that serves the data and a D3.js frontend that draws four linked views.

## Requirements

- Python 3.11 or newer (tested on 3.13)
- A modern web browser
- An internet connection, because the page loads D3, topojson-client and the U.S. state outlines from CDNs

No environment variables or API keys are needed.

## Install

Run these once, from the project's top-level folder.

**macOS / Linux**

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```

**Windows (PowerShell)**

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

## Run

The dashboard needs two terminals, both opened in the project's top-level folder. Leave both running.

**Terminal 1: backend, on port 8000**

macOS / Linux:

```bash
.venv/bin/python -m uvicorn main:app --app-dir backend --port 8000
```

Windows:

```powershell
.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --port 8000
```

**Terminal 2: frontend, on port 5173**

macOS / Linux:

```bash
.venv/bin/python -m http.server 5173 --bind 127.0.0.1 --directory frontend
```

Windows:

```powershell
.venv\Scripts\python.exe -m http.server 5173 --bind 127.0.0.1 --directory frontend
```

Then open **http://127.0.0.1:5173** in a browser. Press `Ctrl+C` in each terminal to stop.

If the page shows "Can't reach the data server", the backend in Terminal 1 isn't running.
Use `127.0.0.1` rather than `localhost`; on Windows, `localhost` can add about two seconds to each API request.

## Using the dashboard

| View | Interaction | What the other views do |
|---|---|---|
| Daily timeline | Drag across days | Hour, map and carrier views re-aggregate to those dates |
| Hour of day by cause | Click a cause or legend item; Ctrl+click (Cmd+click on Mac) combines causes | Timeline, map and carriers show the selected causes' share of delay minutes |
| Airport map | Click or Ctrl+click (Cmd+click on Mac); "Drag to select" boxes a region; scroll to zoom | Timeline, hour and carrier views filter to those airports |
| Carrier ranking | Click or Ctrl+click (Cmd+click on Mac) | Timeline, hour and map views filter to those carriers |

The bar at the top shows the current selection and flight count. Remove one filter with its × or use **Clear all**.

## Data

| File | Description |
|---|---|
| `T_ONTIME_REPORTING_20261108_190408.zip` | Raw flight records from the [BTS On-Time Performance](https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ&QO_fu146_anzr=b0-gvzr) database, June 2026 |
| `data/raw/airports.csv` | Airport locations from [OurAirports](https://ourairports.com/data/) |
| `data/flights_cube.csv.gz` | Generated: flights summarized by date, scheduled hour, origin airport and carrier |
| `data/airports.csv` | Generated: name, city, coordinates and map flag for each origin airport |

The generated files are included, so this step is optional. To rebuild them:

macOS / Linux:

```bash
.venv/bin/python scripts/prep_data.py
```

Windows:

```powershell
.venv\Scripts\python.exe scripts\prep_data.py
```

The script removes no flights, clips no outliers and fills in no missing values. It re-reads its output and stops with an error if any total differs from the raw data.

Notes on the data:

- Cancelled and diverted flights have no arrival delay, so they are counted separately and left out of the percentage late.
- BTS reports delay causes only for flights arriving 15 or more minutes late.
- Scheduled hours from 12am to 4:59am hold about 0.2% of flights and are combined into one bucket.
- West Palm Beach is coded `PBI` in the BTS data and `DJT` in OurAirports. The prep script maps one to the other.
- The map doesn't draw Puerto Rico, the U.S. Virgin Islands, Guam or Saipan. Those flights still count in the other views.

## Project layout

```
backend/    FastAPI app and pinned Python dependencies
frontend/   index.html, css/, and js/ (state, API calls, and one file per view)
scripts/    Data preparation
data/       Generated files and the raw airport list
```

To point the frontend at a different backend, change `API_BASE` in `frontend/js/shared.js`.
