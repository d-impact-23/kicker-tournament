const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'tournament.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    format TEXT NOT NULL CHECK(format IN ('round-robin', 'knockout')),
    status TEXT NOT NULL DEFAULT 'setup' CHECK(status IN ('setup', 'active', 'completed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER NOT NULL,
    score1 INTEGER DEFAULT NULL,
    score2 INTEGER DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
    round INTEGER NOT NULL DEFAULT 1,
    match_order INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (player1_id) REFERENCES players(id),
    FOREIGN KEY (player2_id) REFERENCES players(id)
  );
`);

// ─── Tournaments ────────────────────────────────────────────────────────────

function createTournament(name, format) {
  const stmt = db.prepare('INSERT INTO tournaments (name, format) VALUES (?, ?)');
  const result = stmt.run(name, format);
  return getTournament(result.lastInsertRowid);
}

function getTournaments() {
  return db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM players WHERE tournament_id = t.id) AS player_count,
      (SELECT COUNT(*) FROM matches WHERE tournament_id = t.id) AS match_count,
      (SELECT COUNT(*) FROM matches WHERE tournament_id = t.id AND status = 'completed') AS completed_matches
    FROM tournaments t
    ORDER BY t.created_at DESC
  `).all();
}

function getTournament(id) {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  if (!tournament) return null;

  tournament.players = db.prepare('SELECT * FROM players WHERE tournament_id = ? ORDER BY name').all(id);
  tournament.matches = db.prepare(`
    SELECT m.*,
      p1.name AS player1_name,
      p2.name AS player2_name
    FROM matches m
    JOIN players p1 ON m.player1_id = p1.id
    JOIN players p2 ON m.player2_id = p2.id
    WHERE m.tournament_id = ?
    ORDER BY m.round, m.match_order
  `).all(id);

  return tournament;
}

// ─── Players ─────────────────────────────────────────────────────────────────

function addPlayer(tournamentId, name) {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw new Error('Tournament not found');
  if (tournament.status !== 'setup') throw new Error('Cannot add players after tournament has started');

  const stmt = db.prepare('INSERT INTO players (tournament_id, name) VALUES (?, ?)');
  const result = stmt.run(tournamentId, name);
  return db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
}

function removePlayer(tournamentId, playerId) {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw new Error('Tournament not found');
  if (tournament.status !== 'setup') throw new Error('Cannot remove players after tournament has started');

  const result = db.prepare('DELETE FROM players WHERE id = ? AND tournament_id = ?').run(playerId, tournamentId);
  return result.changes > 0;
}

// ─── Match Generation ─────────────────────────────────────────────────────────

function generateRoundRobin(tournamentId, players) {
  const insertMatch = db.prepare(
    'INSERT INTO matches (tournament_id, player1_id, player2_id, round, match_order) VALUES (?, ?, ?, ?, ?)'
  );

  // If odd number of players, add a "bye" — but we just skip byes here and pair everyone
  const n = players.length;
  let matchOrder = 1;
  let round = 1;

  // Use round-robin scheduling algorithm
  const playerList = [...players];
  if (n % 2 !== 0) {
    // Add a dummy player for bye — we'll handle it by not creating the match
    playerList.push(null);
  }

  const numRounds = playerList.length - 1;
  const half = playerList.length / 2;

  const insertMany = db.transaction(() => {
    for (let r = 0; r < numRounds; r++) {
      matchOrder = 1;
      for (let i = 0; i < half; i++) {
        const p1 = playerList[i];
        const p2 = playerList[playerList.length - 1 - i];
        if (p1 !== null && p2 !== null) {
          insertMatch.run(tournamentId, p1.id, p2.id, r + 1, matchOrder);
          matchOrder++;
        }
      }
      // Rotate players (keep first fixed)
      const last = playerList.pop();
      playerList.splice(1, 0, last);
      round++;
    }
  });

  insertMany();
}

function generateKnockout(tournamentId, players) {
  const insertMatch = db.prepare(
    'INSERT INTO matches (tournament_id, player1_id, player2_id, round, match_order) VALUES (?, ?, ?, ?, ?)'
  );

  // Shuffle players for random seeding
  const shuffled = [...players].sort(() => Math.random() - 0.5);

  // Find next power of 2
  const n = shuffled.length;
  let bracketSize = 1;
  while (bracketSize < n) bracketSize *= 2;

  // Add byes by filling with null
  while (shuffled.length < bracketSize) {
    shuffled.push(null);
  }

  // Generate first round matches
  const insertMany = db.transaction(() => {
    let matchOrder = 1;
    for (let i = 0; i < bracketSize; i += 2) {
      const p1 = shuffled[i];
      const p2 = shuffled[i + 1];

      if (p1 && p2) {
        insertMatch.run(tournamentId, p1.id, p2.id, 1, matchOrder);
      } else if (p1 && !p2) {
        // Bye - auto-advance p1, but still create a "bye match" as completed
        // We'll just not create placeholder matches; advancement handled in standings
        // For simplicity, we insert with a dummy score
        insertMatch.run(tournamentId, p1.id, p1.id, 1, matchOrder);
        // Mark as bye-completed immediately
        db.prepare('UPDATE matches SET score1=1, score2=0, status="completed" WHERE tournament_id=? AND round=1 AND match_order=?')
          .run(tournamentId, matchOrder);
      }
      matchOrder++;
    }
  });

  insertMany();
}

