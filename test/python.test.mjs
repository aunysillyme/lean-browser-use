import test from 'node:test';
import assert from 'node:assert/strict';
import { captured } from '../src/util.mjs';
import { root } from './helpers.mjs';
for (const dir of ['reader', 'searxng']) test(`${dir} Python standard-library offline suite`, t => {
  const result = captured('python3', ['-m', 'unittest', 'discover', '-s', dir, '-p', 'test_*.py'], { cwd: root, timeout: 60000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (result.error?.code === 'ENOENT') return t.skip('python3 is optional and absent.');
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stderr, /Ran \d+ tests/);
});
