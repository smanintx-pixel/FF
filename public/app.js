const state = {
  leagueId: document.getElementById("league-id").value,
  year: document.getElementById("year").value,
  currentWeek: null,
  teams: [],
  players: [],
  playersById: new Map(),
  draftedIds: new Set(),
  posFilter: "ALL",
  draftTimer: null,
};

const errorBox = document.getElementById("error");

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
  if (/private/i.test(msg)) {
    document.getElementById("settings-panel").classList.remove("hidden");
  }
}

function clearError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function getCreds() {
  try {
    return {
      s2: localStorage.getItem("ff-espn-s2") || "",
      swid: localStorage.getItem("ff-espn-swid") || "",
    };
  } catch (err) {
    return { s2: "", swid: "" };
  }
}

async function apiGet(path, params = {}) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("league_id", state.leagueId);
  url.searchParams.set("year", state.year);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  url.searchParams.set("_t", Date.now());
  const headers = {};
  const creds = getCreds();
  if (creds.s2 && creds.swid) {
    headers["x-espn-s2"] = creds.s2;
    headers["x-swid"] = creds.swid;
  }
  const res = await fetch(url, { headers, cache: "no-store" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });
}

async function loadMeta() {
  const meta = await apiGet("/api/meta");
  state.currentWeek = meta.current_week;
  state.teams = meta.teams;

  const weekInput = document.getElementById("week");
  weekInput.value = meta.current_week;

  const teamSelect = document.getElementById("team-select");
  teamSelect.innerHTML = "";
  meta.teams.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.team_id;
    opt.textContent = t.team_name;
    teamSelect.appendChild(opt);
  });
}

async function loadStandings() {
  const data = await apiGet("/api/standings");
  const body = document.getElementById("standings-body");
  body.innerHTML = "";
  data.forEach((t) => {
    const streak = `${t.streak_type === "WIN" ? "W" : t.streak_type === "LOSS" ? "L" : "-"}${t.streak_length || ""}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.standing}</td>
      <td>${t.team_name}</td>
      <td>${t.wins}</td>
      <td>${t.losses}</td>
      <td>${t.ties}</td>
      <td>${t.points_for.toFixed(2)}</td>
      <td>${t.points_against.toFixed(2)}</td>
      <td>${streak}</td>
    `;
    body.appendChild(tr);
  });
}

async function loadMatchups(week) {
  const data = await apiGet("/api/matchups", { week });
  document.getElementById("week").value = data.week;
  const list = document.getElementById("matchups-list");
  list.innerHTML = "";
  data.matchups.forEach((m) => {
    const card = document.createElement("div");
    card.className = "matchup-card";
    card.innerHTML = `
      <div class="side">
        <span>${m.away_team}</span>
        <span class="score">${m.away_score.toFixed(2)}</span>
      </div>
      <span class="vs">${m.is_playoff ? "PLAYOFF" : "vs"}</span>
      <div class="side">
        <span class="score">${m.home_score.toFixed(2)}</span>
        <span>${m.home_team}</span>
      </div>
    `;
    list.appendChild(card);
  });
  if (data.matchups.length === 0) {
    list.innerHTML = '<p>No matchups found for this week.</p>';
  }
}

async function loadRoster(teamId) {
  const data = await apiGet("/api/rosters", { team_id: teamId });
  const body = document.getElementById("roster-body");
  body.innerHTML = "";
  let roster = data.length ? data[0].roster : [];
  if (roster.length === 0) {
    // ESPN's roster view lags during drafts; rebuild from draft picks.
    try {
      await loadPlayers();
      const draft = await apiGet("/api/draft");
      const idNum = parseInt(teamId, 10);
      roster = draft.picks
        .filter((p) => p.team_id === idNum)
        .map((p) => {
          const pl = state.playersById.get(p.player_id);
          return {
            lineup_slot: `R${p.round}.${p.round_pick}`,
            name: pl ? pl.name : `Player #${p.player_id}`,
            position: pl ? pl.position : "",
            pro_team: pl ? pl.pro_team : "",
            injury_status: pl ? pl.injury_status : "",
            points: 0,
            projected_points: pl ? pl.projected_points : 0,
          };
        });
    } catch (err) {}
  }
  roster.forEach((p) => {
    const tr = document.createElement("tr");
    const statusClass = p.injury_status && p.injury_status !== "ACTIVE" ? "injured" : "";
    tr.innerHTML = `
      <td>${p.lineup_slot}</td>
      <td>${p.name}</td>
      <td>${p.position}</td>
      <td>${p.pro_team}</td>
      <td class="${statusClass}">${p.injury_status || ""}</td>
      <td>${p.points.toFixed(2)}</td>
      <td>${p.projected_points.toFixed(2)}</td>
    `;
    body.appendChild(tr);
  });
  if (roster.length === 0) {
    body.innerHTML = '<tr><td colspan="7">No players yet — roster fills in as the draft progresses.</td></tr>';
  }
}

