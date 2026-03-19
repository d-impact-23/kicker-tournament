// ═══════════════════════════════════════════════════════════════════════════
// Kicker Tournament - Frontend Logic
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Detect base path from current URL (works behind reverse proxy with path prefix)
  const basePath = window.location.pathname.replace(/\/+$/, '').replace(/\/[^/]*\.[^/]*$/, '') || '';
  const API = basePath + '/api';
  let currentTournament = null;
  let pollInterval = null;

  // ─── DOM Helpers ──────────────────────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function show(el) { if (typeof el === 'string') el = $(el); if (el) el.style.display = ''; }
  function hide(el) { if (typeof el === 'string') el = $(el); if (el) el.style.display = 'none'; }

  // ─── Toast ────────────────────────────────────────────────────────────────

  let toastTimer = null;
  function toast(msg, type = 'info') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast toast-${type} toast-show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('toast-show'), 3000);
  }

  // ─── API Helpers ──────────────────────────────────────────────────────────

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    return data;
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  function navigate(viewId, title) {
    $$('.view').forEach(v => v.classList.remove('active'));
    const view = $(`#${viewId}`);
    if (view) view.classList.add('active');

    const backBtn = $('#btn-back');
    if (viewId === 'view-home') {
      hide(backBtn);
      $('#header-title').textContent = '⚽ Kicker';
      stopPolling();
    } else {
      show(backBtn);
      $('#header-title').textContent = title || '⚽ Kicker';
    }
  }

  // ─── Polling ──────────────────────────────────────────────────────────────

  function startPolling() {
    stopPolling();
    pollInterval = setInterval(() => {
      if (currentTournament) {
        refreshTournament(currentTournament.id, true);
      }
    }, 5000);
  }

  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  // ─── Home View ────────────────────────────────────────────────────────────

  async function loadTournaments() {
    try {
      const list = await api('/tournaments');
      const container = $('#tournament-list');
      if (!list.length) {
        container.innerHTML = '<p class="text-muted text-center">Aucun tournoi. Créez-en un !</p>';
        return;
      }
      container.innerHTML = list.map(t => {
        const statusEmoji = t.status === 'completed' ? '✅' : t.status === 'active' ? '🟢' : '⚙️';
        const statusLabel = t.status === 'completed' ? 'Terminé' : t.status === 'active' ? 'En cours' : 'Configuration';
        const formatLabel = t.format === 'round-robin' ? '🔄 Round Robin' : '⚡ Élimination';
        return `
          <div class="tournament-item" data-id="${t.id}">
            <div class="tournament-item-left">
              <div class="tournament-item-name">${esc(t.name)}</div>
              <div class="tournament-item-meta">
                ${formatLabel} • ${t.player_count} joueurs • ${statusEmoji} ${statusLabel}
              </div>
            </div>
            <span class="tournament-item-arrow">›</span>
          </div>
        `;
      }).join('');

      container.querySelectorAll('.tournament-item').forEach(el => {
        el.addEventListener('click', () => openTournament(parseInt(el.dataset.id)));
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function createTournament() {
    const nameInput = $('#new-tournament-name');
    const name = nameInput.value.trim();
    const format = document.querySelector('input[name="format"]:checked').value;
    if (!name) { toast('Entrez un nom de tournoi', 'error'); nameInput.focus(); return; }
    try {
      const t = await api('/tournaments', { method: 'POST', body: { name, format } });
      nameInput.value = '';
      toast('Tournoi créé ! 🎉');
      openTournament(t.id);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function seedDemo(format) {
    try {
      const t = await api('/seed', { method: 'POST', body: { format } });
      toast('Tournoi de démo créé ! 🎉');
      openTournament(t.id);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Open Tournament ─────────────────────────────────────────────────────

  async function openTournament(id) {
    try {
      const t = await api(`/tournaments/${id}`);
      currentTournament = t;
      if (t.status === 'setup') {
        showSetupView(t);
      } else {
        showTournamentView(t);
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  async function refreshTournament(id, silent) {
    try {
      const t = await api(`/tournaments/${id}`);
      currentTournament = t;
      if (t.status === 'setup') {
        renderPlayers(t);
      } else {
        renderMatches(t);
        renderStandings(t.id);
        if (t.format === 'knockout') renderBracket(t);
      }
    } catch (e) { if (!silent) toast(e.message, 'error'); }
  }

  // ─── Setup View ───────────────────────────────────────────────────────────

  function showSetupView(t) {
    navigate('view-setup', `⚙️ ${t.name}`);
    const info = $('#setup-tournament-info');
    const formatLabel = t.format === 'round-robin' ? '🔄 Round Robin' : '⚡ Élimination directe';
    info.innerHTML = `
      <div class="tournament-badge">${formatLabel}</div>
      <h2>${esc(t.name)}</h2>
    `;
    renderPlayers(t);
  }

  function renderPlayers(t) {
    const list = $('#player-list');
    const noMsg = $('#no-players-msg');
    const badge = $('#player-count-badge');
    badge.textContent = t.players.length;

    if (!t.players.length) {
      list.innerHTML = '';
      show(noMsg);
      return;
    }
    hide(noMsg);
    list.innerHTML = t.players.map(p => `
      <li class="player-item">
        <span class="player-name">👤 ${esc(p.name)}</span>
        <button class="btn-icon btn-delete" data-pid="${p.id}" aria-label="Supprimer">✕</button>
      </li>
    `).join('');

    list.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => removePlayer(t.id, parseInt(btn.dataset.pid)));
    });
  }

  async function addPlayer() {
    if (!currentTournament) return;
    const input = $('#new-player-name');
    const name = input.value.trim();
    if (!name) { toast('Entrez un nom', 'error'); input.focus(); return; }
    try {
      await api(`/tournaments/${currentTournament.id}/players`, { method: 'POST', body: { name } });
      input.value = '';
      input.focus();
      await refreshTournament(currentTournament.id);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function removePlayer(tid, pid) {
    try {
      await api(`/tournaments/${tid}/players/${pid}`, { method: 'DELETE' });
      await refreshTournament(tid);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function generateMatches() {
    if (!currentTournament) return;
    try {
      const t = await api(`/tournaments/${currentTournament.id}/generate`, { method: 'POST' });
      currentTournament = t;
      toast('Matchs générés ! ⚡');
      showTournamentView(t);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Tournament View ─────────────────────────────────────────────────────

  function showTournamentView(t) {
    navigate('view-tournament', `🏆 ${t.name}`);

    // Show/hide bracket tab
    const bracketBtn = $('#tab-bracket-btn');
    if (t.format === 'knockout') { show(bracketBtn); } else { hide(bracketBtn); }

    renderMatches(t);
    renderStandings(t.id);
    if (t.format === 'knockout') renderBracket(t);

    // Activate first tab
    activateTab('matches');
    startPolling();
  }

  function renderMatches(t) {
    const container = $('#rounds-container');
    if (!t.matches || !t.matches.length) {
      container.innerHTML = '<p class="text-muted text-center">Aucun match</p>';
      return;
    }

    // Group by round
    const rounds = {};
    t.matches.forEach(m => {
      if (!rounds[m.round]) rounds[m.round] = [];
      rounds[m.round].push(m);
    });

    const totalRounds = Object.keys(rounds).length;

    container.innerHTML = Object.entries(rounds).map(([round, matches]) => {
      let roundLabel = `Tour ${round}`;
      if (t.format === 'knockout') {
        const remaining = matches.length;
        if (remaining === 1) roundLabel = '🏆 Finale';
        else if (remaining === 2) roundLabel = 'Demi-finales';
        else if (remaining === 4) roundLabel = 'Quarts de finale';
        else roundLabel = `Tour ${round}`;
      }
      return `
        <div class="card round-card">
          <h3 class="round-title">${roundLabel}</h3>
          <div class="match-list">
            ${matches.map(m => renderMatchCard(m)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Bind click on pending matches
    container.querySelectorAll('.match-card[data-mid]').forEach(el => {
      el.addEventListener('click', () => {
        const mid = parseInt(el.dataset.mid);
        const match = t.matches.find(m => m.id === mid);
        if (match && match.status === 'pending') openScoreModal(match);
      });
    });
  }

  function renderMatchCard(m) {
    const isBye = m.player1_id === m.player2_id;
    const isPending = m.status === 'pending';
    const statusClass = isPending ? 'match-pending' : 'match-completed';

    if (isBye) {
      return `
        <div class="match-card match-bye">
          <div class="match-players">
            <span class="match-player">${esc(m.player1_name)}</span>
            <span class="match-bye-label">— BYE —</span>
          </div>
        </div>
      `;
    }

    let scoreHtml = '';
    if (!isPending) {
      const w1 = m.score1 > m.score2;
      const w2 = m.score2 > m.score1;
      scoreHtml = `
        <div class="match-score">
          <span class="score ${w1 ? 'score-winner' : ''}">${m.score1}</span>
          <span class="score-sep">-</span>
          <span class="score ${w2 ? 'score-winner' : ''}">${m.score2}</span>
        </div>
      `;
    } else {
      scoreHtml = '<div class="match-score"><span class="match-tap">Tap pour scorer</span></div>';
    }

    return `
      <div class="match-card ${statusClass}" data-mid="${m.id}" ${isPending ? 'role="button" tabindex="0"' : ''}>
        <div class="match-players">
          <span class="match-player ${!isPending && m.score1 > m.score2 ? 'player-winner' : ''}">${esc(m.player1_name)}</span>
          <span class="match-vs">vs</span>
          <span class="match-player ${!isPending && m.score2 > m.score1 ? 'player-winner' : ''}">${esc(m.player2_name)}</span>
        </div>
        ${scoreHtml}
      </div>
    `;
  }

  // ─── Standings ────────────────────────────────────────────────────────────

  async function renderStandings(tid) {
    try {
      const standings = await api(`/tournaments/${tid}/standings`);
      const wrapper = $('#standings-table-wrapper');

      if (!standings.length) {
        wrapper.innerHTML = '<p class="text-muted text-center">Pas de données</p>';
        return;
      }

      wrapper.innerHTML = `
        <div class="standings-list">
          ${standings.map((s, i) => {
            let medal = '';
            if (i === 0) medal = '🥇';
            else if (i === 1) medal = '🥈';
            else if (i === 2) medal = '🥉';
            else medal = `<span class="rank-num">${i + 1}</span>`;
            return `
              <div class="standing-row ${i < 3 ? 'standing-top' : ''}">
                <div class="standing-rank">${medal}</div>
                <div class="standing-info">
                  <div class="standing-name">${esc(s.name)}</div>
                  <div class="standing-meta">${s.played}J ${s.wins}V ${s.draws}N ${s.losses}D • ${s.goals_for}:${s.goals_against} (${s.goal_diff >= 0 ? '+' : ''}${s.goal_diff})</div>
                </div>
                <div class="standing-points">${s.points}<small>pts</small></div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (e) { /* silent */ }
  }

  // ─── Bracket (Knockout) ───────────────────────────────────────────────────

  function renderBracket(t) {
    const container = $('#bracket-container');
    if (t.format !== 'knockout') { container.innerHTML = ''; return; }

    const rounds = {};
    t.matches.forEach(m => {
      if (!rounds[m.round]) rounds[m.round] = [];
      rounds[m.round].push(m);
    });

    container.innerHTML = `
      <div class="bracket">
        ${Object.entries(rounds).map(([round, matches]) => `
          <div class="bracket-round">
            <div class="bracket-round-label">Tour ${round}</div>
            ${matches.map(m => {
              const isBye = m.player1_id === m.player2_id;
              return `
                <div class="bracket-match ${m.status === 'completed' ? 'bracket-done' : ''}">
                  <div class="bracket-slot ${!isBye && m.status === 'completed' && m.score1 > m.score2 ? 'bracket-winner' : ''}">
                    <span>${esc(m.player1_name)}</span>
                    ${m.status === 'completed' && !isBye ? `<span class="bracket-score">${m.score1}</span>` : ''}
                  </div>
                  <div class="bracket-slot ${!isBye && m.status === 'completed' && m.score2 > m.score1 ? 'bracket-winner' : ''}">
                    ${isBye ? '<span class="text-muted">BYE</span>' : `<span>${esc(m.player2_name)}</span>`}
                    ${m.status === 'completed' && !isBye ? `<span class="bracket-score">${m.score2}</span>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `).join('')}
      </div>
    `;
  }

  // ─── Score Modal ──────────────────────────────────────────────────────────

  let currentMatch = null;

  function openScoreModal(match) {
    currentMatch = match;
    $('#modal-p1-name').textContent = match.player1_name;
    $('#modal-p2-name').textContent = match.player2_name;
    $('#score1').value = 0;
    $('#score2').value = 0;
    show('#score-modal');
  }

  function closeScoreModal() {
    hide('#score-modal');
    currentMatch = null;
  }

  async function saveScore() {
    if (!currentMatch) return;
    const s1 = parseInt($('#score1').value) || 0;
    const s2 = parseInt($('#score2').value) || 0;
    try {
      await api(`/matches/${currentMatch.id}/score`, { method: 'PUT', body: { score1: s1, score2: s2 } });
      closeScoreModal();
      toast('Score enregistré ! ⚽');
      await refreshTournament(currentTournament.id);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Tabs ─────────────────────────────────────────────────────────────────

  function activateTab(tabName) {
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    const tc = $(`#tab-${tabName}`);
    if (tc) tc.classList.add('active');
  }

  // ─── Stepper ──────────────────────────────────────────────────────────────

  function handleStepper(e) {
    const btn = e.target.closest('.stepper-btn');
    if (!btn) return;
    const target = $(`#${btn.dataset.target}`);
    const delta = parseInt(btn.dataset.delta);
    let val = parseInt(target.value) || 0;
    val = Math.max(0, Math.min(99, val + delta));
    target.value = val;
  }

  // ─── Escape HTML ──────────────────────────────────────────────────────────

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ─── Event Bindings ───────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    // Home
    $('#btn-create-tournament').addEventListener('click', createTournament);
    $('#btn-seed-rr').addEventListener('click', () => seedDemo('round-robin'));
    $('#btn-seed-ko').addEventListener('click', () => seedDemo('knockout'));
    $('#btn-refresh-list').addEventListener('click', loadTournaments);

    // Back
    $('#btn-back').addEventListener('click', () => {
      if (currentTournament && currentTournament.status === 'setup') {
        currentTournament = null;
        navigate('view-home');
        loadTournaments();
      } else if (currentTournament) {
        stopPolling();
        currentTournament = null;
        navigate('view-home');
        loadTournaments();
      } else {
        navigate('view-home');
        loadTournaments();
      }
    });

    // Setup
    $('#btn-add-player').addEventListener('click', addPlayer);
    $('#new-player-name').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });
    $('#btn-generate').addEventListener('click', generateMatches);

    // Tabs
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });

    // Score modal
    $('#btn-cancel-score').addEventListener('click', closeScoreModal);
    $('#btn-save-score').addEventListener('click', saveScore);
    $('#score-modal').addEventListener('click', e => {
      if (e.target === $('#score-modal')) closeScoreModal();
    });

    // Steppers
    document.addEventListener('click', handleStepper);

    // Enter on tournament name
    $('#new-tournament-name').addEventListener('keydown', e => { if (e.key === 'Enter') createTournament(); });

    // Initial load
    loadTournaments();
  });

})();
