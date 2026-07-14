// MageStone multiplayer server: accounts + game rooms + live state relay.
// Pure WebSocket JSON protocol. Passwords are scrypt-hashed; users persist to a
// JSON file; game rooms live in memory. The server never runs the game engine —
// it relays the authoritative GameState that the acting client broadcasts.
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

/** username(lowercase) -> { salt, hash, display } */
let users = {};
if (existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
  } catch {
    users = {};
  }
}
const saveUsers = () => writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

// Win/loss records per account, for the main-menu leaderboard. Persist to
// Postgres in production, a JSON file in dev — same shape either way.
const STATS_FILE = join(DATA_DIR, 'stats.json');
/** key(lowercase) -> { display, played, won, lost } */
let statsMem = {};
if (existsSync(STATS_FILE)) {
  try {
    statsMem = JSON.parse(readFileSync(STATS_FILE, 'utf8'));
  } catch {
    statsMem = {};
  }
}
const saveStats = () => writeFileSync(STATS_FILE, JSON.stringify(statsMem, null, 2));

// Accounts persist to Postgres when DATABASE_URL is set (production), else to the
// local JSON file (dev). Same tiny interface either way: getUser / putUser.
const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL
  ? new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;
if (pool) pool.on('error', (e) => console.error('pg pool error:', e.message));

async function initStore() {
  if (!pool) {
    console.log('Using local file for accounts (set DATABASE_URL for a real DB).');
    return;
  }
  await pool.query(
    'CREATE TABLE IF NOT EXISTS users (key text PRIMARY KEY, salt text NOT NULL, hash text NOT NULL, display text NOT NULL)',
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS stats (key text PRIMARY KEY, display text NOT NULL, played int NOT NULL DEFAULT 0, won int NOT NULL DEFAULT 0, lost int NOT NULL DEFAULT 0)',
  );
  // Ranked/ELO columns (added later — grow the existing table in place).
  await pool.query('ALTER TABLE stats ADD COLUMN IF NOT EXISTS elo int');
  await pool.query('ALTER TABLE stats ADD COLUMN IF NOT EXISTS rankedplayed int NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE stats ADD COLUMN IF NOT EXISTS rankedwon int NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE stats ADD COLUMN IF NOT EXISTS rankedlost int NOT NULL DEFAULT 0');
  // Alpha feedback + print-and-play interest list.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS feedback (id serial PRIMARY KEY, created timestamptz DEFAULT now(),
     username text, enjoy text, confuse text, change text, duration text, players text,
     finished text, victory text, bug text)`,
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS pnp (email text PRIMARY KEY, created timestamptz DEFAULT now())',
  );
  console.log('Using Postgres for accounts.');
}

// Feedback + PnP signups fall back to local JSON files in dev.
const FEEDBACK_FILE = join(DATA_DIR, 'feedback.json');
const PNP_FILE = join(DATA_DIR, 'pnp.json');
const appendJson = (file, entry) => {
  let list = [];
  try {
    if (existsSync(file)) list = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    list = [];
  }
  list.push(entry);
  writeFileSync(file, JSON.stringify(list, null, 2));
};
async function saveFeedback(f) {
  if (pool) {
    await pool.query(
      `INSERT INTO feedback(username, enjoy, confuse, change, duration, players, finished, victory, bug)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [f.username, f.enjoy, f.confuse, f.change, f.duration, f.players, f.finished, f.victory, f.bug],
    );
  } else {
    appendJson(FEEDBACK_FILE, { ...f, created: new Date().toISOString() });
  }
}
async function savePnp(email) {
  if (pool) {
    await pool.query('INSERT INTO pnp(email) VALUES($1) ON CONFLICT (email) DO NOTHING', [email]);
  } else {
    appendJson(PNP_FILE, { email, created: new Date().toISOString() });
  }
}

// ---- ELO (ranked play only) ------------------------------------------------
// Ratings live on the 1000–2400 ladder and move ONLY for ranked matches — real
// opponent vs real opponent, paired by the ranked queue. Casual and bot games
// never touch them. New ranked players enter at 1200.
const ELO_MIN = 1000;
const ELO_MAX = 2400;
const ELO_START = 1200;
const ELO_K = 32;
const clampElo = (v) => Math.max(ELO_MIN, Math.min(ELO_MAX, Math.round(v)));
function eloPair(winnerElo, loserElo) {
  const expWin = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  return [
    clampElo(winnerElo + ELO_K * (1 - expWin)),
    clampElo(loserElo + ELO_K * (0 - (1 - expWin))),
  ];
}

