import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSite } from '../website/build.mjs';
import { checkSite, expectedFiles } from '../website/check.mjs';
import { pages } from '../website/pages.mjs';
import { termHashes } from '../scripts/gate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (dir, file) => readFileSync(join(dir, file), 'utf8');
const doc = 'docs/overview/index.html';
const now = '2026-10-25T19:00:00.000Z';
// Placeholder commit used to generate the saved mock, independent of repository history.
const testCommit = '0000000000000000000000000000000000000000';
let work;
const sources = {};
function write(dir, file, value) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), value);
}
function edit(dir, file, transform) {
  const original = read(dir, file), changed = transform(original);
  assert.notEqual(changed, original, `mutation must change ${file}`);
  write(dir, file, changed);
}
function jsonBlock(html, transform, index = 0) {
  let current = -1;
  return html.replace(/(<script type="application\/ld\+json">)([^]*?)(<\/script>)/g, (all, open, body, close) =>
    ++current === index ? open + JSON.stringify(transform(JSON.parse(body))) + close : all);
}
function append(dir, file, fragment) { edit(dir, file, html => html.replace('</body>', fragment + '</body>')); }
function run(dir, options = {}) { return checkSite({ dist: dir, now, ...options }); }
function fixture(t, live = false) {
  const dir = mkdtempSync(join(work, 'case-'));
  cpSync(sources[live ? 'live' : 'default'], dir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

before(() => {
  work = mkdtempSync(join(tmpdir(), 'website-check-'));
  for (const live of [false, true]) {
    const dir = join(work, live ? 'live' : 'default');
    buildSite({ outDir: dir, live, commit: testCommit });
    sources[live ? 'live' : 'default'] = dir;
    assert.deepEqual(run(dir, { live }), []);
  }
});
after(() => { if (work) rmSync(work, { recursive: true, force: true }); });

for (const [name, commit] of [['A', '1111111111111111111111111111111111111111'],
  ['B', '2222222222222222222222222222222222222222'],
  ['third', '3333333333333333333333333333333333333333']]) {
  test(`golden rule accepts commit ${name} with the saved mock unchanged`, t => {
    const mock = readFileSync(join(root, 'website/mock/index.html'));
    const dir = fixture(t);
    buildSite({ outDir: dir, commit });
    assert.ok(read(dir, 'index.html').includes(`/commit/${commit}">${commit.slice(0, 7)}</a>`));
    assert.deepEqual(run(dir), []);
    assert.deepEqual(readFileSync(join(root, 'website/mock/index.html')), mock);
  });
}

test('RED golden rule rejects one changed word; restoring the output passes', t => {
  const dir = fixture(t);
  const original = read(dir, 'index.html');
  edit(dir, 'index.html', html => html.replace('MIT licensed.', 'MIT changed.'));
  const findings = run(dir);
  assert.deepEqual(findings, ['index.html: default landing differs from saved mock']);
  t.diagnostic(findings[0]);
  write(dir, 'index.html', original);
  assert.deepEqual(run(dir), []);
});

for (const field of ['short sha', 'commit URL']) {
  test(`golden rule ignores a change only in the ${field}`, t => {
    const dir = fixture(t);
    edit(dir, 'index.html', html => field === 'short sha'
      ? html.replace(`>${testCommit.slice(0, 7)}</a>`, '>abcdef0</a>')
      : html.replace(`/commit/${testCommit}`, '/commit/abcdef0123456789abcdef0123456789abcdef01'));
    assert.deepEqual(run(dir), []);
  });
}

test('website test sources contain no revision lookup tokens', () => {
  const forbidden = new RegExp(['rev' + '-parse', 'HE' + 'AD'].join('|'));
  const tests = readdirSync(join(root, 'test')).filter(file => /^website-.*\.test\.mjs$/.test(file));
  assert.ok(tests.length >= 3);
  for (const file of tests) assert.doesNotMatch(read(root, `test/${file}`), forbidden, file);
});

function red(name, mutate, diagnostic, { live = false, options = {} } = {}) {
  test(`RED ${name}; restoring the output passes`, t => {
    const dir = fixture(t, live);
    const original = join(work, `original-${Math.random().toString(16).slice(2)}`);
    cpSync(dir, original, { recursive: true });
    mutate(dir);
    const findings = run(dir, { live, ...options });
    assert.ok(findings.some(finding => diagnostic.test(finding)), findings.join('\n'));
    rmSync(dir, { recursive: true });
    cpSync(original, dir, { recursive: true });
    rmSync(original, { recursive: true });
    assert.deepEqual(run(dir, { live }), []);
  });
}

red('two H1s', dir => append(dir, doc, '<h1>Extra</h1>'), /expected one H1/);
red('title over 60 characters', dir => edit(dir, doc, html => html.replace(/<title>[^]*?<\/title>/, `<title>${'x'.repeat(61)}</title>`)), /title must have/);
red('changed landing meta description', dir => edit(dir, 'index.html', html => html.replace(/(<meta name="description" content=")[^"]+/, '$1Changed')), /landing description differs/);
red('wrong canonical', dir => edit(dir, doc, html => html.replace('rel="canonical" href="https://lean-browser-use.aunysillyme.dev/docs/overview/', 'rel="canonical" href="https://example.org/')), /wrong canonical/);
red('duplicate id', dir => append(dir, doc, '<p id="main">Duplicate</p>'), /duplicate id/);
red('dead anchor', dir => append(dir, doc, '<a href="#absent">Missing</a>'), /unresolved anchor/);
red('dead cross-page anchor', dir => append(dir, doc, '<a href="/docs/install/#absent">Missing</a>'), /unresolved anchor/);
red('dead internal link', dir => append(dir, doc, '<a href="/missing/">Missing</a>'), /unresolved file/);
red('dead internal src', dir => append(dir, doc, '<img src="/assets/missing.png" alt="Missing">'), /unresolved file/);
red('two sidebar pages marked aria-current', dir => edit(dir, doc, html => html.replace('href="/docs/install/"', 'href="/docs/install/" aria-current="page"')), /sidebar must mark/);
red('wrong sidebar current page', dir => edit(dir, doc, html => html.replace('href="/docs/overview/" class="active"', 'href="/docs/install/" class="active"')), /sidebar must mark/);
for (const live of [false, true]) {
  red(`${live ? 'live' : 'default'} 404 marks a sidebar link`, dir => edit(dir, '404.html', html => html.replace('</aside>', '<a href="/404.html" aria-current="page">Missing</a></aside>')), /404 must not mark a current sidebar page/, { live });
  red(`${live ? 'live' : 'default'} 404 without noindex`, dir => edit(dir, '404.html', html => html.replace('<meta name="robots" content="noindex">', '')), /404 must keep noindex/, { live });
}
red('aggregateRating in JSON-LD', dir => edit(dir, 'index.html', html => jsonBlock(html, block => ({ ...block, aggregateRating: 5 }))), /forbidden JSON-LD property: aggregateRating/);
red('review in JSON-LD', dir => edit(dir, 'index.html', html => jsonBlock(html, block => ({ ...block, review: 'Good' }))), /forbidden JSON-LD property: review/);
red('unknown JSON-LD property', dir => edit(dir, doc, html => jsonBlock(html, block => ({ ...block, madeUpTerm: true }))), /unknown JSON-LD property: madeUpTerm/);
red('unknown nested Offer property', dir => edit(dir, 'index.html', html => jsonBlock(html, block => ({ ...block, offers: { ...block.offers, madeUpTerm: true } }))), /unknown JSON-LD property: madeUpTerm/);
red('BreadcrumbList differs from visible breadcrumb', dir => edit(dir, doc, html => jsonBlock(html, block => ({ ...block, itemListElement: block.itemListElement.map((item, index) => index ? item : { ...item, name: 'Elsewhere' }) }))), /BreadcrumbList names differ/);
red('sameAs in default mode', dir => edit(dir, 'index.html', html => jsonBlock(html, block => ({ ...block, sameAs: ['https://www.npmjs.com/package/lean-browser-use'] }))), /sameAs in default mode/);
red('noindex in live mode', dir => edit(dir, doc, html => html.replace('</head>', '<meta name="robots" content="noindex"></head>')), /noindex in live mode/, { live: true });
for (const file of ['sitemap.xml', 'llms.txt', 'llms-full.txt', 'docs/install/index.md', 'assets/social-preview.png']) {
  red(`live missing ${file}`, dir => rmSync(join(dir, file)), /missing output file/, { live: true });
}
red('100 x 100 PNG', dir => {
  const png = readFileSync(join(dir, 'assets/social-preview.png'));
  png.writeUInt32BE(100, 16); png.writeUInt32BE(100, 20);
  write(dir, 'assets/social-preview.png', png);
}, /expected a 1200 x 630 PNG/, { live: true });
red('sitemap with ten URLs', dir => edit(dir, 'sitemap.xml', xml => xml.replace('</urlset>', '<url><loc>https://lean-browser-use.aunysillyme.dev/extra/</loc></url></urlset>')), /sitemap must list exactly/, { live: true });
red('external script tag', dir => append(dir, doc, '<script src="https://example.org/test.js"></script>'), /external resource: script/);
red('gtag snippet', dir => append(dir, doc, '<script>gtag("config", "test");</script>'), /analytics or tag-manager/);
red('external image', dir => append(dir, doc, '<img src="https://example.org/test.png" alt="Test">'), /external resource: img/);
red('external stylesheet', dir => append(dir, doc, '<link rel="stylesheet" href="https://example.org/test.css">'), /external resource: link/);
red('external CSS font', dir => edit(dir, 'assets/site.css', css => css + '\n@font-face { src: url(https://example.org/test.woff); }'), /external CSS resource/);
red('external iframe', dir => append(dir, doc, '<iframe src="https://example.org/"></iframe>'), /external resource: iframe/);
red('external video source', dir => append(dir, doc, '<video><source src="https://example.org/test.mp4"></video>'), /external resource: source/);
for (const href of ['http://example.org/project', 'https://user:pass' + '@' + 'example.org/project', `https://${[127, 0, 0, 1].join('.')}/project`,
  'https://[::1]/project', 'https://2130706433/project', 'https://localhost/project', 'https://docs.localhost./project']) {
  red(`unsafe external anchor ${href}`, dir => append(dir, doc, `<a href="${href}">Source</a>`), /unsafe external anchor/);
}

test('HTTPS upstream credit anchors pass with their original labels', t => {
  const dir = fixture(t);
  const links = ['https://github.com/trycua/cua', 'https://github.com/unclecode/crawl4ai',
    'https://github.com/rtk-ai/rtk', 'https://github.com/searxng/searxng', 'https://pypi.org/project/typesafe-sdk/'];
  for (const href of links) assert.ok(read(dir, doc).includes(`href="${href}"`), href);
  append(dir, doc, '<a href="https://github.com/elsewhere/project">Source</a><a href="https://example.org/project">Text link</a>');
  assert.deepEqual(run(dir), []);
});
red('proof claim label differs', dir => edit(dir, 'docs/proof/index.html', html => html.replace('<th scope="row">Runtime dependencies</th>', '<th scope="row">Changed measurement</th>')), /proof label differs: runtime_dependencies/);
red('proof number differs', dir => edit(dir, 'docs/proof/index.html', html => html.replace('<td data-value>0 dependencies</td>', '<td data-value>1 dependencies</td>')), /proof value differs: runtime_dependencies/);
red('expired proof row at --now', dir => append(dir, doc, '<p>Clock check</p>'), /expired proof row/, { options: { now: '2028-01-01T00:00:00Z' } });
red('unknown command flag', dir => append(dir, doc, '<pre><code>npx lean-browser-use --invented-flag</code></pre>'), /Undocumented flag/);
red('flag prefix is not documentation', dir => append(dir, doc, '<pre><code>reader/reader --jso</code></pre>'), /Undocumented flag/);
red('tool description changed', dir => edit(dir, 'docs/how-it-works/index.html', html => html.replace(/(<article data-tool="runner"[^]*?<p data-does>)[^]*?(<\/p>)/, '$1Changed tool description.$2')), /tool description differs: runner/);
red('tool commands changed', dir => edit(dir, 'docs/commands/index.html', html => html.replace(/(<article data-tool="reader"[^]*?<code>)[^]*?(<\/code>)/, '$1invented-command$2')), /tool commands differ: reader/);
red('tool entry shown twice', dir => {
  const article = read(dir, 'docs/how-it-works/index.html').match(/<article data-tool="runner"[^]*?<\/article>/)[0];
  append(dir, doc, article);
}, /tool must appear exactly once: runner \(2\)/);
red('tool entry shown on no page', dir => edit(dir, 'docs/how-it-works/index.html', html => html.replace(/<article data-tool="runner"[^]*?<\/article>/, '')), /tool must appear exactly once: runner \(0\)/);
red('tool heading without primary phrase', dir => edit(dir, 'docs/how-it-works/index.html', html => html.replace(/(<article data-tool="runner"[^]*?<h3\b[^>]*>)[^]*?(<\/h3>)/, '$1Other heading$2')), /Heading missing primary phrase for runner/);
red('forbidden H1 headline', dir => edit(dir, doc, html => html.replace('<h1 id="page-title">Overview</h1>', '<h1 id="page-title">Your agent keeps working</h1>')), /forbidden headline/);
red('hero missing fresh context', dir => edit(dir, 'index.html', html => html.replace(/(<section class="hero"[^]*?<\/section>)/, hero => hero.replaceAll('fresh context', 'other context'))), /hero missing fresh context/);
red('email address', dir => append(dir, doc, '<p>person' + '@' + 'example.org</p>'), /email address/);
red('private issue id', dir => append(dir, doc, `<p>AU${'N'}-123</p>`), /private issue id/);
red('personal path', dir => append(dir, doc, `<p>/Us${'ers'}/sample/file</p>`), /personal path/);
red('private storage path', dir => append(dir, doc, '<p>Vau' + 'lts/notes/file</p>'), /private storage path/);
red('default index differs from saved mock', dir => append(dir, 'index.html', '<p>Extra copy</p>'), /default landing differs/);
red('unverified release version', dir => edit(dir, 'index.html', html => html.replace('not released yet', 'released')), /Fresh from the repo must say not released yet/);
red('unexpected output file', dir => write(dir, 'extra.txt', 'Extra'), /unexpected output file/);
red('missing default noindex', dir => edit(dir, doc, html => html.replace('<meta name="robots" content="noindex">', '')), /missing noindex/);
red('default discovery alternate', dir => append(dir, doc, '<link rel="alternate" type="text/markdown" href="/index.md">'), /markdown alternate in default mode/);
red('default describedby', dir => append(dir, doc, '<link rel="describedby" href="/llms.txt">'), /describedby in default mode/);
red('default og:image', dir => append(dir, doc, '<meta property="og:image" content="/assets/social-preview.png">'), /og:image in default mode/);
red('empty meta description', dir => edit(dir, doc, html => html.replace(/(<meta name="description" content=")[^"]+/, '$1')), /description must have/);
red('long meta description', dir => edit(dir, doc, html => html.replace(/(<meta name="description" content=")[^"]+/, '$1' + 'x'.repeat(161))), /description must have/);
red('wrong live describedby', dir => edit(dir, doc, html => html.replace('rel="describedby" href="https://lean-browser-use.aunysillyme.dev/llms.txt', 'rel="describedby" href="https://example.org/llms.txt')), /wrong describedby/, { live: true });
red('wrong live alternate', dir => edit(dir, doc, html => html.replace('type="text/markdown" href="https://lean-browser-use.aunysillyme.dev/docs/overview/index.md', 'type="text/markdown" href="https://example.org/index.md')), /wrong markdown alternate/, { live: true });
red('wrong live sameAs', dir => edit(dir, 'index.html', html => jsonBlock(html, block => ({ ...block, sameAs: [] }))), /landing JSON-LD differs/, { live: true });
red('wrong robots policy', dir => write(dir, 'robots.txt', 'User-agent: *\nAllow: /\n'), /wrong discovery policy/);

test('RED private hash match uses only a temporary hash file, then accepts removal', t => {
  const dir = fixture(t), termsFile = join(work, 'terms.sha256');
  writeFileSync(termsFile, termHashes('synthetic private phrase').join('\n') + '\n');
  const original = read(dir, doc);
  append(dir, doc, '<p>Synthetic private phrase</p>');
  assert.ok(run(dir, { termsFile }).some(finding => finding.includes('private term hash match')));
  write(dir, doc, original);
  assert.deepEqual(run(dir, { termsFile }), []);
});

test('exact mode inventory derives from pages and accepts both builder outputs', () => {
  assert.equal(expectedFiles().length, pages.length + 14);
  assert.equal(expectedFiles(true).length, pages.length * 2 + 17);
  assert.equal(expectedFiles().length, 23);
  assert.equal(expectedFiles(true).length, 35);
  for (const live of [false, true]) assert.deepEqual(run(sources[live ? 'live' : 'default'], { live }), []);
});

test('checker CLI returns failure lines, final count and status; --dist and --now select inputs', t => {
  const dir = fixture(t);
  const cli = args => spawnSync(process.execPath, ['website/check.mjs', '--dist', dir, '--now', now, ...args], { cwd: root, encoding: 'utf8' });
  const green = cli([]);
  assert.equal(green.status, 0, green.stderr);
  assert.equal(green.stdout, '0 failure(s).\n');
  append(dir, doc, '<h1>Extra</h1>');
  const red = cli([]);
  assert.equal(red.status, 1);
  assert.match(red.stderr, /expected one H1/);
  assert.equal(red.stderr.trim().split('\n').length, Number(red.stdout.match(/\d+/)[0]));
  const usage = cli(['--unknown']);
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /Usage:/);
  const expired = cli(['--now', '2028-01-01']);
  assert.equal(expired.status, 1);
  assert.match(expired.stderr, /expired proof row/);
  const live = spawnSync(process.execPath, ['website/check.mjs', '--live', '--dist', sources.live, '--now', now], { cwd: root, encoding: 'utf8' });
  assert.equal(live.status, 0, live.stderr);
});

test('tests keep built output outside website/dist', () => {
  assert.ok(!sources.default.startsWith(join(root, 'website/dist')));
  assert.ok(existsSync(join(sources.default, 'index.html')));
});

red('SVG external image', dir => edit(dir, 'assets/social-preview.svg', svg => svg.replace('</svg>', '<image href="https://example.org/pixel.png"/></svg>')), /external SVG resource/);
red('inline network script', dir => append(dir, doc, '<script>fetch("https://example.org/pixel");</script>'), /network or dynamic script call/);
red('external refresh URL', dir => append(dir, doc, '<meta http-equiv="refresh" content="0;url=https://example.org/">'), /external URL in meta/);
red('command flag with an underscore', dir => append(dir, doc, '<pre><code>reader/reader --invented_flag</code></pre>'), /Undocumented flag/);
red('missing proof row', dir => edit(dir, 'docs/proof/index.html', html => html.replace(/<tr data-proof="runtime_dependencies"[^]*?<\/tr>/, '')), /proof rows missing/);
red('encoded email address', dir => append(dir, doc, '<p>person&#64;example.org</p>'), /email address/);
red('text file containing a null byte still receives privacy checks', dir => edit(dir, 'assets/site.css', css => css + '\n/*\u0000person' + '@' + 'example.org*/'), /email address/);
red('external URL in visible text', dir => append(dir, doc, '<p>https://example.org/plain</p>'), /external URL outside allowed markup/);
for (const url of ['https://github.com/elsewhere/project', 'https://github.com/aunysillyme/other-project',
  'https://www.npmjs.com/package/other-project', 'https://example.org/project', 'http://example.org/project',
  '//example.org/project', 'ftp://example.org/project']) {
  red(`external URL in breadcrumb JSON-LD ${url}`, dir => edit(dir, doc, html => jsonBlock(html, block => ({ ...block, itemListElement: block.itemListElement.map((item, index) => index ? item : { ...item, item: url }) }))), /JSON-LD URL outside allowed pages/);
  red(`external sameAs URL ${url}`, dir => edit(dir, 'index.html', html => jsonBlock(html, block => ({ ...block, sameAs: [url] }))), /JSON-LD URL outside allowed pages/, { live: true });
}
test('JSON-LD project URLs accept only the package repo and npm page', t => {
  const dir = fixture(t);
  const original = read(dir, doc);
  for (const url of ['https://github.com/aunysillyme/lean-browser-use', 'https://www.npmjs.com/package/lean-browser-use']) {
    write(dir, doc, jsonBlock(original, block => ({ ...block,
      itemListElement: block.itemListElement.map((item, index) => index ? item : { ...item, item: url }) })));
    assert.deepEqual(run(dir), []);
  }
});
red('sameAs uses a schema URL', dir => edit(dir, 'index.html', html => jsonBlock(html, block => ({ ...block, sameAs: ['https://schema.org'] }))), /JSON-LD URL outside allowed pages/, { live: true });
red('external font preload', dir => append(dir, doc, '<link rel="preload" as="font" href="https://example.org/test.woff2">'), /external resource: link/);
red('external video', dir => append(dir, doc, '<video src="https://example.org/test.mp4"></video>'), /external resource: video/);
red('live robots restricts a path', dir => edit(dir, 'robots.txt', value => value + 'Disallow: /private/\n'), /wrong discovery policy/, { live: true });

test('RED every allowed JSON-LD type rejects an invented property', t => {
  const dir = fixture(t);
  const original = read(dir, 'index.html');
  const breadcrumb = read(dir, doc);
  for (const type of ['SoftwareApplication', 'Offer', 'Person', 'Organization', 'FAQPage', 'Question', 'Answer', 'BreadcrumbList', 'ListItem']) {
    const file = ['BreadcrumbList', 'ListItem'].includes(type) ? doc : 'index.html';
    const source = file === doc ? breadcrumb : original;
    let planted = false;
    const visit = object => {
      if (!object || typeof object !== 'object') return;
      if (object['@type'] === type) { object.inventedProperty = true; planted = true; }
      for (const child of Object.values(object)) if (Array.isArray(child)) child.forEach(visit); else visit(child);
    };
    const mutated = source.replace(/(<script type="application\/ld\+json">)([^]*?)(<\/script>)/g, (_, start, body, end) => {
      const block = JSON.parse(body); visit(block); return start + JSON.stringify(block) + end;
    });
    assert.ok(planted, type);
    write(dir, file, mutated);
    assert.ok(run(dir).some(finding => finding.includes('unknown JSON-LD property: inventedProperty')), type);
    write(dir, file, source);
    assert.deepEqual(run(dir), []);
  }
});

red('hero about 25 percent without a dollar qualifier', dir => edit(dir, 'index.html', html => html.replace(/<h1\b[^>]*>[^]*?<\/h1>/, '<h1>Cut browser use by about 25%.<br><em>A fresh runner, bulk reads, three guards.</em></h1>')), /dollar qualifier/);

red('broadened CSP', dir => edit(dir, doc, html => html.replace("connect-src 'none'", 'connect-src *')), /resource CSP differs/);
red('Google font lookalike host', dir => append(dir, doc, '<link rel="stylesheet" href="https://fonts.googleapis.com.example.org/css2">'), /external resource: link/);
red('Google host used for a script', dir => append(dir, doc, '<script src="https://fonts.googleapis.com/test.js"></script>'), /external resource: script/);
red('Google host used for media', dir => append(dir, doc, '<video src="https://fonts.gstatic.com/test.mp4"></video>'), /external resource: video/);
red('unapproved font stylesheet', dir => append(dir, doc, '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Other">'), /external resource: link/);
red('unapproved preconnect', dir => append(dir, doc, '<link rel="preconnect" href="https://example.org">'), /external resource: link/);
red('remote video poster', dir => append(dir, doc, '<video poster="https://example.org/poster.jpg"></video>'), /external resource: video/);
red('media outside local assets', dir => append(dir, doc, '<video src="/index.html"></video>'), /media must use local/);
red('encoded media traversal', dir => append(dir, doc, '<video src="/assets/%2e%2e/index.html"></video>'), /media must use local/);
red('em dash in copy', dir => append(dir, doc, `<p>Text${String.fromCharCode(0x2014)}copy</p>`), /em dash/);

test('pinned Google Fonts and local media pass the resource policy', t => {
  const dir = fixture(t);
  const html = read(dir, 'index.html');
  assert.match(html, /fonts.googleapis.com\/css2\?family=Cormorant\+Garamond/);
  assert.match(html, /<video autoplay muted loop playsinline preload="auto"/);
  for (const file of ['trailer.webm', 'trailer.mp4', 'trailer-poster.jpg']) assert.ok(existsSync(join(dir, 'assets', file)));
  append(dir, doc, '<video poster="/assets/trailer-poster.jpg"><source src="/assets/trailer.mp4" type="video/mp4"></video>');
  edit(dir, 'assets/site.css', css => css + '\n@font-face{font-family:Example;src:url(https://fonts.gstatic.com/s/jetbrainsmono/v1/example.woff2)}');
  assert.deepEqual(run(dir), []);
});
