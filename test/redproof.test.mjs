import test from 'node:test';
import assert from 'node:assert/strict';
import { blockingCases, temp, hook, run } from './helpers.mjs';

for (const c of blockingCases()) test(`RED proof detects always-allow: ${c.id}`, t => {
  for (const payload of c.setup) assert.equal(run('test/fixtures/always-allow.mjs', [], { input: JSON.stringify(payload) }).status, 0);
  const stub = run('test/fixtures/always-allow.mjs', [], { input: JSON.stringify(c.target) });
  assert.equal(stub.status, 0);
  assert.throws(() => assert.equal(stub.status, 2), { code: 'ERR_ASSERTION' });
  const dir = temp(t);
  for (const p of c.setup) hook(c.guard, p, dir);
  assert.equal(hook(c.guard, c.target, dir).status, 2);
});
