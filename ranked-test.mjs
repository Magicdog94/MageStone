// E2E test of the ranked queue + ELO flow against a local server (PORT env).
// Two fresh accounts queue ranked, get paired into an auto-lockable room, the
// host starts + finishes a game, and both leaderboard rows must show ELO moved.
import WebSocket from 'ws';

const PORT = process.env.PORT || 8788;
const URL = `ws://127.0.0.1:${PORT}`;
const suffix = Math.random().toString(36).slice(2, 7);
const A = `RankA_${suffix}`;
const B = `RankB_${suffix}`;

function client(name) {
  const ws = new WebSocket(URL);
  const queue = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const w = waiters.findIndex((x) => x.match(m));
    if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
    else queue.push(m);
  });
  const expect = (match, ms = 8000) =>
    new Promise((resolve, reject) => {
      const qi = queue.findIndex(match);
      if (qi >= 0) return resolve(queue.splice(qi, 1)[0]);
      const t = setTimeout(() => reject(new Error(`${name}: timeout waiting`)), ms);
      waiters.push({ match, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  const send = (m) => ws.send(JSON.stringify(m));
  const open = new Promise((r) => ws.on('open', r));
  return { ws, send, expect, open };
}

const a = client('A');
const b = client('B');
await Promise.all([a.open, b.open]);

// Sign up both.
a.send({ t: 'signup', username: A, password: 'pass1234' });
b.send({ t: 'signup', username: B, password: 'pass1234' });
await a.expect((m) => m.t === 'authOk');
await b.expect((m) => m.t === 'authOk');

// Test cancel first: A queues then cancels.
a.send({ t: 'findRanked' });
await a.expect((m) => m.t === 'rankedSearching');
a.send({ t: 'cancelRanked' });
await a.expect((m) => m.t === 'rankedCancelled');
console.log('cancel: OK');

// Both queue → paired into a ranked room; A (first) is host.
a.send({ t: 'findRanked' });
await a.expect((m) => m.t === 'rankedSearching');
b.send({ t: 'findRanked' });
await b.expect((m) => m.t === 'rankedSearching');
const joinedA = await a.expect((m) => m.t === 'joined');
const joinedB = await b.expect((m) => m.t === 'joined');
const lobbyA = await a.expect((m) => m.t === 'lobby' && m.players.length === 2);
if (!lobbyA.ranked) throw new Error('room not flagged ranked');
console.log(`paired: OK (room ${lobbyA.gameId}, A=${joinedA.myColor}, B=${joinedB.myColor}, host=${lobbyA.host})`);

// Host starts (client would auto-send createGame(2); a minimal state works —
// the server only relays it and reads `winner` + room player colours).
const state0 = { players: ['red', 'green'], winner: null, note: 'ranked-e2e' };
a.send({ t: 'startGame', state: state0 });
await a.expect((m) => m.t === 'started');
await b.expect((m) => m.t === 'started');

// A (red, host) wins.
a.send({ t: 'state', state: { ...state0, winner: joinedA.myColor } });
await b.expect((m) => m.t === 'state' && m.state.winner === joinedA.myColor);
await new Promise((r) => setTimeout(r, 700)); // let the async ELO write land

// Leaderboard must now show ELO for both: winner 1216, loser 1184 (K=32 even).
a.send({ t: 'leaderboard' });
const lbA = await a.expect((m) => m.t === 'leaderboard');
b.send({ t: 'leaderboard' });
const lbB = await b.expect((m) => m.t === 'leaderboard');
console.log('A row:', JSON.stringify(lbA.me));
console.log('B row:', JSON.stringify(lbB.me));
if (lbA.me.elo !== 1216) throw new Error(`winner elo ${lbA.me.elo} != 1216`);
if (lbB.me.elo !== 1184) throw new Error(`loser elo ${lbB.me.elo} != 1184`);
if (lbA.me.rankedWon !== 1 || lbB.me.rankedLost !== 1) throw new Error('ranked W/L wrong');
const names = lbA.eloTop.map((r) => r.username);
if (!names.includes(A) || !names.includes(B)) throw new Error('eloTop missing players');
const top = lbA.eloTop.find((r) => r.username === A);
if (top.elo !== 1216) throw new Error('eloTop winner elo wrong');
// Casual stats must also have counted the game (played/won/lost).
if (lbA.me.played !== 1 || lbA.me.won !== 1) throw new Error('casual stats not counted');
console.log('ELO: OK (1216 / 1184, eloTop has both, casual stats counted)');

a.ws.close();
b.ws.close();
console.log('RANKED E2E PASS');
process.exit(0);
