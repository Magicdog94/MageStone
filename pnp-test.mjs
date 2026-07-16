// Regression test: the print-and-play signup list is readable ONLY by the
// owner account (magicdog94). Run the server with PORT=8788 first:
//   PORT=8788 node server/server.mjs   (or npm run server with env set)
// then: node pnp-test.mjs
import WebSocket from 'ws';

const URL = 'ws://localhost:8788';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  const ws = new WebSocket(URL);
  const inbox = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  const send = (m) => ws.send(JSON.stringify(m));
  const expect = async (t, timeout = 5000) => {
    const t0 = Date.now();
    for (;;) {
      const i = inbox.findIndex((m) => m.t === t);
      if (i >= 0) return inbox.splice(i, 1)[0];
      const err = inbox.findIndex((m) => m.t === 'error' || m.t === 'authErr');
      if (err >= 0) {
        const e = inbox.splice(err, 1)[0];
        throw new Error(`got ${e.t}: ${e.message}`);
      }
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${t}`);
      await wait(50);
    }
  };
  const expectError = async (timeout = 5000) => {
    const t0 = Date.now();
    for (;;) {
      const i = inbox.findIndex((m) => m.t === 'error' || m.t === 'authErr');
      if (i >= 0) return inbox.splice(i, 1)[0];
      if (Date.now() - t0 > timeout) throw new Error('timeout waiting for error');
      await wait(50);
    }
  };
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ws, send, expect, expectError }));
    ws.on('error', reject);
  });
}

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};

// 1. A guest must NOT be able to read the list.
{
  const c = await client();
  c.send({ t: 'guest', name: 'Snooper' });
  await c.expect('guestOk');
  c.send({ t: 'pnpList' });
  const err = await c.expectError();
  check('guest denied pnpList', /owner/i.test(err.message));
  c.ws.close();
}

// 2. The owner signs in (a fresh account named by FEEDBACK_OWNER — run the
//    server with FEEDBACK_OWNER=pnpowner<n>), a signup is recorded, and the
//    owner reads it back.
{
  const owner = process.env.TEST_OWNER || 'pnpowner';
  const c = await client();
  c.send({ t: 'signup', username: owner, password: 'localtest1' });
  await c.expect('authOk');
  check('owner authed', true);
  c.send({ t: 'pnp', email: 'pnp-test@example.com' });
  await c.expect('pnpOk');
  c.send({ t: 'pnpList' });
  const list = await c.expect('pnpList');
  check('owner reads pnpList', Array.isArray(list.rows));
  check(
    'list contains the signup',
    list.rows.some((r) => r.email === 'pnp-test@example.com'),
  );
  c.ws.close();
}

// 3. A signed-in NON-owner must be denied too.
{
  const c = await client();
  c.send({ t: 'signin', username: 'TestHero', password: 'wrong-pw' });
  // wrong pw — fall back to a fresh throwaway account
  try {
    await c.expect('authOk', 2000);
  } catch {
    c.send({ t: 'signup', username: `Rando${Date.now() % 100000}`, password: 'localtest1' });
    await c.expect('authOk');
  }
  c.send({ t: 'pnpList' });
  const err = await c.expectError();
  check('non-owner denied pnpList', /owner/i.test(err.message));
  c.ws.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