/** Record one finished game for an account: +1 played, +1 won or +1 lost. */
async function bumpStats(key, display, won) {
  if (pool) {
    await pool.query(
      `INSERT INTO stats(key, display, played, won, lost) VALUES($1, $2, 1, $3, $4)
       ON CONFLICT (key) DO UPDATE SET
         played = stats.played + 1,
         won = stats.won + $3,
         lost = stats.lost + $4,
         display = EXCLUDED.display`,
      [key, display, won ? 1 : 0, won ? 0 : 1],
    );
  } else {
    const st = statsMem[key] || { display, played: 0, won: 0, lost: 0 };
    st.display = display;
    st.played += 1;
    if (won) st.won += 1;
    else st.lost += 1;
    statsMem[key] = st;
    saveStats();
  }
}
/** Write one ranked result: new ELO plus ranked played/won/lost counters. */
async function bumpRanked(key, display, won, newElo) {
  if (pool) {
    await pool.query(
      `INSERT INTO stats(key, display, played, won, lost, elo, rankedplayed, rankedwon, rankedlost)
       VALUES($1, $2, 0, 0, 0, $3, 1, $4, $5)
       ON CONFLICT (key) DO UPDATE SET
         elo = $3,
         rankedplayed = stats.rankedplayed + 1,
         rankedwon = stats.rankedwon + $4,
         rankedlost = stats.rankedlost + $5,
         display = EXCLUDED.display`,
      [key, display, newElo, won ? 1 : 0, won ? 0 : 1],
    );
  } else {
    const st = statsMem[key] || { display, played: 0, won: 0, lost: 0 };
    st.display = display;
    st.elo = newElo;
    st.rankedplayed = (st.rankedplayed || 0) + 1;
    if (won) st.rankedwon = (st.rankedwon || 0) + 1;
    else st.rankedlost = (st.rankedlost || 0) + 1;
    statsMem[key] = st;
    saveStats();
  }
}
/** Top ranked players by ELO (only accounts that have played ranked). */
async function topElo(limit) {
  if (pool) {
    const r = await pool.query(
      `SELECT display, elo, rankedplayed AS "rankedPlayed", rankedwon AS "rankedWon", rankedlost AS "rankedLost"
       FROM stats WHERE elo IS NOT NULL ORDER BY elo DESC, display ASC LIMIT $1`,
      [limit],
    );
    return r.rows;
  }
  return Object.values(statsMem)
    .filter((v) => v.elo != null)
    .map((v) => ({
      display: v.display,
      elo: v.elo,
      rankedPlayed: v.rankedplayed || 0,
      rankedWon: v.rankedwon || 0,
      rankedLost: v.rankedlost || 0,
    }))
    .sort((a, b) => b.elo - a.elo || a.display.localeCompare(b.display))
    .slice(0, limit);
}
async function topStats(limit) {
  if (pool) {
    const r = await pool.query(
      'SELECT key, display, played, won, lost FROM stats ORDER BY won DESC, played DESC, display ASC LIMIT $1',
      [limit],
    );
    return r.rows;
  }
  return Object.entries(statsMem)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.won - a.won || b.played - a.played || a.display.localeCompare(b.display))
    .slice(0, limit);
}
async function getStat(key) {
  if (!key) return null;
  if (pool) {
    const r = await pool.query(
      `SELECT key, display, played, won, lost, elo,
              rankedplayed AS "rankedPlayed", rankedwon AS "rankedWon", rankedlost AS "rankedLost"
       FROM stats WHERE key = $1`,
      [key],
    );
    return r.rows[0] || null;
  }
  if (!statsMem[key]) return null;
  const v = statsMem[key];
  return {
    key,
    ...v,
    rankedPlayed: v.rankedplayed || 0,
    rankedWon: v.rankedwon || 0,
    rankedLost: v.rankedlost || 0,
  };
}
/** Alpha metrics: how many accounts have played a game, and how many exist. */
async function getTotals() {
  if (pool) {
    const p = await pool.query('SELECT count(*)::int AS n FROM stats');
    const u = await pool.query('SELECT count(*)::int AS n FROM users');
    return { players: p.rows[0].n, signups: u.rows[0].n };
  }
  return { players: Object.keys(statsMem).length, signups: Object.keys(users).length };
}

