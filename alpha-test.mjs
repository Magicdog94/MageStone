// E2E: guest sessions, passwordless invite join, feedback + PnP storage.
import WebSocket from 'ws';
const PORT = process.env.PORT || 8788;
const URL = `ws://127.0.0.1:${PORT}`;

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
      const t = setTimeout(() => reject(new Error(`${name}: timeout`)), ms);
      waiters.push({ match, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  return { ws, send: (m) => ws.send(JSON.stringify(m)), expect, open: new Promise((r) => ws.on('open', r)) };
}

const a = client('A');
const b = client('B');
await Promise.all([a.open, b.open]);

// Guests get sessions with just a name.
a.send({ t: 'guest', name: 'Frodo' });
const ga = await a.expect((m) => m.t === 'guestOk');
if (ga.username !== 'Frodo') throw new Error('guest name mismatch');
b.send({ t: 'guest', name: 'Sam' });
await b.expect((m) => m.t === 'guestOk');
console.log('guest sessions: OK');

// A creates a passwordless room; B joins with just the code (invite link path).
a.send({ t: 'createGame', playerCount: 2, password: '' });
const joinedA = await a.expect((m) => m.t === 'joined');
const lobbyA = await a.expect((m) => m.t === 'lobby');
if (lobbyA.hasPass) throw new Error('room should be passwordless');
b.send({ t: 'joinGame', gameId: joinedA.gameId, password: '' });
await b.expect((m) => m.t === 'joined');
const lobbyB = await b.expect((m) => m.t === 'lobby' && m.players.length === 2);
console.log(`invite join: OK (room ${joinedA.gameId}, players ${lobbyB.players.map((p) => p.username).join(' + ')})`);

// Guests must be refused from Ranked.
a.send({ t: 'findRanked' });
const err = await a.expect((m) => m.t === 'error');
if (!/account/i.test(err.message)) throw new Error('guest ranked guard missing');
console.log('guest ranked guard: OK');

// Feedback + PnP.
a.send({ t: 'feedback', enjoy: 'dice!', confuse: 'sieges', change: 'more maps', duration: '15–30 min', players: '2', finished: 'Yes', victory: 'Conquest', bug: '' });
await a.expect((m) => m.t === 'feedbackOk');
a.send({ t: 'pnp', email: 'tester@example.com' });
await a.expect((m) => m.t === 'pnpOk');
a.send({ t: 'pnp', email: 'not-an-email' });
const bad = await a.expect((m) => m.t === 'error');
if (!/valid email/i.test(bad.message)) throw new Error('pnp validation missing');
console.log('feedback + pnp: OK');

a.ws.close();
b.ws.close();
console.log('ALPHA E2E PASS');
process.exit(0);
