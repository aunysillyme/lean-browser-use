import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { root, cli } from './helpers.mjs';
import { walk } from '../src/util.mjs';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
function available(t, files) {
  const missing = files.filter(f => !fs.existsSync(path.join(root, f)));
  if (missing.length) { t.skip(`Writer B files pending: ${missing.join(', ')}`); return false; }
  return true;
}
test('text tree uses plain punctuation', () => {
  for (const file of walk(root).filter(f => !path.relative(root, f).split(path.sep).some(p => ['.git', '.repo-build', 'node_modules', '__pycache__', '.agents', '.aws', '.codex'].includes(p)) && !/\.(tgz|pyc)$/.test(f))) {
    assert.ok(!fs.readFileSync(file, 'utf8').includes(String.fromCodePoint(0x2014)), path.relative(root, file));
  }
});
test('CLAUDE pointer is exact and agent instructions are bounded', t => {
  if (!available(t, ['CLAUDE.md', 'AGENTS.md'])) return;
  assert.equal(read('CLAUDE.md'), '# CLAUDE.md\n\nAGENTS.md is the single source of agent instructions for this repo.\n\n' + '@' + 'AGENTS.md\n');
  assert.ok(read('AGENTS.md').trimEnd().split('\n').length <= 200);
});
test('README opening identifies who, what and next step', () => {
  const text = read('README.md');
  const lines = [
    'For Claude Code users who run browser work in their sessions.',
    'You get a skill, a runner agent (a fresh subagent that does the browser work), three hooks and a token meter (the `measure` command that counts tokens per step).',
    'Next: start a fresh Claude Code session and ask it to use the `lean-browser-use` skill.'
  ];
  const check = text => {
    const start = text.indexOf('**Cut browser use cost'); const end = text.indexOf('```sh');
    const opening = text.slice(start, end);
    for (const line of lines) assert.ok(opening.includes(`\n${line}\n`), `Missing opening line: ${line}`);
    assert.ok(opening.indexOf(lines[0]) < opening.indexOf(lines[1]));
    assert.ok(opening.indexOf(lines[1]) < opening.indexOf(lines[2]));
  };
  check(text);
  for (const line of lines) assert.throws(() => check(text.replace(line, '')), /Missing opening line/);
});
test('README first-screen order, bounded fences, receipt markers and sibling row', t => {
  if (!available(t, ['README.md'])) return;
  const text = read('README.md'); assert.match(text, /^# lean-browser-use\n/);
  assert.ok(text.includes('**Cut browser use cost by about 25% in Claude Code: run page work in a fresh runner, send it in bulk, and see your own saving.**'));
  assert.ok(text.trimEnd().split('\n').length < 350);
  const positions = ['**Cut browser use cost', 'npx lean-browser-use', '## What it does', '## What it saves', '## After you install', '## Part of a set', '## Measure your own saving', '## Common questions', '## Uninstall', '## Read next', 'For agents', '## Contributing', '## Credits', '## License'].map(s => {
    const i = text.indexOf(s); assert.ok(i >= 0, `Missing ${s}`); return i;
  });
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  for (const block of text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) assert.ok(block[1].trimEnd().split('\n').length <= 8);
  assert.ok(!text.includes('{{proof:'), 'Replace proof placeholders from generated results.');
  assert.match(text, /\| \*\*lean-browser-use\*\* \|/);
  const description = JSON.parse(read('package.json')).description;
  assert.ok(text.includes(`| **lean-browser-use** | ${description} |`));
  assert.ok(read('llms.txt').includes(`> ${description}\n`));
  assert.ok(read('llms.txt').includes(`[lean-browser-use: ${description}]`));
  assert.match(text, /\[lean-computer-use\]\(https:\/\/github.com\/aunysillyme\/lean-computer-use\)/);
  assert.ok(text.includes('Background Mac computer control for AI agents: desk tools, a fresh runner subagent, retry guards and a transcript token meter, installed with one command'));
  const questions = text.slice(text.indexOf('## Common questions'), text.indexOf('## Uninstall')).match(/^### /gm) || [];
  assert.ok(questions.length >= 4 && questions.length <= 6);
});
test('README quantities are backed by proof or captured program output', t => {
  if (!available(t, ['README.md', 'proof/results.json'])) return;
  const outputs = [cli(['--help']).stdout, cli(['--version']).stdout, cli(['measure', '--dir', 'test/fixtures/transcripts']).stdout, read('proof/results.json')].join('\n');
  const supported = new Set([...outputs.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0].replaceAll(',', ''))));
  // URLs and licence identifiers are names; check prose quantities and list numbers.
  const prose = read('README.md').replace(/\]\([^)]*\)/g, ']').replace(/(?:Apache|AGPL|CC-BY)-[\d.]+/g, 'licence');
  const proof = JSON.parse(read('proof/results.json'));
  const benchmark = JSON.parse(read('proof/benchmark.json'));
  const value = id => { const row = proof.rows.find(r => r.id === id); assert.ok(row, id); return row.value; };
  for (const m of prose.matchAll(/about (\d+)x/g)) assert.equal(Number(m[1]), Math.round(value('paired_step_ratio')), 'README per-step ballpark must follow proof');
  assert.match(prose, /about 3x/);
  assert.doesNotMatch(read('README.md'), /about half/i);
  const best = Math.round(value('paired_cost_best_saving_percent'));
  for (const m of prose.matchAll(/cost by about (\d+)%/g)) assert.equal(Number(m[1]), best, 'README headline must follow best dollar saving proof');
  assert.ok(prose.includes(`about ${best}%`));
  supported.add(best);
  const changes = [
    (value('paired_cost_usd_runner_arm') / value('paired_cost_usd_plain') - 1) * 100,
    (value('paired_small_cost_usd_runner_arm') / value('paired_small_cost_usd_plain') - 1) * 100
  ].map(n => Number(n.toFixed(2)));
  assert.deepEqual(changes, [benchmark.cost_usd.derived.run1_percent, benchmark.cost_usd.derived.run2_percent]);
  const savings = changes.map(n => Math.round(-n));
  const pooled = Math.round(value('paired_cost_pooled_saving_percent'));
  assert.equal(pooled, Math.round(-benchmark.cost_usd.derived.pooled_percent));
  assert.ok(prose.includes(`cost ${savings[0]}% and ${savings[1]}% less than in a plain session, about ${pooled}% less together (list API prices)`));
  for (const n of [...savings, pooled]) supported.add(n);
  const formatted = id => value(id).toLocaleString('en-US');
  assert.ok(prose.includes(`| Per browser step (median tokens) | ${formatted('paired_step_tokens_plain')} | ${formatted('paired_step_tokens_runner')} | ${value('paired_step_ratio')} |`));
  assert.ok(prose.includes(`| All browser steps | ${formatted('paired_task_tokens_plain')} | ${formatted('paired_task_tokens_runner_arm')} | ${value('paired_task_ratio')} |`));
  assert.ok(prose.includes(`| Everything the run read | ${formatted('paired_run_tokens_plain')} | ${formatted('paired_run_tokens_runner_arm')} | ${value('paired_run_ratio')} |`));
  for (const [i, ids] of [['paired_cost_usd_plain', 'paired_cost_usd_runner_arm'], ['paired_small_cost_usd_plain', 'paired_small_cost_usd_runner_arm']].entries()) {
    assert.ok(prose.includes(`| Run ${i + 1} cost | $${value(ids[0]).toFixed(4)} | $${value(ids[1]).toFixed(4)} | ${changes[i].toFixed(2)}% |`));
  }
  assert.ok(prose.indexOf('| Run 1 cost |') < prose.indexOf('| Run 2 cost |'));
  assert.ok(prose.indexOf('| Run 2 cost |') < prose.indexOf('| Per browser step (median tokens) |'));
  const llms = read('llms.txt');
  assert.doesNotMatch(llms, /about half/i);
  assert.ok(llms.includes(`about ${Math.round(value('paired_step_ratio'))}x fewer tokens per browser step`));
  assert.ok(llms.includes(`${formatted('paired_run_tokens_plain')} tokens in the plain arm and ${formatted('paired_run_tokens_runner_arm')} in the runner arm`));
  assert.ok(llms.includes(`about ${Math.round(benchmark.derived.delta_percent)}% higher overall`));
  assert.ok(llms.includes(`About ${best}% cheaper`));
  assert.ok(llms.includes(`about ${Math.round(value('paired_break_even_steps'))} browser steps is an estimate`));
  for (const m of prose.matchAll(/(?:^|[\s|(>])([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)(?=[\s.,)|%<]|$)/gm)) assert.ok(supported.has(Number(m[1].replaceAll(',', ''))), `Unproved README quantity: ${m[1]}`);
});
test('README, docs and llms links resolve and headings name useful content', t => {
  if (!available(t, ['README.md', 'llms.txt', 'docs/install.md'])) return;
  const files = ['README.md', 'RELEASING.md', 'REPO_SETTINGS.md', 'llms.txt', ...walk(path.join(root, 'docs')).filter(p => p.endsWith('.md')).map(p => path.relative(root, p))];
  for (const file of files) {
    const text = read(file);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let link = match[1].replace(/^<|>$/g, '').split('#')[0];
      const prefix = 'https://github.com/aunysillyme/lean-browser-use/blob/main/';
      const repoLink = link.startsWith(prefix);
      if (repoLink) link = link.slice(prefix.length);
      else if (/^[a-z]+:/.test(link) || !link) continue;
      const target = path.resolve(root, repoLink ? '' : path.dirname(file), decodeURIComponent(link));
      assert.ok(fs.existsSync(target) && fs.statSync(target).isFile(), `${file}: ${link}`);
    }
    assert.ok(!/^#+\s+.*\b(What it is not|Limits|Missing|Honest limits)\b/im.test(text), file);
  }
});
test('llms shape and bounded skill/reference files', t => {
  const skill = 'skills/lean-browser-use/SKILL.md';
  if (!available(t, ['llms.txt', skill])) return;
  const llms = read('llms.txt'); assert.match(llms, /^# /); assert.match(llms, /^> /m); assert.match(llms, /npx lean-browser-use/);
  for (const title of ['Docs', 'Reference', 'Reader and search companions']) assert.ok(llms.includes(`## ${title}`));
  for (const section of llms.split(/^## /m).slice(1)) assert.match(section, /\[[^\]]+\]\(https:\/\//);
  const text = read(skill); assert.ok(Buffer.byteLength(text) < 6144); assert.ok(text.trimEnd().split('\n').length <= 120);
  assert.match(text, /^---\n/); assert.match(text.split('---')[1], /^name: lean-browser-use$/m); assert.match(text.split('---')[1], /^description: .+/m);
  for (const file of walk(path.join(root, 'skills/lean-browser-use/references'))) assert.ok(fs.statSync(file).size <= 8192);
});
test('runner frontmatter declares its name, description, tools and model', t => {
  const file = 'agents/aun-browser-runner.md'; if (!available(t, [file])) return;
  const front = read(file).match(/^---\n([\s\S]*?)\n---\n/); assert.ok(front);
  for (const key of ['name', 'description', 'tools', 'model']) assert.match(front[1], new RegExp(`^${key}: .+`, 'm'));
  assert.match(front[1], /^name: aun-browser-runner$/m); assert.match(front[1], /^model: haiku$/m);
});

test('provenance distinguishes generated measurements from static benchmark rows', () => {
  const text = read('docs/PROVENANCE.md');
  assert.match(text, /Generated rows carry a command, measurement date, and expiry\./);
  assert.match(text, /20 paired benchmark rows \(ids starting `paired_`\) are static records copied or derived from/);
  assert.match(text, /proof\/benchmark\.json/);
  assert.match(text, /carry the measurement date and no expiry by the owner's ruling, and are never re-measured by the proof script/);
  assert.doesNotMatch(text, /(?:every|each|per) row[^.]*expir|expir[^.]*per row/i);
  const paired = JSON.parse(read('proof/results.json')).rows.filter(row => row.id.startsWith('paired_'));
  assert.equal(paired.length, 20);
  assert.ok(paired.every(row => row.measured && !row.expires));
  assert.match(read('docs/measure.md'), /The twenty paired benchmark rows/);
});

test('pick reset docs match the registered Chrome extension close hook', () => {
  const settings = JSON.parse(read('hooks/hooks.settings.json'));
  const pick = settings.hooks.PostToolUse.find(entry => entry.hooks.some(hook => hook.command.includes('pick-guard.sh')));
  assert.ok(pick.matcher.split('|').includes('mcp__claude-in-chrome__tabs_close_mcp'));
  for (const file of ['docs/guards.md', 'skills/lean-browser-use/references/cleanup.md', 'skills/lean-browser-use/references/logged-in-run.md']) {
    const text = read(file);
    assert.match(text, /Closing a tab with the Chrome extension's `tabs_close_mcp` clears the pick/);
    assert.match(text, /close run tabs once at the end/);
    assert.match(text, /Closing a tab in the in-app Browser pane keeps its pick/);
  }
  assert.match(read('docs/guards.md'), /\| PostToolUse \| Chrome extension `select_browser`, `switch_browser`, and `tabs_close_mcp`/);
});

test('release workflow requires approval, pinned actions and matching versions', () => {
  const text = read('.github/workflows/release.yml');
  assert.match(text, /^name: release$/m);
  assert.match(text, /^    tags: \['v\*'\]$/m);
  assert.match(text, /^  contents: read$/m);
  assert.match(text, /^  id-token: write$/m);
  assert.match(text, /^concurrency:\n  group: release-\$\{\{ github.ref \}\}\n  cancel-in-progress: false$/m);
  assert.match(text, /^  publish:\n    runs-on: ubuntu-latest\n    environment: release$/m);
  assert.doesNotMatch(text, /\b(?:NODE_AUTH_TOKEN|NPM_TOKEN)\b/);
  const actions = [...text.matchAll(/uses: ([^\s]+) # v[^\n]+/g)].map(match => match[1]);
  assert.deepEqual(actions, [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'
  ]);
  assert.equal([...text.matchAll(/uses:/g)].length, actions.length);
  assert.match(text, /node-version: 24\n          registry-url: https:\/\/registry\.npmjs\.org/);
  const install = text.match(/- name: Install release npm\n        run: \|\n([\s\S]*?)(?=      - name: tag)/);
  assert.ok(install, 'Release npm must be installed before version checks and publishing');
  assert.match(install[1], /^          set -eu\n          npm ci --prefix release-tooling --ignore-scripts --include=dev\n/m);
  assert.ok(install[1].includes('npm_bin="$GITHUB_WORKSPACE/release-tooling/node_modules/.bin"'));
  assert.ok(install[1].includes("require('./release-tooling/package.json').devDependencies.npm"));
  assert.ok(install[1].includes('actual="$("$npm_bin/npm" --version)"'));
  assert.ok(install[1].includes('test "$actual" = "$expected" ||'));
  assert.ok(install[1].includes('echo "$npm_bin" >> "$GITHUB_PATH"'));
  assert.doesNotMatch(text, /npm install -g/);
  const tooling = JSON.parse(read('release-tooling/package.json'));
  const lock = JSON.parse(read('release-tooling/package-lock.json'));
  assert.equal(tooling.private, true);
  assert.deepEqual(Object.keys(tooling.devDependencies), ['npm']);
  assert.match(tooling.devDependencies.npm, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[''].devDependencies, tooling.devDependencies);
  const lockedNpm = lock.packages['node_modules/npm'];
  assert.equal(lockedNpm.version, tooling.devDependencies.npm);
  assert.equal(lockedNpm.resolved, `https://registry.npmjs.org/npm/-/npm-${lockedNpm.version}.tgz`);
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name && !entry.inBundle) {
      assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, name);
      const digest = entry.integrity.slice('sha512-'.length);
      assert.equal(Buffer.from(digest, 'base64').length, 64, name);
      assert.equal(Buffer.from(digest, 'base64').toString('base64'), digest, name);
    }
  }
  assert.match(read('.github/dependabot.yml'), /  - package-ecosystem: npm\n    directory: \/release-tooling\n/);
  const versionStep = text.match(/- name: tag and package\.json must name the same version\n        run: \|\n([\s\S]*?)(?=      -)/);
  assert.ok(versionStep, 'Tag/version check must precede tests and publishing');
  assert.ok(versionStep[1].includes('tag="${GITHUB_REF_NAME#v}"'));
  assert.ok(versionStep[1].includes("require('./package.json').version"));
  assert.ok(versionStep[1].includes('test "$tag" = "$pkg"'));
  const version = JSON.parse(read('package.json')).version;
  for (const [tag, expected] of [[`v${version}`, 0], ['v0.0.0-mismatch', 1]]) {
    const result = spawnSync('sh', ['-c', versionStep[1]], { cwd: root, env: { ...process.env, GITHUB_REF_NAME: tag }, encoding: 'utf8' });
    assert.equal(result.status, expected, result.stderr);
  }
  assert.match(text, /      - run: npm test\n      - run: npm run check\n      - name: Publish unless this version is already on the registry\n/);
});

test('release npm installation rejects a mismatched integrity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-integrity-'));
  try {
    const tooling = JSON.parse(read('release-tooling/package.json'));
    const lock = JSON.parse(read('release-tooling/package-lock.json'));
    const fixture = path.join(dir, 'fixture');
    fs.mkdirSync(fixture);
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'npm', version: tooling.devDependencies.npm }));
    const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', dir], { cwd: fixture, encoding: 'utf8' });
    assert.equal(pack.status, 0, pack.stderr);
    const packResult = JSON.parse(pack.stdout);
    const archive = Array.isArray(packResult) ? packResult[0] : packResult.npm;
    assert.ok(archive?.filename, 'npm pack must report its tarball');
    const tarball = path.join(dir, archive.filename);
    const install = path.join(dir, 'install');
    fs.mkdirSync(install);
    const lockedNpm = lock.packages['node_modules/npm'];
    lockedNpm.resolved = pathToFileURL(tarball).href;
    lockedNpm.integrity = `sha512-${createHash('sha512').update(fs.readFileSync(tarball)).digest('base64')}`;
    fs.writeFileSync(path.join(install, 'package.json'), JSON.stringify(tooling));
    fs.writeFileSync(path.join(install, 'package-lock.json'), JSON.stringify(lock));
    const ci = cache => spawnSync('npm', ['ci', '--offline', '--no-audit', '--ignore-scripts', '--include=dev', '--cache', path.join(dir, cache)], { cwd: install, encoding: 'utf8' });
    const valid = ci('valid-cache');
    assert.equal(valid.status, 0, valid.stderr);
    lockedNpm.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
    fs.writeFileSync(path.join(install, 'package-lock.json'), JSON.stringify(lock));
    const result = ci('invalid-cache');
    assert.notEqual(result.status, 0, 'npm ci must reject a mismatched tarball');
    assert.match(result.stderr, /EINTEGRITY/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release workflow skips a version already on the registry before publishing', () => {
  const text = read('.github/workflows/release.yml');
  const step = text.match(/      - name: Publish unless this version is already on the registry\n        run: \|\n([\s\S]*?)(?=\n  github-release:\n)/);
  assert.ok(step, 'Registry skip step must exist');
  assert.match(step[1], /^          set -eu\n/);
  assert.ok(step[1].includes('name="$(node -p "require(\'./package.json\').name")"'));
  assert.ok(step[1].includes('version="$(node -p "require(\'./package.json\').version")"'));
  assert.match(step[1], /          if npm view "\$name@\$version" version --prefer-online > \/dev\/null 2>&1; then\n            echo "\$name@\$version is already on the registry; nothing to publish\."\n            exit 0\n          fi\n          npm publish --provenance --access public\n$/);
});