/** When a game ends, credit each HUMAN player: the winner's colour wins, the
 *  rest lose. Bots have no account, so they're skipped — but a human's result
 *  counts whether the opponents were people or bots. Ranked rooms ALSO move
 *  both players' ELO — only there, only human vs human. */
async function recordResult(g, winnerColor) {
  for (const p of g.players) {
    if (p.bot || !p.username || p.username.startsWith('bot:')) continue;
    if (p.username.startsWith('guest:')) continue; // guests have no account row
    await bumpStats(p.username, p.display, p.color === winnerColor);
  }
  if (!g.ranked) return;
  const humans = g.players.filter((p) => !p.bot && p.username && !p.username.startsWith('bot:'));
  if (humans.length !== 2) return; // ranked is strictly 1v1 between real accounts
  const winner = humans.find((p) => p.color === winnerColor);
  const loser = humans.find((p) => p.color !== winnerColor);
  if (!winner || !loser) return;
  const wStat = await getStat(winner.username);
  const lStat = await getStat(loser.username);
  const wElo = wStat?.elo ?? ELO_START;
  const lElo = lStat?.elo ?? ELO_START;
  const [wNew, lNew] = eloPair(wElo, lElo);
  await bumpRanked(winner.username, winner.display, true, wNew);
  await bumpRanked(loser.username, loser.display, false, lNew);
  console.log(`ranked: ${winner.display} ${wElo}->${wNew}, ${loser.display} ${lElo}->${lNew}`);
}
async function getUser(key) {
  if (pool) {
    const r = await pool.query('SELECT salt, hash, display FROM users WHERE key = $1', [key]);
    return r.rows[0] || null;
  }
  return users[key] || null;
}
async function putUser(key, u) {
  if (pool) {
    await pool.query(
      'INSERT INTO users(key, salt, hash, display) VALUES($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING',
      [key, u.salt, u.hash, u.display],
    );
  } else {
    users[key] = u;
    saveUsers();
  }
}

const hashPw = (pw, salt) => scryptSync(pw, salt, 64).toString('hex');
const makeUser = (pw, display) => {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: hashPw(pw, salt), display };
};
function checkPw(user, pw) {
  const a = Buffer.from(hashPw(pw, user.salt), 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const tokens = new Map(); // token -> username key
const sockets = new Map(); // ws -> { username, gameId }

const PLAYER_SETS = { 2: ['red', 'green'], 3: ['red', 'blue', 'green'], 4: ['red', 'blue', 'green', 'yellow'] };
const colorsFor = (n) => PLAYER_SETS[n] || PLAYER_SETS[4];

const games = new Map(); // gameId -> room
function genId() {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 7).toUpperCase();
  } while (games.has(id));
  return id;
}

const send = (ws, msg) => {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket closing */
  }
};
const lobbyMsg = (g) => ({
  t: 'lobby',
  gameId: g.id,
  host: g.host,
  playerCount: g.playerCount,
  started: g.started,
  ranked: !!g.ranked,
  hasPass: !!g.hasPass,
  players: g.players.map((p) => ({
    username: p.display,
    color: p.color,
    online: !!p.ws || !!p.bot,
    bot: p.bot || null,
  })),
});
const broadcastLobby = (g) => g.players.forEach((p) => p.ws && send(p.ws, lobbyMsg(g)));
const broadcast = (g, msg, exceptWs) =>
  g.players.forEach((p) => p.ws && p.ws !== exceptWs && send(p.ws, msg));

function authSuccess(ws, s, key, display) {
  const token = randomBytes(24).toString('hex');
  tokens.set(token, key);
  s.username = key;
  s.display = display;
  send(ws, { t: 'authOk', username: display, token });
}