async function loadPlayers() {
  if (state.players.length) return;
  state.players = await apiGet("/api/players", { limit: 300 });
  state.playersById = new Map(state.players.map((p) => [p.player_id, p]));
}

function playerLabel(playerId) {
  const p = state.playersById.get(playerId);
  return p ? `${p.name} (${p.position}, ${p.pro_team})` : `Player #${playerId}`;
}

function renderAvailable() {
  const body = document.getElementById("available-body");
  body.innerHTML = "";
  const available = state.players.filter(
    (p) =>
      !state.draftedIds.has(p.player_id) &&
      (state.posFilter === "ALL" || p.position === state.posFilter)
  );
  available.slice(0, 50).forEach((p, i) => {
    const tr = document.createElement("tr");
    if (i === 0) tr.className = "best-pick";
    const statusClass = p.injury_status && p.injury_status !== "ACTIVE" ? "injured" : "";
    const key = normName(p.name);
    const caution = CAUTION_PLAYERS[key];
    const marker = caution
      ? `<span class="caution" title="${caution}">⚠️</span> `
      : ALL_TARGETS.has(key)
        ? '<span title="On my draft plan">⭐</span> '
        : "";
    tr.innerHTML = `
      <td>${p.rank}</td>
      <td>${marker}${p.name}</td>
      <td>${p.position}</td>
      <td>${p.pro_team}</td>
      <td>${p.projected_points.toFixed(1)}</td>
      <td>${p.adp || "—"}</td>
      <td class="${statusClass}">${p.injury_status === "ACTIVE" ? "" : p.injury_status}</td>
    `;
    body.appendChild(tr);
  });
  if (available.length === 0) {
    body.innerHTML = '<tr><td colspan="7">No players left in the loaded pool for this filter.</td></tr>';
  }
}

function renderPicks(draft) {
  const myTeamId = parseInt(document.getElementById("draft-team-select").value, 10);
  const myPicks = draft.picks.filter((p) => p.team_id === myTeamId);

  const myList = document.getElementById("my-picks");
  myList.innerHTML = "";
  myPicks.forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `${playerLabel(p.player_id)} <span class="pick-meta">R${p.round}.${p.round_pick}</span>`;
    myList.appendChild(li);
  });
  if (myPicks.length === 0) {
    myList.innerHTML = '<li class="empty">No picks yet.</li>';
  }

  const counts = {};
  myPicks.forEach((p) => {
    const pos = state.playersById.get(p.player_id)?.position || "?";
    counts[pos] = (counts[pos] || 0) + 1;
  });
  document.getElementById("my-pos-counts").textContent = Object.entries(counts)
    .map(([pos, n]) => `${pos}×${n}`)
    .join(" · ");

  renderPlan(myPicks.length);

  const recentList = document.getElementById("recent-picks");
  recentList.innerHTML = "";
  draft.picks.slice(-10).reverse().forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `${playerLabel(p.player_id)} <span class="pick-meta">${p.team_name} · R${p.round}.${p.round_pick}</span>`;
    recentList.appendChild(li);
  });
  if (draft.picks.length === 0) {
    recentList.innerHTML = '<li class="empty">Draft has not started.</li>';
  }
}

async function refreshDraft() {
  const draft = await apiGet("/api/draft");
  state.draftedIds = new Set(draft.picks.map((p) => p.player_id));
  const status = document.getElementById("draft-status");
  const when = new Date().toLocaleTimeString();
  if (draft.drafted) {
    status.textContent = `Draft complete — ${draft.picks.length} picks. Updated ${when}`;
  } else if (draft.picks.length > 0) {
    status.textContent = `${draft.picks.length} of ${draft.total_slots || "?"} picks made. Updated ${when}`;
  } else if (draft.total_slots > 0) {
    status.textContent = `ESPN's API reports 0 of ${draft.total_slots} picks completed — waiting (their draft feed can lag the draft room). Updated ${when}`;
  } else {
    status.textContent = `Waiting for draft to start. Updated ${when}`;
  }
  renderPicks(draft);
  renderAvailable();
  return draft;
}

