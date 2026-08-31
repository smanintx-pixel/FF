const state = {
  leagueId: document.getElementById("league-id").value,
  year: document.getElementById("year").value,
  currentWeek: null,
  teams: [],
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
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.getElementById("league-form").addEventListener("submit", (e) => {
  e.preventDefault();
  state.leagueId = document.getElementById("league-id").value;
  state.year = document.getElementById("year").value;
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