function joinRoom(ws, s, g) {
  s.gameId = g.id;
  let p = g.players.find((p) => p.username === s.username);
  if (!p) {
    const used = new Set(g.players.map((p) => p.color));
    const color = colorsFor(g.playerCount).find((c) => !used.has(c));
    p = { username: s.username, display: s.display, color, ws };
    g.players.push(p);
  } else {
    p.ws = ws; // reconnect
  }
  send(ws, { t: 'joined', gameId: g.id, myColor: p.color });
  if (g.started && g.state) {
    send(ws, {
      t: 'started',
      state: g.state,
      players: g.players.map((p) => ({ username: p.display, color: p.color, bot: p.bot || null })),
    });
  }
  broadcastLobby(g);
}

function leaveRoom(ws, s) {
  const g = games.get(s.gameId);
  s.gameId = null;
  if (!g) return;
  g.players = g.players.filter((p) => p.ws !== ws);
  // A room of only bots has nobody left to play (or host) it — tear it down.
  if (!g.players.some((p) => !p.bot)) games.delete(g.id);
  else broadcastLobby(g);
}

// ---- Ranked matchmaking ----------------------------------------------------
// A simple FIFO queue of signed-in players. As soon as two DIFFERENT accounts
// are waiting, the server creates a locked 1v1 room flagged `ranked` and seats
// both; the first-queued player is host (their client then auto-starts it).
const rankedQueue = []; // [{ ws, s }]
function dropFromQueue(ws) {
  const i = rankedQueue.findIndex((q) => q.ws === ws);
  if (i >= 0) rankedQueue.splice(i, 1);
}
function tryPairRanked() {
  while (rankedQueue.length >= 2) {
    const a = rankedQueue.shift();
    if (a.ws.readyState !== 1) continue; // socket gone — drop and keep pairing
    const bi = rankedQueue.findIndex((q) => q.s.username !== a.s.username && q.ws.readyState === 1);
    if (bi < 0) {
      rankedQueue.unshift(a);
      return;
    }
    const [b] = rankedQueue.splice(bi, 1);
    const salt = randomBytes(12).toString('hex');
    const g = {
      id: genId(),
      host: a.s.display,
      passSalt: salt,
      // random password nobody knows — ranked rooms can't be joined by ID
      passHash: hashPw(randomBytes(16).toString('hex'), salt),
      playerCount: 2,
      players: [],
      state: null,
      started: false,
      ranked: true,
    };
    games.set(g.id, g);
    joinRoom(a.ws, a.s, g);
    joinRoom(b.ws, b.s, g);
  }
}

