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
  console.log('Using Postgres for accounts.');
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
    case 'createGame': {
      if (!s.username) return send(ws, { t: 'error', message: 'Not signed in.' });
      const pc = [2, 3, 4].includes(m.playerCount) ? m.playerCount : 2;
      const salt = randomBytes(12).toString('hex');
      const g = {
        id: genId(),
        host: s.display,
        passSalt: salt,
        passHash: hashPw(m.password || '', salt),
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
      return broadcast(g, { t: 'state', state: m.state }, ws);
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
    file = join(DIST, 'index.html'); // SPA fallback
    data = readFileSync(file);
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
