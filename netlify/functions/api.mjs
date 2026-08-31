// JS port of the Flask endpoints in app.py, hitting ESPN's fantasy v3 API
// directly. Field mappings mirror cwendt94/espn-api (football).

const DEFAULT_LEAGUE_ID = 1676746;
const DEFAULT_YEAR = 2026;

const PRO_TEAM_MAP = {
  0: "None", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL",
  7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV",
  14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
  21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB",
  28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

const POSITION_MAP = {
  0: "QB", 1: "TQB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE",
  7: "OP", 8: "DT", 9: "DE", 10: "LB", 11: "DL", 12: "CB", 13: "S",
  14: "DB", 15: "DP", 16: "D/ST", 17: "K", 18: "P", 19: "HC", 20: "BE",
  21: "IR", 22: "", 23: "RB/WR/TE", 24: "ER", 25: "Rookie",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fetchLeagueBase(leagueId, year, views, extraHeaders = {}) {
  const url = new URL(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}`
  );
  for (const view of views) url.searchParams.append("view", view);
  const headers = { ...extraHeaders };
  if (!headers.cookie) {
    const { ESPN_S2, SWID } = process.env;
    if (ESPN_S2 && SWID) headers.cookie = `espn_s2=${ESPN_S2}; SWID=${SWID}`;
  }
  const res = await fetch(url, { headers });
  if (res.status === 401) {
    const hint = headers.cookie
      ? "credentials are configured but ESPN rejected them (expired? grab fresh cookies)"
      : "no ESPN_S2/SWID configured on the server";
    throw { status: 401, message: `League ${leagueId} is private — ${hint}` };
  }
  if (res.status === 404) {
    throw { status: 404, message: `League ${leagueId} does not exist` };
  }
  if (!res.ok) {
    throw { status: 502, message: `ESPN returned an HTTP ${res.status}` };
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

function teamName(t) {
  return t.name || `${t.location ?? "Unknown"} ${t.nickname ?? "Unknown"}`;
}

function currentWeek(data) {
  const finalPeriod = data.status?.finalScoringPeriod ?? 18;
  const period = data.scoringPeriodId ?? 1;
  return Math.min(period, finalPeriod);
}

function mapStandings(data) {
  const teams = [...(data.teams ?? [])];
  teams.sort((a, b) => {
    const ka = a.rankCalculatedFinal || a.playoffSeed;
    const kb = b.rankCalculatedFinal || b.playoffSeed;
    return ka - kb;
  });
  return teams.map((t) => {
    const overall = t.record?.overall ?? {};
    return {
      standing: t.playoffSeed,
      team_id: t.id,
      team_name: teamName(t),
      wins: overall.wins ?? 0,
      losses: overall.losses ?? 0,
      ties: overall.ties ?? 0,
      points_for: overall.pointsFor ?? 0,
      points_against: Math.round((overall.pointsAgainst ?? 0) * 100) / 100,
      streak_type: overall.streakType ?? "",
      streak_length: overall.streakLength ?? 0,
      logo_url: t.logo ?? "",
    };
  });
}

function mapMatchups(data, week) {
  const names = new Map((data.teams ?? []).map((t) => [t.id, teamName(t)]));
  return (data.schedule ?? [])
    .filter((m) => m.matchupPeriodId === week)
    .map((m) => ({
      is_playoff: (m.playoffTierType ?? "NONE") !== "NONE",
      home_team: m.home ? names.get(m.home.teamId) ?? "Bye" : "Bye",
      home_score: m.home?.totalPoints ?? 0,
      away_team: m.away ? names.get(m.away.teamId) ?? "Bye" : "Bye",
      away_score: m.away?.totalPoints ?? 0,
    }));
}

function playerPosition(player) {
  for (const slot of player.eligibleSlots ?? []) {
    const name = POSITION_MAP[slot] ?? "";
    if (slot !== 25 && !name.includes("/")) return name;
  }
  return "";
}

function seasonTotal(player, year, projected) {
  const source = projected ? 1 : 0;
  for (const s of player.stats ?? []) {
    if (
      s.seasonId === year &&
      s.statSplitTypeId !== 2 &&
      s.scoringPeriodId === 0 &&
      s.statSourceId === source
    ) {
      return Math.round((s.appliedTotal ?? 0) * 100) / 100;
    }
  }
  return 0;
}

function mapRosters(data, year, teamId) {
  let teams = data.teams ?? [];
  if (teamId !== null) teams = teams.filter((t) => t.id === teamId);
  return teams.map((t) => ({
    team_id: t.id,
    team_name: teamName(t),
    roster: (t.roster?.entries ?? []).map((entry) => {
      const player = entry.playerPoolEntry?.player ?? entry.player ?? {};
      return {
        name: player.fullName ?? "",
        position: playerPosition(player),
        pro_team: PRO_TEAM_MAP[player.proTeamId] ?? "None",
        lineup_slot: POSITION_MAP[entry.lineupSlotId] ?? "",
        points: seasonTotal(player, year, false),
        projected_points: seasonTotal(player, year, true),
        injury_status: player.injuryStatus ?? "",
      };
    }),
  }));
}

function draftRank(player) {
  const ranks = player.draftRanksByRankType ?? {};
  return ranks.STANDARD?.rank ?? ranks.PPR?.rank ?? 9999;
}

function mapPlayers(data, year) {
  return (data.players ?? [])
    .map((entry) => {
      const player = entry.player ?? entry;
      return {
        player_id: player.id,
        name: player.fullName ?? "",
        position: playerPosition(player),
        pro_team: PRO_TEAM_MAP[player.proTeamId] ?? "None",
        rank: draftRank(player),
        adp: Math.round((player.ownership?.averageDraftPosition ?? 0) * 10) / 10,
        projected_points: seasonTotal(player, year, true),
        injury_status: player.injuryStatus ?? "",
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

function mapDraft(data) {
  const names = new Map((data.teams ?? []).map((t) => [t.id, teamName(t)]));
  const detail = data.draftDetail ?? {};
  // Before the draft starts, ESPN pre-populates every slot as a
  // placeholder pick with playerId -1 (or 0); only count real picks.
  const picks = (detail.picks ?? []).filter((p) => (p.playerId ?? 0) > 0);
  return {
    drafted: detail.drafted ?? false,
    in_progress: picks.length > 0 && !(detail.drafted ?? false),
    teams: Object.fromEntries(names),
    picks: picks.map((p) => ({
      player_id: p.playerId,
      team_id: p.teamId,
      team_name: names.get(p.teamId) ?? `Team ${p.teamId}`,
      round: p.roundId,
      round_pick: p.roundPickNumber,
      overall: p.overallPickNumber ?? null,
      keeper: p.keeper ?? false,
    })),
  };
}

export default async function handler(request, context) {
  const url = new URL(request.url);
  const endpoint = context.params?.endpoint ?? url.pathname.split("/").pop();
  const leagueId = parseInt(url.searchParams.get("league_id") ?? DEFAULT_LEAGUE_ID, 10);
  const year = parseInt(url.searchParams.get("year") ?? DEFAULT_YEAR, 10);

  // Per-visitor ESPN credentials sent by the frontend take priority over
  // any server-configured env vars.
  const s2 = request.headers.get("x-espn-s2");
  const swid = request.headers.get("x-swid");
  const creds = {};
  if (s2 && swid) creds.cookie = `espn_s2=${s2}; SWID=${swid}`;

  const fetchLeague = (lid, yr, views, extra = {}) =>
    fetchLeagueBase(lid, yr, views, { ...creds, ...extra });

  try {
    switch (endpoint) {
      case "meta": {
        const data = await fetchLeague(leagueId, year, ["mTeam", "mSettings"]);
        return json({
          league_id: leagueId,
          year,
          current_week: currentWeek(data),
          teams: (data.teams ?? []).map((t) => ({
            team_id: t.id,
            team_name: teamName(t),
          })),
        });
      }
      case "standings": {
        const data = await fetchLeague(leagueId, year, ["mTeam", "mStandings"]);
        return json(mapStandings(data));
      }
      case "matchups": {
        const data = await fetchLeague(leagueId, year, ["mMatchupScore", "mTeam"]);
        const week =
          parseInt(url.searchParams.get("week"), 10) || currentWeek(data);
        return json({ week, matchups: mapMatchups(data, week) });
      }
      case "rosters": {
        const data = await fetchLeague(leagueId, year, ["mTeam", "mRoster"]);
        const teamIdParam = url.searchParams.get("team_id");
        const teamId = teamIdParam === null ? null : parseInt(teamIdParam, 10);
        return json(mapRosters(data, year, teamId));
      }
      case "players": {
        const limit = Math.min(
          parseInt(url.searchParams.get("limit"), 10) || 300,
          1000
        );
        const filter = {
          players: {
            limit,
            sortDraftRanks: { sortPriority: 1, sortAsc: true, value: "STANDARD" },
          },
        };
        const data = await fetchLeague(leagueId, year, ["kona_player_info"], {
          "x-fantasy-filter": JSON.stringify(filter),
        });
        return json(mapPlayers(data, year));
      }
      case "draft": {
        const data = await fetchLeague(leagueId, year, ["mDraftDetail", "mTeam"]);
        return json(mapDraft(data));
      }
      default:
        return json({ error: `Unknown endpoint: ${endpoint}` }, 404);
    }
  } catch (err) {
    if (err && err.status) return json({ error: err.message }, err.status);
    return json({ error: `Unexpected error: ${err?.message ?? err}` }, 500);
  }
}

export const config = {
  path: "/api/:endpoint",
};
