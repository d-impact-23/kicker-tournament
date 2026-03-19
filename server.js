const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helper ───────────────────────────────────────────────────────────────────

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ─── Tournament Routes ────────────────────────────────────────────────────────

// POST /api/tournaments - Create tournament
app.post('/api/tournaments', asyncHandler((req, res) => {
  const { name, format } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom du tournoi est requis' });
  }
  if (!['round-robin', 'knockout'].includes(format)) {
    return res.status(400).json({ error: 'Format invalide. Choisir: round-robin ou knockout' });
  }
  const tournament = db.createTournament(name.trim(), format);
  res.status(201).json(tournament);
}));

// GET /api/tournaments - List all tournaments
app.get('/api/tournaments', asyncHandler((req, res) => {
  const tournaments = db.getTournaments();
  res.json(tournaments);
}));

// GET /api/tournaments/:id - Get tournament details
app.get('/api/tournaments/:id', asyncHandler((req, res) => {
  const tournament = db.getTournament(parseInt(req.params.id));
  if (!tournament) {
    return res.status(404).json({ error: 'Tournoi introuvable' });
  }
  res.json(tournament);
}));

// POST /api/tournaments/:id/players - Add player
app.post('/api/tournaments/:id/players', asyncHandler((req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom du joueur est requis' });
  }
  const player = db.addPlayer(parseInt(req.params.id), name.trim());
  res.status(201).json(player);
}));

// DELETE /api/tournaments/:id/players/:playerId - Remove player
app.delete('/api/tournaments/:id/players/:playerId', asyncHandler((req, res) => {
  const removed = db.removePlayer(parseInt(req.params.id), parseInt(req.params.playerId));
  if (!removed) {
    return res.status(404).json({ error: 'Joueur introuvable' });
  }
  res.json({ success: true });
}));

// POST /api/tournaments/:id/generate - Generate matches
app.post('/api/tournaments/:id/generate', asyncHandler((req, res) => {
  const tournament = db.generateMatches(parseInt(req.params.id));
  res.json(tournament);
}));

// GET /api/tournaments/:id/standings - Get standings
app.get('/api/tournaments/:id/standings', asyncHandler((req, res) => {
  const standings = db.getStandings(parseInt(req.params.id));
  res.json(standings);
}));

// ─── Match Routes ─────────────────────────────────────────────────────────────

// PUT /api/matches/:id/score - Record score
app.put('/api/matches/:id/score', asyncHandler((req, res) => {
  const { score1, score2 } = req.body;
  if (score1 === undefined || score2 === undefined) {
    return res.status(400).json({ error: 'Les scores sont requis' });
  }
  if (!Number.isInteger(score1) || !Number.isInteger(score2) || score1 < 0 || score2 < 0) {
    return res.status(400).json({ error: 'Les scores doivent être des entiers positifs' });
  }
  const match = db.recordScore(parseInt(req.params.id), score1, score2);
  res.json(match);
}));

// ─── Seed Data ────────────────────────────────────────────────────────────────

app.post('/api/seed', asyncHandler((req, res) => {
  const { format = 'round-robin' } = req.body;

  const names = ['Alice', 'Bob', 'Carlos', 'Diana', 'Erik', 'Fatima', 'Guillaume', 'Hana'];
  const tournament = db.createTournament(
    format === 'knockout' ? '🏆 Tournoi Démo Knockout' : '⚽ Tournoi Démo Round-Robin',
    format
  );

  for (const name of names) {
    db.addPlayer(tournament.id, name);
  }

  const full = db.generateMatches(tournament.id);
  res.status(201).json(full);
}));

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(400).json({ error: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🏆 Kicker Tournament server running on http://localhost:${PORT}`);
});

module.exports = app;
