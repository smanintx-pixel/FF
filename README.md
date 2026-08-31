# FF — Fantasy Football Dashboard

A small Flask app that shows standings, weekly matchups, and team rosters
for a public ESPN Fantasy Football league, using the
[espn-api](https://github.com/cwendt94/espn-api) library.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Then open http://localhost:5000. It defaults to league `1676746`, year
`2026` (override with the `FF_LEAGUE_ID` / `FF_YEAR` env vars, or by
editing the League ID / Year fields in the page and clicking Load).

## Private leagues

This app currently only supports public leagues. To add a private league
you'd pass `espn_s2` / `swid` cookies into `League(...)` in `app.py`.