async function handle(ws, s, m) {
  switch (m.t) {
    case 'signup': {
      const display = (m.username || '').trim();
      const key = display.toLowerCase();
      if (display.length < 3) return send(ws, { t: 'authErr', message: 'Username must be at least 3 characters.' });
      if ((m.password || '').length < 4) return send(ws, { t: 'authErr', message: 'Password must be at least 4 characters.' });
      if (await getUser(key)) return send(ws, { t: 'authErr', message: 'That username is taken.' });
      await putUser(key, makeUser(m.password, display));
      return authSuccess(ws, s, key, display);
    }
    case 'signin': {
      const key = (m.username || '').trim().toLowerCase();
      const user = await getUser(key);
      if (!user || !checkPw(user, m.password || '')) return send(ws, { t: 'authErr', message: 'Wrong username or password.' });
      return authSuccess(ws, s, key, user.display || key);
    }
    case 'auth': {
      const key = tokens.get(m.token);
      const user = key ? await getUser(key) : null;
      if (!user) return send(ws, { t: 'authErr', message: 'Session expired — sign in again.' });
      s.username = key;
      s.display = user.display || key;
      return send(ws, { t: 'authOk', username: s.display, token: m.token });
    }
    case 'guest': {
      // Account-free alpha play: a display name is all that's needed. The key
      // is namespaced + randomised so guests can never collide with accounts
      // (and never touch stats or ELO — see recordResult / findRanked).
      const name = (m.name || '').trim().slice(0, 20);
      if (name.length < 2) return send(ws, { t: 'authErr', message: 'Pick a name (2+ characters).' });
      s.username = `guest:${name.toLowerCase()}#${randomBytes(3).toString('hex')}`;
      s.display = name;
      s.guest = true;
      return send(ws, { t: 'guestOk', username: name });
    }
    case 'createGame': {
      if (!s.username) return send(ws, { t: 'error', message: 'Not signed in.' });
      const pc = [2, 3, 4].includes(m.playerCount) ? m.playerCount : 2;
      const salt = randomBytes(12).toString('hex');
      const g = {
        id: genId(),
        host: s.display,
        passSalt: salt,
        passHash: hashPw(m.password || '', salt),
        hasPass: !!(m.password && m.password.length),
        playerCount: pc,
        players: [],
        state: null,
        started: false,
      };
      games.set(g.id, g);
      return joinRoom(ws, s, g);
    }
    case 'joinGame': {
      if (!s.username) return send(ws, { t: 'error', message: 'Not signed in.' });
      const g = games.get((m.gameId || '').toUpperCase().trim());
      if (!g) return send(ws, { t: 'joinErr', message: 'No game with that ID.' });
      const existing = g.players.find((p) => p.username === s.username);
      if (!existing) {
        if (hashPw(m.password || '', g.passSalt) !== g.passHash) return send(ws, { t: 'joinErr', message: 'Wrong game password.' });
        if (g.started) return send(ws, { t: 'joinErr', message: 'That game has already started.' });
        if (g.players.length >= g.playerCount) return send(ws, { t: 'joinErr', message: 'That game is full.' });
      }
      return joinRoom(ws, s, g);
    }
    case 'addBot': {
      // Host fills an empty seat with an AI bot (it counts as a joined player,
      // so the game can start; the host's client executes its turns).
      const g = games.get(s.gameId);
      if (!g || g.started) return;
      if (g.host !== s.display) return send(ws, { t: 'error', message: 'Only the host can add bots.' });
      if (g.players.length >= g.playerCount) return send(ws, { t: 'error', message: 'The game is already full.' });
      const level = ['easy', 'medium', 'hard'].includes(m.level) ? m.level : 'medium';
      const used = new Set(g.players.map((p) => p.color));
      const color = colorsFor(g.playerCount).find((c) => !used.has(c));
      const n = g.players.filter((p) => p.bot).length + 1;
      g.players.push({
        username: `bot:${color}`,
        display: `Bot ${n} · ${level[0].toUpperCase()}${level.slice(1)}`,
        color,
        ws: null,
        bot: level,
      });
      return broadcastLobby(g);
    }
    case 'removeBot': {
      const g = games.get(s.gameId);
      if (!g || g.started) return;
      if (g.host !== s.display) return;
      const i = g.players.findIndex((p) => p.bot && p.color === m.color);
      if (i >= 0) {
        g.players.splice(i, 1);
        broadcastLobby(g);
      }
      return;
    }
    case 'startGame': {
      const g = games.get(s.gameId);
      if (!g) return;
      if (g.host !== s.display) return send(ws, { t: 'error', message: 'Only the host can start.' });
      if (g.players.length < g.playerCount) return send(ws, { t: 'error', message: 'Waiting for all players to join.' });
      g.started = true;
      g.state = m.state;
      const players = g.players.map((p) => ({ username: p.display, color: p.color, bot: p.bot || null }));
      g.players.forEach((p) => p.ws && send(p.ws, { t: 'started', state: m.state, players }));
      return;
    }
    case 'state': {
      const g = games.get(s.gameId);
      if (!g || !g.started) return;
      if (!g.players.some((p) => p.username === s.username)) return;
      g.state = m.state; // keep latest for reconnects
      // Record the result once, the first time a winner appears in the state.
      if (m.state && m.state.winner && !g.recorded) {
        g.recorded = true;
        recordResult(g, m.state.winner).catch((e) => console.error('stats error:', e.message));
      }
      return broadcast(g, { t: 'state', state: m.state }, ws);
    }
    case 'leaderboard': {
      // Public: the top table, alpha totals, plus (if signed in) the requester's own row.
      const top = await topStats(10);
      const me = s.username ? await getStat(s.username) : null;
      const totals = await getTotals();
      const elo = await topElo(10);
      const row = (r) => ({
        username: r.display,
        played: r.played,
        won: r.won,
        lost: r.lost,
        elo: r.elo ?? null,
        rankedPlayed: r.rankedPlayed || 0,
        rankedWon: r.rankedWon || 0,
        rankedLost: r.rankedLost || 0,
      });
      return send(ws, {
        t: 'leaderboard',
        top: top.map(row),
        eloTop: elo.map((r) => ({
          username: r.display,
          elo: r.elo,
          rankedPlayed: r.rankedPlayed,
          rankedWon: r.rankedWon,
          rankedLost: r.rankedLost,
        })),
        me: me ? row(me) : null,
        players: totals.players,
        signups: totals.signups,
      });
    }
    case 'findRanked': {
      if (!s.username) return send(ws, { t: 'error', message: 'Sign in to play Ranked.' });
      if (s.guest) return send(ws, { t: 'error', message: 'Ranked play needs an account — sign up free to earn an ELO rating.' });
      if (s.gameId) leaveRoom(ws, s); // a queued player can't sit in another room
      dropFromQueue(ws);
      rankedQueue.push({ ws, s });
      send(ws, { t: 'rankedSearching' });
      return tryPairRanked();
    }
    case 'cancelRanked': {
      dropFromQueue(ws);
      return send(ws, { t: 'rankedCancelled' });
    }
    case 'feedback': {
      const cap = (v) => (typeof v === 'string' ? v.slice(0, 2000) : null);
      await saveFeedback({
        username: s.display || null,
        enjoy: cap(m.enjoy),
        confuse: cap(m.confuse),
        change: cap(m.change),
        duration: cap(m.duration),
        players: cap(m.players),
        finished: cap(m.finished),
        victory: cap(m.victory),
        bug: cap(m.bug),
      });
      return send(ws, { t: 'feedbackOk' });
    }
    case 'pnp': {
      const email = (m.email || '').trim().toLowerCase().slice(0, 120);
      if (!/^\S+@\S+\.\S+$/.test(email)) return send(ws, { t: 'error', message: 'Enter a valid email address.' });
      await savePnp(email);
      return send(ws, { t: 'pnpOk' });
    }
    case 'leaveGame':
      return leaveRoom(ws, s);
  }
}

