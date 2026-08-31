# FF — Fantasy Football Dashboard

A small web dashboard showing standings, weekly matchups, and team rosters
for a public ESPN Fantasy Football league. Two interchangeable backends
serve the same `public/` frontend:

- **Flask** (`app.py`) for running locally, built on
  [espn-api](https://github.com/cwendt94/espn-api)
- **Netlify Functions** (`netlify/functions/api.mjs`) for hosting on
  Netlify, calling ESPN's fantasy v3 API directly

## Deploy to Netlify

In the Netlify dashboard: **Add new site → Import an existing project →
GitHub → this repo**. The included `netlify.toml` configures everything
(publish `public/`, functions in `netlify/functions/`) — no build command
or environment variables needed. Every push then auto-deploys.

## Run locally (Flask)

### Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Run

```bash
python app.py
```

Then open http://localhost:5000. It defaults to league `1676746`, year
`2026` (override with the `FF_LEAGUE_ID` / `FF_YEAR` env vars, or by
editing the League ID / Year fields in the page and clicking Load).

## Private leagues

Both backends read the `ESPN_S2` and `SWID` environment variables and
send them as cookies to ESPN. Get the values from your browser while
logged into fantasy.espn.com (DevTools → Application → Cookies), then:

- **Netlify**: set them as secret environment variables (scope:
  Functions) and trigger a redeploy.
- **Local**: `export ESPN_S2="..."` and `export SWID="{...}"` before
  `python app.py`.

If the app starts returning a 401 error again, the cookies have
expired — grab fresh ones the same way.
