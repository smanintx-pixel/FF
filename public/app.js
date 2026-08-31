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
}

function clearError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

async function apiGet(path, params = {}) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("league_id", state.leagueId);
  url.searchParams.set("year", state.year);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url);
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
  if (data.length === 0) return;
  data[0].roster.forEach((p) => {
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
    tr.innerHTML = `
      <td>${p.rank}</td>
      <td>${p.name}</td>
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
    status.textContent = `${draft.picks.length} picks made. Updated ${when}`;
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
      // keep polling; transient errors show on manual refresh
    }
  }, 10000);
}

const MY_TEAM_DEFAULT = "bluphi";

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
