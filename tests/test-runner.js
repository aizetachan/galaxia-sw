import test from 'node:test';
import assert from 'node:assert/strict';
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