test('release page job runs after publish, alone may write contents, and skips an existing release', () => {
  const text = read('.github/workflows/release.yml');
  const job = text.slice(text.indexOf('\n  github-release:\n'));
  assert.match(job, /^    needs: publish$/m);
  assert.match(job, /^      contents: write$/m);
  assert.equal([...text.matchAll(/contents: write/g)].length, 1);
  const check = job.indexOf('gh release view "$TAG"');
  const create = job.indexOf('gh release create "$TAG" --verify-tag --title "$name $version" --notes-file "$notes"');
  assert.ok(check > 0 && create > check, 'the existing-release check must come before the create command');
  assert.match(job.slice(check, create), /already exists; nothing to create\."\n            exit 0/);
  assert.match(job, /CHANGELOG\.md has no section for \$version/);
});

test('repository settings prepare the public flip and release environment', () => {
  const text = read('REPO_SETTINGS.md');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!text.includes(String.fromCodePoint(0x2014)));
  assert.ok(text.includes(`Description: ${pkg.description}\n`));
  assert.ok(text.includes(`Homepage: ${pkg.homepage}\n`));
  const topics = ['ai-agents', 'browser-automation', 'browser-use', 'claude-code', 'claude-in-chrome', 'context-window', 'hooks', 'llm-cost', 'mcp', 'subagent', 'token-efficiency', 'web-scraping'];
  assert.deepEqual(text.match(/^Topics: (.+)$/m)[1].split(', '), topics);
  assert.deepEqual(pkg.keywords.filter(keyword => topics.includes(keyword)).sort(), topics);
  assert.deepEqual(JSON.parse(text.match(/^\{"names":\[.+\]\}$/m)[0]).names, topics);
  for (const value of ['REPO=aunysillyme/lean-browser-use', 'gh api users/aunysillyme --jq .id', 'gh api --method PUT "repos/$REPO/environments/release"', 'gh api --method POST "repos/$REPO/environments/release/deployment-branch-policies"', "-f name='v*' -f type=tag", '"reviewers":[{"type":"User","id":$REVIEWER_ID}]', '"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}', 'Workflow filename | release.yml', 'Environment | release', 'npm view lean-browser-use dist.integrity']) assert.ok(text.includes(value), value);
  const rows = text.slice(text.indexOf('| Setting |'), text.indexOf('Set the repository')).trim().split('\n').slice(2);
  assert.ok(rows.length >= 8);
  for (const row of rows) assert.ok(row.endsWith('| to be read back after the flip |'), row);
  const npm = text.slice(text.indexOf('## npm Trusted Publisher'), text.indexOf('## Registry parity'));
  const npmLinks = [...npm.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);
  for (const expected of ['https://docs.npmjs.com/cli/v11/commands/npm-trust', 'https://docs.npmjs.com/trusted-publishers']) {
    assert.ok(npmLinks.includes(expected), expected);
    assert.ok(!npmLinks.includes(`https://example.org/?next=${expected}`));
  }
  assert.equal([...npm.matchAll(/read 2026-10-25/g)].length, 2);
  assert.match(npm, /package must already exist on the npm registry\nbefore configuring a Trusted Publisher/);
  assert.match(npm, /validate it and bind it to the repository identity/);
  assert.doesNotMatch(npm, /UNVERIFIED|Path [AB]:/);
  assert.match(read('RELEASING.md'), /\[repository settings\]\(REPO_SETTINGS\.md\)/);
});