function stopDraftPolling() {
  if (state.draftTimer) {
    clearInterval(state.draftTimer);
    state.draftTimer = null;
  }
}

function startDraftPolling() {
  stopDraftPolling();
  state.draftTimer = setInterval(async () => {
    const draftTabActive = document
      .getElementById("tab-draft")
      .classList.contains("active");
    const auto = document.getElementById("draft-autorefresh").checked;
    if (!draftTabActive || !auto) return;
    try {
      const draft = await refreshDraft();
      if (draft.drafted) stopDraftPolling();
    } catch (err) {
      document.getElementById("draft-status").textContent =
        `⚠ ${err.message} — retrying in 10s`;
      if (/private/i.test(err.message)) {
        document.getElementById("settings-panel").classList.remove("hidden");
      }
    }
  }, 10000);
}

const MY_TEAM_DEFAULT = "bluphi";

// Stephen's 2026 draft guide: 10-team snake, pick 1.01, full PPR.
// Stages are keyed by how many picks my team has already made.
const PLAN_STAGES = [
  { after: 0, label: "Round 1 · Pick 1", objective: "Elite RB1 — Gibbs if available, else Bijan. No QB/TE/D/ST/K here.",
    targets: ["Jahmyr Gibbs", "Bijan Robinson", "Ja'Marr Chase", "Puka Nacua", "Jaxon Smith-Njigba"] },
  { after: 1, label: "Rounds 2–3 · Picks 20–21", objective: "One elite TE + one elite WR/RB. Only ONE of McBride/Bowers. No QB.",
    targets: ["Trey McBride", "Nico Collins", "Brock Bowers", "A.J. Brown", "Jeremiyah Love", "Saquon Barkley", "Rashee Rice", "Derrick Henry"] },
  { after: 3, label: "Rounds 4–5 · Picks 40–41", objective: "Starting WR + RB. Loveland only if no TE yet. Josh Allen only if he falls here.",
    targets: ["Ladd McConkey", "Cam Skattebo", "Tee Higgins", "Davante Adams", "Jaylen Waddle", "Colston Loveland"] },
  { after: 5, label: "Rounds 6–7 · Picks 60–61", objective: "FLEX + upside depth. Fill FLEX with RB/WR before any QB.",
    targets: ["TreVeyon Henderson", "Rome Odunze", "Luther Burden III", "Carnell Tate"] },
  { after: 7, label: "Rounds 8–9 · Picks 80–81", objective: "QB value + best FLEX. One QB only.",
    targets: ["Justin Herbert", "Caleb Williams", "Dak Prescott", "Patrick Mahomes", "Brock Purdy"] },
  { after: 9, label: "Rounds 10–13 · Picks 100–121", objective: "High-upside bench RBs/WRs. No 2nd QB, TE, D/ST, or K.",
    targets: ["Parker Washington", "Matthew Golden", "Rashid Shaheed", "Rachaad White", "Blake Corum", "J.K. Dobbins", "Tank Bigsby", "Keaton Mitchell"] },
  { after: 13, label: "Rounds 14–16 · Picks 140–160", objective: "D/ST (Week 1 matchup, pass rush) and kicker (good offense). Now, not earlier.",
    targets: [] },
];

const CAUTION_PLAYERS = {
  "josh jacobs": "verify current status; only at a big discount",
  "christian mccaffrey": "elite ceiling, but riskier than Gibbs",
  "derrick henry": "age/workload risk — right price only",
};

function normName(name) {
  return name.toLowerCase().replace(/[.'']/g, "").trim();
}

const ALL_TARGETS = new Set(
  PLAN_STAGES.flatMap((s) => s.targets).map(normName)
);

function currentStage(myPickCount) {
  let stage = PLAN_STAGES[0];
  for (const s of PLAN_STAGES) {
    if (myPickCount >= s.after) stage = s;
  }
  return stage;
}

