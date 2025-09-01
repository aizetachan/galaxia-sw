import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../server/index.js';
import { hasDb } from '../server/db.js';
import { ensureInt, outcomeFromDC } from '../server/world/utils.js';

test('ensureInt parses integers', () => {
  assert.strictEqual(ensureInt('5'), 5);
  assert.strictEqual(ensureInt('abc', 0), 0);
});

test('outcomeFromDC evaluates correctly', () => {
  assert.strictEqual(outcomeFromDC(15, 10), 'success');
  assert.strictEqual(outcomeFromDC(12, 10), 'mixed');
  assert.strictEqual(outcomeFromDC(5, 10), 'fail');
  assert.strictEqual(outcomeFromDC(7, null), null);
});

test('GET /api/world/time returns time', async (t) => {
  if (!hasDb) { t.skip('no db'); return; }
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/api/world/time`);
  const data = await res.json();
  server.close();
  assert.equal(res.status, 200);
  assert.ok(data.ok);
  assert.ok(data.time);
});