test('release guides document the manual first publish and trusted release order', () => {
  for (const file of ['REPO_SETTINGS.md', 'RELEASING.md']) {
    const text = read(file);
    assert.match(text, /1\. The owner runs `npm login` and publishes 0\.1\.0 by hand with\n   `npm publish --access public` \(no provenance\)\./);
    assert.match(text, /2\. Push the `v0\.1\.0` tag[\s\S]*?waits\n   for the owner's approval in the `release` environment, checks the tag against\n   package\.json, runs tests and check, and skips publishing because 0\.1\.0 is already\n   on the registry\./);
    assert.match(text, /3\. The owner adds the Trusted Publisher on npmjs\.com/);
    assert.match(text, /4\. Release 0\.1\.1 as the first workflow publish\. It must publish successfully within\n   2 days of creating the trust configuration/);
    const steps = [...text.matchAll(/^[1-4]\. /gm)].map(match => match[0]);
    assert.deepEqual(steps, ['1. ', '2. ', '3. ', '4. '], file);
  }
});

test('historical saving figures stay outside the public tree', () => {
  const banned = new RegExp('99' + '\\.81%');
  for (const file of walk(root).filter(f => !path.relative(root, f).split(path.sep).some(p => ['.git', '.repo-build', 'node_modules', '__pycache__', '.agents', '.codex', '.aws'].includes(p)) && !/\.(tgz|pyc)$/.test(f))) assert.ok(!banned.test(fs.readFileSync(file, 'utf8')), path.relative(root, file));
});