// Serve the built frontend (dist/) from the same server, so one deployment hosts
// both the site and the WebSocket. In dev (no dist/ yet) it just reports status.
const DIST = join(__dirname, '..', 'dist');
const HAS_DIST = existsSync(join(DIST, 'index.html'));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};
const httpServer = createServer((req, res) => {
  if (!HAS_DIST) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('MageStone multiplayer server (run `npm run build` to serve the app here too)');
  }
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    /* keep default */
  }
  let file = join(DIST, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  let data;
  try {
    data = readFileSync(file);
  } catch {
    // Crawlable extensionless routes (/how-to-play, /rules, /play, /about)
    // map to their static .html pages before the SPA fallback.
    try {
      if (!pathname.includes('.')) {
        file = join(DIST, `${pathname.replace(/\/$/, '')}.html`);
        data = readFileSync(file);
      } else {
        throw new Error('no ext match');
      }
    } catch {
      file = join(DIST, 'index.html'); // SPA fallback
      data = readFileSync(file);
    }
  }
  const ext = file.slice(file.lastIndexOf('.'));
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  res.end(data);
});
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  sockets.set(ws, { username: null, display: null, gameId: null });
  ws.on('message', (data) => {
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    Promise.resolve(handle(ws, sockets.get(ws), m)).catch((e) => {
      console.error('handler error:', e.message);
      send(ws, { t: 'error', message: 'Server error — try again.' });
    });
  });
  ws.on('close', () => {
    dropFromQueue(ws); // a queued ranked searcher who disconnects stops waiting
    const s = sockets.get(ws);
    if (s?.gameId) {
      const g = games.get(s.gameId);
      if (g) {
        const p = g.players.find((p) => p.ws === ws);
        if (p) p.ws = null; // keep the slot for reconnect
        if (g.players.every((p) => !p.ws)) games.delete(g.id);
        else broadcastLobby(g);
      }
    }
    sockets.delete(ws);
  });
});

const PORT = process.env.PORT || 8787;
initStore()
  .then(() => httpServer.listen(PORT, () => console.log(`MageStone server listening on :${PORT}`)))
  .catch((e) => {
    console.error('Failed to initialise the accounts database:', e.message);
    process.exit(1);
  });