function generateMatches(tournamentId) {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw new Error('Tournament not found');
  if (tournament.status !== 'setup') throw new Error('Matches already generated');

  const players = db.prepare('SELECT * FROM players WHERE tournament_id = ? ORDER BY id').all(tournamentId);
  if (players.length < 2) throw new Error('Need at least 2 players');

  if (tournament.format === 'round-robin') {
    generateRoundRobin(tournamentId, players);
  } else {
    generateKnockout(tournamentId, players);
  }

  db.prepare("UPDATE tournaments SET status = 'active' WHERE id = ?").run(tournamentId);
  return getTournament(tournamentId);
}

// ─── Score Recording ──────────────────────────────────────────────────────────

function recordScore(matchId, score1, score2) {
  const match = db.prepare(`
    SELECT m.*, t.format, t.id AS tid
    FROM matches m
    JOIN tournaments t ON m.tournament_id = t.id
    WHERE m.id = ?
  `).get(matchId);

  if (!match) throw new Error('Match not found');

  db.prepare("UPDATE matches SET score1=?, score2=?, status='completed' WHERE id=?")
    .run(score1, score2, matchId);

  // For knockout: advance winner to next round
  if (match.format === 'knockout') {
    advanceKnockoutWinner(match, score1, score2);
  }

  // Check if tournament is completed
  const pendingMatches = db.prepare(
    "SELECT COUNT(*) AS cnt FROM matches WHERE tournament_id = ? AND status = 'pending'"
  ).get(match.tournament_id);

  if (pendingMatches.cnt === 0) {
    db.prepare("UPDATE tournaments SET status='completed' WHERE id=?").run(match.tournament_id);
  }

  return db.prepare(`
    SELECT m.*, p1.name AS player1_name, p2.name AS player2_name
    FROM matches m
    JOIN players p1 ON m.player1_id = p1.id
    JOIN players p2 ON m.player2_id = p2.id
    WHERE m.id = ?
  `).get(matchId);
}

function advanceKnockoutWinner(match, score1, score2) {
  const winnerId = score1 > score2 ? match.player1_id : match.player2_id;
  const nextRound = match.round + 1;
  // match_order of the next match: ceil(match_order / 2)
  const nextMatchOrder = Math.ceil(match.match_order / 2);

  // Check if next round match exists
  let nextMatch = db.prepare(
    'SELECT * FROM matches WHERE tournament_id=? AND round=? AND match_order=?'
  ).get(match.tournament_id, nextRound, nextMatchOrder);

  if (nextMatch) {
    // Fill in the slot
    if (!nextMatch.player1_id || nextMatch.player1_id === nextMatch.player2_id) {
      db.prepare('UPDATE matches SET player1_id=? WHERE id=?').run(winnerId, nextMatch.id);
    } else {
      db.prepare('UPDATE matches SET player2_id=? WHERE id=?').run(winnerId, nextMatch.id);
    }
  } else {
    // Create the next round match with this winner as first player
    // Check if there are more matches in the current round
    const totalInRound = db.prepare(
      'SELECT COUNT(*) AS cnt FROM matches WHERE tournament_id=? AND round=?'
    ).get(match.tournament_id, match.round).cnt;

    if (totalInRound > 1) {
      // Create next round placeholder
      db.prepare(
        'INSERT INTO matches (tournament_id, player1_id, player2_id, round, match_order) VALUES (?,?,?,?,?)'
      ).run(match.tournament_id, winnerId, winnerId, nextRound, nextMatchOrder);
    }
  }
}

// ─── Standings ───────────────────────────────────────────────────────────────

function getStandings(tournamentId) {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) throw new Error('Tournament not found');

  const players = db.prepare('SELECT * FROM players WHERE tournament_id = ?').all(tournamentId);
  const completedMatches = db.prepare(
    "SELECT * FROM matches WHERE tournament_id = ? AND status = 'completed'"
  ).all(tournamentId);

  const stats = {};
  players.forEach(p => {
    stats[p.id] = {
      id: p.id,
      name: p.name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_diff: 0,
      points: 0
    };
  });

  completedMatches.forEach(m => {
    // Skip bye matches (player1_id === player2_id)
    if (m.player1_id === m.player2_id) return;

    const p1 = stats[m.player1_id];
    const p2 = stats[m.player2_id];
    if (!p1 || !p2) return;

    p1.played++;
    p2.played++;
    p1.goals_for += m.score1;
    p1.goals_against += m.score2;
    p2.goals_for += m.score2;
    p2.goals_against += m.score1;

    if (m.score1 > m.score2) {
      p1.wins++; p1.points += 3;
      p2.losses++;
    } else if (m.score2 > m.score1) {
      p2.wins++; p2.points += 3;
      p1.losses++;
    } else {
      p1.draws++; p1.points += 1;
      p2.draws++; p2.points += 1;
    }
  });

  Object.values(stats).forEach(s => {
    s.goal_diff = s.goals_for - s.goals_against;
  });

  return Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
    if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
    return a.name.localeCompare(b.name);
  });
}

module.exports = {
  createTournament,
  getTournaments,
  getTournament,
  addPlayer,
  removePlayer,
  generateMatches,
  recordScore,
  getStandings
};
