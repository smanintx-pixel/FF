import json
import os

from espn_api.football import League
from espn_api.football.constant import POSITION_MAP, PRO_TEAM_MAP
from espn_api.requests.espn_requests import (
    ESPNAccessDenied,
    ESPNInvalidLeague,
    ESPNUnknownError,
)
from flask import Flask, jsonify, request

app = Flask(__name__, static_folder="public", static_url_path="")

DEFAULT_LEAGUE_ID = int(os.environ.get("FF_LEAGUE_ID", "1676746"))
DEFAULT_YEAR = int(os.environ.get("FF_YEAR", "2026"))

_league_cache = {}


def get_league(league_id: int, year: int) -> League:
    espn_s2 = request.headers.get("X-Espn-S2") or os.environ.get("ESPN_S2")
    swid = request.headers.get("X-Swid") or os.environ.get("SWID")
    key = (league_id, year, espn_s2, swid)
    if key not in _league_cache:
        _league_cache[key] = League(
            league_id=league_id, year=year, espn_s2=espn_s2, swid=swid
        )
    return _league_cache[key]


def _team_display_name(data: dict) -> str:
    name = data.get("name")
    if name:
        return name
    return f"{data.get('location', 'Unknown')} {data.get('nickname', 'Unknown')}"


def _player_position(player: dict) -> str:
    for slot in player.get("eligibleSlots", []):
        name = POSITION_MAP.get(slot, "")
        if slot != 25 and "/" not in name:
            return name
    return ""


def _season_total(player: dict, year: int, projected: bool) -> float:
    source = 1 if projected else 0
    for s in player.get("stats", []):
        if (
            s.get("seasonId") == year
            and s.get("statSplitTypeId") != 2
            and s.get("scoringPeriodId") == 0
            and s.get("statSourceId") == source
        ):
            return round(s.get("appliedTotal", 0), 2)
    return 0.0


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
    return app.send_static_file("index.html")


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


@app.route("/api/players")
def players():
    league_id, year = parse_league_params()
    limit = min(request.args.get("limit", 300, type=int), 1000)
    league = get_league(league_id, year)
    filters = {
        "players": {
            "limit": limit,
            "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "STANDARD"},
        }
    }
    data = league.espn_request.league_get(
        params={"view": "kona_player_info"},
        headers={"x-fantasy-filter": json.dumps(filters)},
    )
    result = []
    for entry in data.get("players", []):
        player = entry.get("player", entry)
        ranks = player.get("draftRanksByRankType", {})
        rank = (
            ranks.get("STANDARD", {}).get("rank")
            or ranks.get("PPR", {}).get("rank")
            or 9999
        )
        result.append(
            {
                "player_id": player.get("id"),
                "name": player.get("fullName", ""),
                "position": _player_position(player),
                "pro_team": PRO_TEAM_MAP.get(player.get("proTeamId"), "None"),
                "rank": rank,
                "adp": round(
                    player.get("ownership", {}).get("averageDraftPosition", 0), 1
                ),
                "projected_points": _season_total(player, year, projected=True),
                "injury_status": player.get("injuryStatus", ""),
            }
        )
    result.sort(key=lambda p: p["rank"])
    return jsonify(result)


@app.route("/api/draft")
def draft():
    league_id, year = parse_league_params()
    league = get_league(league_id, year)
    data = league.espn_request.league_get(params={"view": ["mDraftDetail", "mTeam"]})
    names = {t["id"]: _team_display_name(t) for t in data.get("teams", [])}
    detail = data.get("draftDetail", {})
    picks = [
        {
            "player_id": p.get("playerId"),
            "team_id": p.get("teamId"),
            "team_name": names.get(p.get("teamId"), f"Team {p.get('teamId')}"),
            "round": p.get("roundId"),
            "round_pick": p.get("roundPickNumber"),
            "overall": p.get("overallPickNumber"),
            "keeper": p.get("keeper", False),
        }
        for p in detail.get("picks", [])
    ]
    return jsonify(
        {
            "drafted": detail.get("drafted", False),
            "in_progress": bool(picks) and not detail.get("drafted", False),
            "teams": names,
            "picks": picks,
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
