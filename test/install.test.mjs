import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, temp, root } from './helpers.mjs';
const ready = () => fs.existsSync(path.join(root, 'agents/aun-browser-runner.md')) && fs.existsSync(path.join(root, 'briefs/browser-read.md'));
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));
export function installed(t, args = []) {
  if (!ready()) { t.skip('Writer B install assets are pending.'); return; }
  const dir = temp(t); const cfg = path.join(dir, 'config');
  const result = cli(['install', '--claude-dir', cfg, '--yes', ...args]);
  assert.equal(result.status, 0, result.stderr);
  return cfg;
}
test('install merge, idempotence, backup once, uninstall shared settings', t => {
  if (!ready()) return t.skip('Writer B install assets are pending.');
  const cfg = temp(t); fs.mkdirSync(path.join(cfg, 'agents'));
  const settings = { theme: 'dark', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] }] } };
  const file = path.join(cfg, 'settings.json'); fs.writeFileSync(file, JSON.stringify(settings));
  const args = ['install', '--claude-dir', cfg, '--yes'];
  assert.equal(cli(args).status, 0);
  const first = fs.readFileSync(file, 'utf8');
  const backup = fs.readFileSync(`${file}.lean-browser-use.bak`, 'utf8');
  assert.equal(json(file).theme, 'dark'); assert.ok(first.includes('user-hook'));
  assert.equal(cli(args).status, 0); assert.equal(fs.readFileSync(file, 'utf8'), first);
  assert.equal(fs.readFileSync(`${file}.lean-browser-use.bak`, 'utf8'), backup);
  const manifest = json(path.join(cfg, 'lean-browser-use/manifest.json'));
  assert.ok(manifest.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)));
  assert.equal(manifest.settingsEntries.length, 8);
  assert.equal(cli(['uninstall', '--claude-dir', cfg]).status, 0);
  assert.ok(fs.existsSync(path.join(cfg, 'agents')));
  assert.equal(json(file).theme, 'dark'); assert.ok(fs.readFileSync(file, 'utf8').includes('user-hook'));
  assert.ok(!fs.readFileSync(file, 'utf8').includes('/lean-browser-use/hooks/'));
  assert.ok(!fs.existsSync(path.join(cfg, 'lean-browser-use')));
});
test('uninstall leaves edits and exits 3; dry plan equals real plan', t => {
  const cfg = installed(t); if (!cfg) return;
  const edited = path.join(cfg, 'agents/aun-browser-runner.md'); fs.appendFileSync(edited, '\nUser note.\n');
  const before = fs.readFileSync(edited, 'utf8');
  const dry = cli(['--uninstall', '--claude-dir', cfg, '--dry']);
  assert.equal(dry.status, 3); assert.ok(fs.existsSync(path.join(cfg, 'lean-browser-use/manifest.json')));
  const actual = cli(['uninstall', '--claude-dir', cfg]);
  assert.equal(actual.status, 3); assert.equal(actual.stdout, dry.stdout);
  assert.equal(fs.readFileSync(edited, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(cfg, 'lean-browser-use/manifest.json')));
});
test('install dry writes nothing and emits its real plan', t => {
  if (!ready()) return t.skip('Writer B install assets are pending.');
  const cfg = path.join(temp(t), 'new'); const args = ['--claude-dir', cfg, '--yes'];
  const dry = cli([...args, '--dry']); assert.equal(dry.status, 0); assert.ok(!fs.existsSync(cfg));
  const real = cli(args); assert.equal(real.status, 0); assert.equal(real.stdout, dry.stdout);
});
test('missing manifest names its path and exits 2', t => {
  const cfg = temp(t); const r = cli(['uninstall', '--claude-dir', cfg]);
  assert.equal(r.status, 2); assert.ok(r.stderr.includes(path.join(cfg, 'lean-browser-use/manifest.json')));
});
for (const unsafe of ['../outside', '/tmp/outside', 'lean-browser-use/hooks/../../../outside']) test(`tampered manifest path refused: ${unsafe}`, t => {
  const cfg = installed(t); if (!cfg) return;
  const file = path.join(cfg, 'lean-browser-use/manifest.json'); const m = json(file); m.files[0].path = unsafe;
  fs.writeFileSync(file, JSON.stringify(m)); const r = cli(['uninstall', '--claude-dir', cfg]);
  assert.equal(r.status, 2); assert.ok(fs.existsSync(file));
  assert.ok(fs.existsSync(path.join(cfg, 'agents/aun-browser-runner.md')));
});
test('managed symlink file and parent refused before removing anything', t => {
  for (const parent of [false, true]) {
    const cfg = installed(t); if (!cfg) return;
    const outside = path.join(temp(t), 'outside'); fs.mkdirSync(outside);
    const target = path.join(cfg, 'lean-browser-use/hooks', parent ? '' : 'pick-guard.sh');
    fs.rmSync(target, { recursive: true, force: true });
    try { fs.symlinkSync(parent ? outside : path.join(outside, 'missing'), target); }
    catch (e) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) return t.skip(`Symlinks unavailable: ${e.code}`); throw e; }
    assert.equal(cli(['uninstall', '--claude-dir', cfg]).status, 2);
    assert.ok(fs.existsSync(path.join(cfg, 'agents/aun-browser-runner.md')));
  }
});
test('no-hooks snippet, project target, config env, edited reinstall', t => {
  if (!ready()) return t.skip('Writer B install assets are pending.');
  const dir = temp(t); const cfg = path.join(dir, '.claude');
  const r = cli(['--project', '--no-hooks', '--yes'], { cwd: dir }); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Paste these hook entries/); assert.ok(!fs.existsSync(path.join(cfg, 'settings.json')));
  const file = path.join(cfg, 'agents/aun-browser-runner.md'); fs.appendFileSync(file, '\nEdited\n');
  assert.equal(cli(['--yes'], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } }).status, 2);
  assert.equal(cli(['uninstall', '--claude-dir', cfg]).status, 3);
});
test('with-reader copies executable commands and malformed settings are preserved', t => {
  if (!fs.existsSync(path.join(root, 'reader/reader'))) return t.skip('Reader adaptation pending.');
  const cfg = installed(t, ['--with-reader']); if (!cfg) return;
  for (const relative of ['reader/reader', 'searxng/searx', 'searxng/deploy.sh']) assert.ok(fs.statSync(path.join(cfg, 'lean-browser-use', relative)).mode & 0o100);
  fs.writeFileSync(path.join(cfg, 'settings.json'), '{broken');
  assert.equal(cli(['install', '--claude-dir', cfg, '--yes']).status, 2);
  assert.equal(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'), '{broken');
});
test('CLI usage and version', () => {
  for (const args of [['unknown'], ['--unknown'], ['--claude-dir'], ['doctor', '--with-reader']]) assert.equal(cli(args).status, 2);
  assert.equal(cli(['--version']).stdout.trim(), '0.1.0'); assert.equal(cli(['--help']).status, 0);
});

test('uninstall removes an empty config root created by a no-hooks install', t => {
  if (!ready()) return t.skip('Writer B install assets pending.');
  const cfg = path.join(temp(t), 'new');
  assert.equal(cli(['--claude-dir', cfg, '--no-hooks', '--yes']).status, 0);
  const dry = cli(['uninstall', '--claude-dir', cfg, '--dry']);
  const result = cli(['uninstall', '--claude-dir', cfg]);
  assert.equal(result.status, 0); assert.equal(result.stdout, dry.stdout); assert.ok(!fs.existsSync(cfg));
});

test('install and uninstall through a symlinked config ancestor', async t => {
  for (const existing of [false, true]) await t.test(existing ? 'existing config' : 'new nested config', t => {
    const dir = temp(t); const actual = path.join(dir, 'actual'); const alias = path.join(dir, 'alias');
    fs.mkdirSync(actual);
    try { fs.symlinkSync(actual, alias, 'dir'); }
    catch (e) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) return t.skip(`Symlinks unavailable: ${e.code}`); throw e; }
    const cfg = path.join(alias, 'nested', '.claude');
    const realCfg = path.join(actual, 'nested', '.claude');
    if (existing) fs.mkdirSync(realCfg, { recursive: true });
    const args = ['install', '--claude-dir', cfg, '--yes'];
    const dry = cli([...args, '--dry']); assert.equal(dry.status, 0, dry.stderr);
    assert.ok(!fs.existsSync(path.join(realCfg, 'lean-browser-use')));
    const install = cli(args); assert.equal(install.status, 0, install.stderr); assert.equal(install.stdout, dry.stdout);
    const settings = fs.readFileSync(path.join(realCfg, 'settings.json'), 'utf8');
    assert.ok(settings.includes(realCfg)); assert.ok(!settings.includes(alias));
    const again = cli(['install', '--claude-dir', realCfg, '--yes']); assert.equal(again.status, 0, again.stderr);
    assert.equal(fs.readFileSync(path.join(realCfg, 'settings.json'), 'utf8'), settings);
    const doctor = cli(['doctor', '--claude-dir', cfg, '--json']); assert.equal(doctor.status, 0, doctor.stdout);
    const uninstall = cli(['uninstall', '--claude-dir', cfg]); assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.ok(!fs.existsSync(path.join(realCfg, 'lean-browser-use')));
    assert.ok(fs.lstatSync(alias).isSymbolicLink());
  });
});
test('uninstall accepts a symlinked ancestor of an existing installation', t => {
  const cfg = installed(t); if (!cfg) return;
  const alias = path.join(temp(t), 'alias');
  try { fs.symlinkSync(path.dirname(cfg), alias, 'dir'); }
  catch (e) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) return t.skip(`Symlinks unavailable: ${e.code}`); throw e; }
  const result = cli(['uninstall', '--claude-dir', path.join(alias, path.basename(cfg))]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(path.join(cfg, 'lean-browser-use')));
});
test('managed tree symlinks refuse install, doctor and uninstall', async t => {
  for (const relative of ['skills', 'lean-browser-use/manifest.json', 'lean-browser-use/hooks/pick-guard.sh']) await t.test(relative, t => {
    const cfg = installed(t); if (!cfg) return;
    const target = path.join(cfg, relative); const outside = path.join(temp(t), 'original');
    const isDir = fs.statSync(target).isDirectory();
    fs.renameSync(target, outside);
    try { fs.symlinkSync(outside, target, isDir ? 'dir' : 'file'); }
    catch (e) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) return t.skip(`Symlinks unavailable: ${e.code}`); throw e; }
    for (const [command, status] of [['install', 2], ['doctor', 1], ['uninstall', 2]]) {
      const result = cli([command, '--claude-dir', cfg]);
      assert.equal(result.status, status, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, /Refused symlink target/);
      assert.ok(fs.lstatSync(target).isSymbolicLink());
      assert.ok(fs.existsSync(outside));
      assert.ok(fs.existsSync(path.join(cfg, 'agents/aun-browser-runner.md')));
    }
  });
});
