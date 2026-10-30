import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '../website/build.mjs';
import { featuredProof, visibleText } from '../website/facts.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = 'https://lean-browser-use.aunysillyme.dev';
const routes = ['/', '/docs/overview/', '/docs/how-it-works/', '/docs/guides/', '/docs/commands/',
  '/docs/proof/', '/docs/changelog/', '/docs/install/', '/docs/guarantees/'];
// Placeholder commit used to generate the saved mock, independent of repository history.
const testCommit = '0000000000000000000000000000000000000000';
const read = (dir, file) => readFileSync(join(dir, file), 'utf8');
const text = html => html.replace(/<(script|style)\b[^]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&(?:amp|lt|gt|quot|#39);/g, value => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[value])
  .replace(/\s+/g, ' ').trim();
const pageFile = route => route === '/' ? 'index.html' : route.slice(1) + 'index.html';
const markdownFile = route => pageFile(route).replace(/\.html$/, '.md');

function write(dir, file, value) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), value);
}

function files(dir, prefix = '') {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return ['.git', 'node_modules', '.venv', 'dist', 'build', '__pycache__'].includes(entry.name) ? [] : files(dir, name);
    return entry.isFile() ? [name] : [];
  }).sort();
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'website-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const inputs = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'CREDITS.md'];
  inputs.push(...JSON.parse(read(root, 'website/tools.json')).flatMap(tool => tool.source));
  for (const folder of ['docs', 'skills', 'reader', 'searxng', 'src', 'bin', 'hooks', 'agents', 'briefs', 'proof', 'website']) {
    inputs.push(...files(join(root, folder)).filter(file => !file.split('/').some(part =>
      ['node_modules', 'dist', '__pycache__'].includes(part))).map(file => `${folder}/${file}`));
  }
  for (const file of new Set(inputs)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(root, file), join(dir, file));
  }
  return dir;
}