function renderPlan(myPickCount) {
  const stage = currentStage(myPickCount);
  const panel = document.getElementById("plan-panel");
  const targetItems = stage.targets
    .map((name) => {
      const key = normName(name);
      const p = state.players.find((pl) => normName(pl.name) === key);
      const gone = p ? state.draftedIds.has(p.player_id) : false;
      const rank = p ? ` · #${p.rank}` : "";
      return `<li class="${gone ? "target-gone" : ""}">${name}${rank}</li>`;
    })
    .join("");
  panel.innerHTML = `
    <div class="plan-stage">${stage.label}</div>
    <div class="plan-objective">${stage.objective}</div>
    ${targetItems ? `<ul class="plan-targets">${targetItems}</ul>` : ""}
  `;
}

function savedTeamKey() {
  return `ff-my-team-${state.leagueId}-${state.year}`;
}

async function enterDraftTab() {
  clearError();
  try {
    await loadPlayers();
    const sel = document.getElementById("draft-team-select");
    if (sel.options.length === 0) {
      state.teams.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t.team_id;
        opt.textContent = t.team_name;
        sel.appendChild(opt);
      });
      let saved = null;
      try {
        saved = localStorage.getItem(savedTeamKey());
      } catch (err) {}
      const options = [...sel.options];
      const match =
        (saved && options.find((o) => o.value === saved)) ||
        options.find((o) =>
          o.textContent.toLowerCase().includes(MY_TEAM_DEFAULT)
        );
      if (match) sel.value = match.value;
    }
    await refreshDraft();
    startDraftPolling();
  } catch (err) {
    showError(err.message);
  }
}

async function refreshAll() {
  clearError();
  try {
    await loadMeta();
    await loadStandings();
    await loadMatchups(document.getElementById("week").value);
    const teamSelect = document.getElementById("team-select");
    if (teamSelect.value) await loadRoster(teamSelect.value);
  } catch (err) {
    showError(err.message);
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.tab);
    if (btn.dataset.tab === "draft") enterDraftTab();
    else stopDraftPolling();
  });
});

document.getElementById("draft-refresh").addEventListener("click", async () => {
  clearError();
  try {
    await refreshDraft();
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById("draft-team-select").addEventListener("change", (e) => {
  try {
    localStorage.setItem(savedTeamKey(), e.target.value);
  } catch (err) {}
  refreshDraft().catch((err) => showError(err.message));
});

document.getElementById("settings-toggle").addEventListener("click", () => {
  document.getElementById("settings-panel").classList.toggle("hidden");
});

document.getElementById("creds-save").addEventListener("click", () => {
  const s2 = document.getElementById("espn-s2").value.trim();
  const swid = document.getElementById("espn-swid").value.trim();
  const status = document.getElementById("creds-status");
  if (!s2 || !swid) {
    status.textContent = "Both values are required.";
    return;
  }
  try {
    localStorage.setItem("ff-espn-s2", s2);
    localStorage.setItem("ff-espn-swid", swid);
  } catch (err) {
    status.textContent = "Could not save (browser storage unavailable).";
    return;
  }
  status.textContent = "Saved — reloading league…";
  document.getElementById("settings-panel").classList.add("hidden");
  refreshAll();
});

document.getElementById("creds-clear").addEventListener("click", () => {
  try {
    localStorage.removeItem("ff-espn-s2");
    localStorage.removeItem("ff-espn-swid");
  } catch (err) {}
  document.getElementById("espn-s2").value = "";
  document.getElementById("espn-swid").value = "";
  document.getElementById("creds-status").textContent = "Cleared.";
});

document.querySelectorAll(".pos-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.posFilter = btn.dataset.pos;
    document.querySelectorAll(".pos-btn").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });
    renderAvailable();
  });
});

document.getElementById("league-form").addEventListener("submit", (e) => {
  e.preventDefault();
  state.leagueId = document.getElementById("league-id").value;
  state.year = document.getElementById("year").value;
  state.players = [];
  state.playersById = new Map();
  state.draftedIds = new Set();
  document.getElementById("draft-team-select").innerHTML = "";
  stopDraftPolling();
  refreshAll();
});

document.getElementById("week-load").addEventListener("click", async () => {
  clearError();
  try {
    await loadMatchups(document.getElementById("week").value);
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById("team-select").addEventListener("change", async (e) => {
  clearError();
  try {
    await loadRoster(e.target.value);
  } catch (err) {
    showError(err.message);
  }
});

refreshAll();
