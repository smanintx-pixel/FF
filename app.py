import os

from espn_api.football import League
from espn_api.requests.espn_requests import (
    ESPNAccessDenied,
    ESPNInvalidLeague,
    ESPNUnknownError,
)
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

DEFAULT_LEAGUE_ID = int(os.environ.get("FF_LEAGUE_ID", "1676746"))
DEFAULT_YEAR = int(os.environ.get("FF_YEAR", "2026"))

_league_cache = {}


def get_league(league_id: int, year: int) -> League:
    key = (league_id, year)
    if key not in _league_cache:
        _league_cache[key] = League(league_id=league_id, year=year)
    return _league_cache[key]


def parse_league_params():
    league_id = request.args.get("league_id", DEFAULT_LEAGUE_ID, type=int)
    year = request.args.get("year", DEFAULT_YEAR, type=int)
    return league_id, year


@app.errorhandler(ESPNInvalidLeague)
def handle_invalid_league(err):
    return jsonify({"error": str(err)}), 404


@app.errorhandler(ESPNAccessDenied)
def handle_access_denied(err):
    return jsonify({"error": str(err)}), 401


@app.errorhandler(ESPNUnknownError)
def handle_unknown_error(err):
    return jsonify({"error": str(err)}), 502


@app.route("/")
def index():
    return render_template(
        "index.html", default_league_id=DEFAULT_LEAGUE_ID, default_year=DEFAULT_YEAR
    )


@app.route("/api/meta")
def meta():
    league_id, year = parse_league_params()
    league = get_league(league_id, year)
    return jsonify(
        {
            "league_id": league_id,
            "year": year,
            "current_week": league.current_week,
            "teams": [
                {"team_id": t.team_id, "team_name": t.team_name} for t in league.teams
            ],
        }
    )


@app.route("/api/standings")
def standings():
    league_id, year = parse_league_params()
    league = get_league(league_id, year)
    data = [
        {
            "standing": t.standing,
            "team_id": t.team_id,
            "team_name": t.team_name,
            "wins": t.wins,
            "losses": t.losses,
            "ties": t.ties,
            "points_for": t.points_for,
            "points_against": t.points_against,
            "streak_type": t.streak_type,
            "streak_length": t.streak_length,
            "logo_url": t.logo_url,
        }
        for t in league.standings()
    ]
    return jsonify(data)


@app.route("/api/matchups")
def matchups():
    league_id, year = parse_league_params()
    week = request.args.get("week", type=int)
    league = get_league(league_id, year)
    week = week or league.current_week
    data = []
    for m in league.scoreboard(week=week):
        data.append(
            {
                "is_playoff": m.is_playoff,
                "home_team": m.home_team.team_name if m.home_team else "Bye",
                "home_score": m.home_score,
                "away_team": m.away_team.team_name if m.away_team else "Bye",
                "away_score": m.away_score,
            }
        )
    return jsonify({"week": week, "matchups": data})


@app.route("/api/rosters")
def rosters():
    league_id, year = parse_league_params()
    team_id = request.args.get("team_id", type=int)
    league = get_league(league_id, year)

    teams = league.teams
    if team_id is not None:
        teams = [t for t in teams if t.team_id == team_id]

    data = []
    for t in teams:
        data.append(
            {
                "team_id": t.team_id,
                "team_name": t.team_name,
                "roster": [
                    {
                        "name": p.name,
                        "position": p.position,
                        "pro_team": p.proTeam,
                        "lineup_slot": p.lineupSlot,
                        "points": p.total_points,
                        "projected_points": p.projected_total_points,
                        "injury_status": p.injuryStatus,
                    }
                    for p in t.roster
                ],
            }
        )
    return jsonify(data)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