function build(dir, { live = false, out = 'output', buildTime } = {}) {
  const code = `import { buildSite } from './website/build.mjs';\n` +
    `await buildSite(${JSON.stringify({ root: dir, outDir: join(dir, out), live, commit: testCommit, ...(buildTime ? { buildTime } : {}) })});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: dir, encoding: 'utf8',
  });
  return { ...result, dir: join(dir, out) };
}

function built(dir, options) {
  const result = build(dir, options);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.dir;
}

function htmlPages(dir) {
  return routes.map(route => [route, read(dir, pageFile(route))]);
}

function modePolicy(dir, live) {
  const allFiles = files(dir);
  const pages = htmlPages(dir);
  assert.equal(allFiles.filter(file => file.endsWith('.html')).length, routes.length + 1);
  for (const [route, html] of pages) {
    assert.equal(/<meta\b[^>]*name="robots"[^>]*content="noindex"/i.test(html), !live, route);
    assert.equal(html.includes('rel="describedby"'), live, route);
    assert.equal(html.includes('type="text/markdown"'), live, route);
    assert.equal(html.includes('property="og:image"'), live, route);
    assert.equal(html.includes('name="twitter:image"'), live, route);
    assert.equal(existsSync(join(dir, markdownFile(route))), live, route);
    if (live) {
      assert.ok(html.includes(`${origin}/llms.txt`), route);
      assert.ok(html.includes(`${origin}${route}index.md`), route);
      assert.ok(html.includes(`${origin}/assets/social-preview.png`), route);
    }
  }
  const landing = pages[0][1];
  assert.equal(landing.includes('"sameAs"'), live);
  assert.match(read(dir, '404.html'), /<meta\b[^>]*name="robots"[^>]*content="noindex"/);
  assert.match(read(dir, 'robots.txt'), /User-agent: \*/);
  if (live) {
    assert.match(read(dir, 'robots.txt'), /^Allow: \/$/m);
    assert.match(read(dir, 'robots.txt'), new RegExp(`Sitemap: ${origin.replaceAll('.', '\\.')}\\/sitemap\\.xml`));
    const locations = [...read(dir, 'sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    assert.deepEqual(locations.sort(), routes.map(route => origin + route).sort());
    const llms = read(dir, 'llms.txt');
    assert.match(llms, /^# lean-browser-use\n/m);
    assert.match(llms, /^> .+/m);
    assert.match(llms, /npx lean-browser-use/);
    for (const route of routes) assert.ok(llms.includes(origin + route), route);
    const sections = llms.split(/^## /m).slice(1);
    assert.ok(sections.length);
    for (const section of sections) assert.match(section, /\[[^\]]+\]\(https:\/\//);
    assert.ok(llms.indexOf(origin + '/docs/overview/') < llms.indexOf('https://github.com/'));
    assert.ok(read(dir, 'llms-full.txt').includes('Cut browser use cost by about 25%.'));
    assert.ok(read(dir, 'llms-full.txt').includes('How'));
  } else {
    assert.match(read(dir, 'robots.txt'), /^Disallow: \/$/m);
    for (const file of ['sitemap.xml', 'llms.txt', 'llms-full.txt']) assert.ok(!allFiles.includes(file), file);
    assert.ok(!allFiles.some(file => file.endsWith('.md')));
    for (const [, html] of pages) assert.ok(!html.includes('"sameAs"'));
  }
}

function toolPolicy(dir, tools) {
  const pages = htmlPages(dir);
  for (const tool of tools) {
    const blocks = pages.flatMap(([route, html]) => [...html.matchAll(/<article\b[^>]*data-tool="([^"]+)"[^>]*>([^]*?)<\/article>/g)]
      .filter(match => match[1] === tool.id).map(match => ({ route, body: match[2] })));
    assert.equal(blocks.length, 1, tool.id);
    const heading = blocks[0].body.match(/<h[2-6]\b[^>]*>([^]*?)<\/h[2-6]>/)?.[1] || '';
    assert.ok(text(heading).toLowerCase().includes(tool.keywords.primary.toLowerCase()), tool.id);
    assert.ok(text(blocks[0].body).includes(tool.does), tool.id);
    for (const command of tool.commands) assert.ok(text(blocks[0].body).includes(command), tool.id);
  }
}

test('removing comments does not manufacture active markup or erase surrounding text', () => {
  const input = '<scr<!--comment-->ipt>visible</script> tail';
  assert.match(visibleText(input), /visible/);
  assert.match(renderMarkdown(input), /visible/);
  assert.doesNotMatch(renderMarkdown(input), /<script\b/i);
  assert.equal(visibleText('<script>hidden<!--comment--></script> visible'), 'visible');
  assert.equal(visibleText('<script>hidden</script><script>also hidden</script>safe'), 'safe');
  const splitScript = '<scr<script>hidden</script>ipt>visible</script>';
  assert.match(renderMarkdown(splitScript), /visible/);
  assert.doesNotMatch(renderMarkdown(splitScript), /<script\b|hidden/i);
  assert.match(visibleText(splitScript), /visible/);
  assert.match(text(splitScript), /visible/);
  const splitComment = '<!<!--gap-->-- secret --> tail';
  assert.doesNotMatch(renderMarkdown(splitComment), /<!--/);
  assert.match(renderMarkdown(splitComment), /secret/);
});

test('live markdown twins keep source-encoded HTML inert', t => {
  const dir = fixture(t);
  write(dir, 'docs/how-it-works.md', read(dir, 'docs/how-it-works.md') + '\n\nEncoded &lt;script&gt;alert(7)&lt;/script&gt; and code `<script>alert(8)</script>` example.\n');
  const output = built(dir, { live: true });
  const twin = read(output, 'docs/how-it-works/index.md');
  assert.match(twin, /Encoded &lt;script&gt;alert\(7\)&lt;\/script&gt;/i);
  assert.match(twin, /`<script>alert\(8\)<\/script>`/i);
});

test('refused image-only badge links render no paragraph or URL text; text links remain', () => {
  const badges = '[![Version](https://img.shields.io/npm/v/example)](https://www.npmjs.com/package/example) ' +
    '[![Checks](https://example.org/badge.svg)](https://github.com/example/project)';
  assert.equal(renderMarkdown(badges), '');
  assert.equal(renderMarkdown('[Source](https://example.org/project)'), '<p><a href="https://example.org/project">Source</a></p>');
  assert.equal(renderMarkdown(badges + '\n\n[Source](https://example.org/project)'), '<p><a href="https://example.org/project">Source</a></p>');
  assert.equal(renderMarkdown('[![Badge](https://example.org/badge.svg) Source](https://example.org/project)'), '<p><a href="https://example.org/project"> Source</a></p>');
  assert.match(renderMarkdown('[![Preview](/assets/poster.png)](https://example.org/project)'), /<a href="https:\/\/example.org\/project"><img src="\/assets\/poster.png"/);
});

test('RED build exits 1 for package and README set description drift, then accepts parity', t => {
  const dir = fixture(t);
  const original = read(dir, 'package.json');
  const pkg = JSON.parse(original);
  pkg.description += '!';
  write(dir, 'package.json', JSON.stringify(pkg));
  const failed = spawnSync(process.execPath, ['website/build.mjs'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, VERCEL_GIT_COMMIT_SHA: testCommit },
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Description parity|description.*differ/i);
  assert.ok(!existsSync(join(dir, 'website/dist/index.html')));
  write(dir, 'package.json', original);
  built(dir);
});

test('RED default discovery policy detects a planted noindex defect; both modes cover nine pages', t => {
  const dir = fixture(t);
  const preview = built(dir);
  const original = read(preview, 'docs/overview/index.html');
  write(preview, 'docs/overview/index.html', original.replace(/<meta\b[^>]*name="robots"[^>]*content="noindex"[^>]*>/, ''));
  assert.throws(() => modePolicy(preview, false));
  write(preview, 'docs/overview/index.html', original);
  modePolicy(preview, false);
  const live = built(dir, { live: true, out: 'public' });
  const sitemap = read(live, 'sitemap.xml');
  write(live, 'sitemap.xml', sitemap.replace(/<loc>[^<]+<\/loc>/, ''));
  assert.throws(() => modePolicy(live, true));
  write(live, 'sitemap.xml', sitemap);
  modePolicy(live, true);
});

test('RED every tool appears once under its primary heading; removing its page assignment fails', t => {
  const dir = fixture(t);
  const tools = JSON.parse(read(dir, 'website/tools.json'));
  const output = built(dir);
  toolPolicy(output, tools);
  const pages = read(dir, 'website/pages.mjs');
  const defect = pages.replace(/(['"])skill\1/, "'omitted-tool-for-test'");
  assert.notEqual(defect, pages);
  write(dir, 'website/pages.mjs', defect);
  assert.notEqual(build(dir, { out: 'bad-map' }).status, 0);
  write(dir, 'website/pages.mjs', pages);
  toolPolicy(built(dir, { out: 'repaired-map' }), tools);
});

test('RED links select included routes and excluded blobs, and remote images are refused', t => {
  const dir = fixture(t);
  write(dir, 'docs/how-it-works.md', read(dir, 'docs/how-it-works.md') + '\n\n[Included source](../README.md)\n\n[Excluded source](../LICENSE)\n\n![Remote source](https://example.org/remote-test-image.png)\n');
  const output = built(dir);
  const html = read(output, 'docs/how-it-works/index.html');
  const check = value => {
    assert.match(value, /href="\/docs\/overview\/"[^>]*>Included source<\/a>/);
    assert.match(value, /href="https:\/\/github.com\/aunysillyme\/lean-browser-use\/blob\/main\/LICENSE"[^>]*>Excluded source<\/a>/);
    assert.doesNotMatch(value, /<img\b[^>]*src="https:\/\/example.org\/remote-test-image.png"/);
  };
  assert.throws(() => check(html.replace(/href="\/docs\/overview\/"([^>]*>Included source<\/a>)/, 'href="../README.md"$1')));
  check(html);
});

test('RED source sanitization removes executable script and inline event handlers', t => {
  const dir = fixture(t);
  const payload = '<script>window.sourcePayload = true</script><p onclick="sourcePayload()">Safe source text</p>';
  write(dir, 'docs/how-it-works.md', read(dir, 'docs/how-it-works.md') + '\n\n' + payload + '\n');
  const html = read(built(dir), 'docs/how-it-works/index.html');
  const check = value => {
    // Reject the unique payload anywhere, including scripts with unusual end tags.
    assert.ok(!value.includes('sourcePayload'));
    assert.doesNotMatch(value, /<[^>]+\son[a-z]+\s*=/i);
    assert.ok(text(value).includes('Safe source text'));
  };
  for (const closingTag of ['</script >', '</ScRiPt data-extra>', '</script/>']) {
    assert.throws(() => check(html + `<script>window.sourcePayload = true${closingTag}`), closingTag);
  }
  assert.throws(() => check(html + payload));
  check(html);
});

test('RED hero has approved headline and visible keywords, with the prohibited headline absent', t => {
  const dir = fixture(t);
  const html = read(built(dir), 'index.html');
  const check = value => {
    const hero = value.match(/<section\b[^>]*class="[^"]*hero[^]*?<\/section>/)?.[0] || '';
    for (const phrase of ['browser use', 'Claude Code', 'tokens', 'subagent', 'fresh context']) assert.ok(text(hero).includes(phrase), phrase);
    for (const heading of value.matchAll(/<h[1-6]\b[^>]*>([^]*?)<\/h[1-6]>/g)) assert.doesNotMatch(text(heading[1]), /your agent keeps working/i);
    assert.match(text(hero), /Cut browser use cost by about 25%\. A fresh runner, bulk reads, three guards\./);
  };
  assert.throws(() => check(html.replace('Cut browser use cost by about 25%.', 'Your agent keeps working')));
  check(html);
});

test('RED unverified release stays pending and a verified local release shows its version', t => {
  const dir = fixture(t);
  rmSync(join(dir, 'website/release.json'), { force: true });
  const pending = value => assert.match(text(value), /v0\.1\.2 not released yet/);
  const initial = read(built(dir), 'index.html');
  assert.throws(() => pending(initial.replace('not released yet', 'released')));
  pending(initial);
  write(dir, 'website/release.json', JSON.stringify({ version: '0.1.2', verified: false }));
  pending(read(built(dir, { out: 'unverified' }), 'index.html'));
  write(dir, 'website/release.json', JSON.stringify({ version: '0.1.2', verified: true }));
  const verified = text(read(built(dir, { out: 'verified' }), 'index.html'));
  assert.ok(verified.includes('0.1.2'));
  assert.ok(!verified.includes('not released yet'));
});

test('RED deterministic builds differ only in build time and default landing equals saved mock', t => {
  const dir = fixture(t);
  const first = built(dir, { out: 'first', buildTime: '2026-10-25T12:00:00.000Z' });
  const second = built(dir, { out: 'second', buildTime: '2026-10-25T12:01:00.000Z' });
  const snapshot = output => files(output).map(file => [file, file === 'build-info.json'
    ? JSON.stringify({ ...JSON.parse(read(output, file)), buildTime: '' })
    : readFileSync(join(output, file)).toString('base64')]);
  const expected = snapshot(first);
  const defect = snapshot(second);
  defect[0][1] += 'changed';
  assert.throws(() => assert.deepEqual(defect, expected));
  assert.deepEqual(snapshot(second), expected);
  const info = JSON.parse(read(first, 'build-info.json'));
  assert.equal(info.commit, testCommit);
  assert.equal(info.buildTime, '2026-10-25T12:00:00.000Z');
  assert.equal(info.packageVersion, JSON.parse(read(dir, 'package.json')).version);
  assert.equal(info.mode, 'default');
  assert.equal(info.pageCount, routes.length);
  assert.equal(read(first, 'index.html'), read(dir, 'website/mock/index.html'));
});

test('RED build imports keep the zero dependency boundary', () => {
  const code = read(root, 'website/build.mjs');
  const check = value => {
    const imports = [...value.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)].map(match => match[1]);
    assert.ok(imports.length);
    for (const name of imports) assert.ok(name.startsWith('node:') || /^\.\/[^/]+\.mjs$/.test(name), name);
    assert.doesNotMatch(value, /\b(?:fetch|XMLHttpRequest)\s*\(/);
  };
  assert.throws(() => check(code + "\nimport 'unexpected-package';\n"));
  check(code);
});

test('metadata, unique anchors, breadcrumbs, proof dates and same origin assets are complete', t => {
  const dir = fixture(t);
  const output = built(dir);
  const proof = JSON.parse(read(dir, 'proof/results.json')).rows.filter(row => row.id !== 'install_ms' && !/^guard_ms/.test(row.id) && row.unit !== 'ms');
  for (const [route, html] of htmlPages(output)) {
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1, route);
    const title = text(html.match(/<title>([^]*?)<\/title>/)?.[1] || '');
    assert.ok(title.length > 0 && title.length <= 60, route);
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.ok(html.includes(`<link rel="canonical" href="${origin}${route}">`), route);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, route);
    assert.match(html, /aria-current="(?:page|location)"/);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
    assert.deepEqual(blocks.map(block => block['@type']), route === '/' ? ['SoftwareApplication', 'FAQPage'] : ['BreadcrumbList']);
    if (route !== '/') {
      const visible = text(html.match(/<nav\b[^>]*aria-label="Breadcrumb"[^>]*>([^]*?)<\/nav>/i)?.[1] || '');
      assert.equal(blocks[0].itemListElement.length, 2);
      for (const item of blocks[0].itemListElement) assert.ok(visible.includes(item.name), item.name);
    }
    for (const match of html.matchAll(/<(?:script|img)\b[^>]*\bsrc="([^"]+)"/g)) assert.ok(match[1].startsWith('/assets/'), match[1]);
    assert.match(html, /href="\/assets\/site.css"/);
    assert.match(html, /src="\/assets\/site.js"/);
    assert.doesNotMatch(html, /<(?:iframe|audio)\b|googletagmanager|google-analytics/i);
  }
  const landing = read(output, 'index.html');
  const rowIds = html => [...html.matchAll(/<tr data-proof="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(rowIds(landing), featuredProof({ proof }).map(row => row.id));
  assert.deepEqual(rowIds(read(output, 'docs/proof/index.html')), proof.map(row => row.id));
  assert.ok(rowIds(landing).length < proof.length);
  for (const row of featuredProof({ proof })) {
    assert.ok(landing.includes(row.measured.slice(0, 10)), row.id);
    if (row.expires) assert.ok(landing.includes(row.expires.slice(0, 10)), row.id);
  }
  for (const asset of ['poster.png', 'social-preview.png', 'site.css', 'site.js']) assert.ok(existsSync(join(output, 'assets', asset)), asset);
  assert.deepEqual([...readFileSync(join(output, 'assets/social-preview.png')).subarray(16, 24)], [0, 0, 4, 176, 0, 0, 2, 118]);
  assert.doesNotMatch(read(output, 'assets/site.js'), /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
});

test('RED live build requires every local trailer asset before replacing output', t => {
  const dir = fixture(t);
  const output = built(dir, { live: true });
  const original = read(output, 'index.html');
  for (const asset of ['trailer.mp4', 'trailer.webm', 'trailer-poster.jpg']) {
    const path = join(dir, 'website/assets', asset);
    const bytes = readFileSync(path);
    rmSync(path);
    const result = build(dir, { live: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Live build asset missing: website\/assets\/trailer/);
    assert.equal(read(output, 'index.html'), original);
    writeFileSync(path, bytes);
  }
  built(dir, { live: true });
});

test('RED copy pins stop source drift before replacing the existing build', t => {
  const dir = fixture(t);
  const output = built(dir);
  const originalOutput = read(output, 'index.html');
  for (const [file, transform, diagnostic] of [
    ['README.md', text => text.replace('and see your own saving.**', 'and see a changed saving.**'), /pinned headline source/],
    ['website/content.mjs', text => text.replace("command: 'npx lean-browser-use'", "command: 'npx other-package'"), /pinned install command/],
  ]) {
    const original = read(dir, file);
    const changed = transform(original);
    assert.notEqual(changed, original);
    write(dir, file, changed);
    const failed = build(dir);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, diagnostic);
    assert.equal(read(output, 'index.html'), originalOutput);
    write(dir, file, original);
  }
  built(dir);
});
