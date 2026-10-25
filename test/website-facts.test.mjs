import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadFacts, buildJsonLd, buildFaqJsonLd, validateMock, validateTools, validateKeywords, visibleText, validateToolHeading, keywordCounts } from '../website/facts.mjs';

import { buildSite } from '../website/build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(join(root, file), 'utf8');
const html = read('website/mock/index.html');
const facts = loadFacts(root);
const testCommit = '0000000000000000000000000000000000000000';
const output = mkdtempSync(join(tmpdir(), 'website-facts-pages-'));
let documents;
try {
  const built = buildSite({ outDir: output, commit: testCommit });
  documents = built.pages.map(({ html }) => html).join('\n');
} finally { rmSync(output, { recursive: true, force: true }); }
const toolBlock = tool => documents.split(`<article data-tool="${tool.id}"`)[1].split('</article>')[0];
const copy = value => structuredClone(value);
const text = fragment => visibleText(fragment);

function write(root, file, content) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'website-facts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = ['package.json', 'README.md', 'proof/results.json',
    'website/facts.mjs', 'website/tools.json', 'website/mock/index.html', ...facts.tools.flatMap(tool => tool.source)];
  for (const file of new Set(files)) write(dir, file, read(file));
  return dir;
}

function jsonLdPolicy(value, live) {
  assert.ok(!JSON.stringify(value).match(/"(?:aggregateRating|review)"/));
  if (live) assert.deepEqual(value.sameAs, [facts.repository, facts.npm]);
  else assert.ok(!Object.hasOwn(value, 'sameAs'));
}

test('facts load package, visible proof, five FAQs, and setup rows from their sources', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(facts.description, pkg.description);
  assert.deepEqual(facts.proof, JSON.parse(read('proof/results.json')).rows.filter(row => row.id !== 'install_ms' && !/^guard_ms/.test(row.id) && row.unit !== 'ms'));
  assert.equal(facts.name, pkg.name);
  assert.equal(facts.version, pkg.version);
  assert.equal(facts.repository, pkg.repository.replace(/^git\+/, '').replace(/\.git$/, ''));
  assert.equal(facts.faq.length, 5);
  assert.equal(facts.setup.length, 10);
  const readme = read('README.md');
  assert.equal(facts.faq.map(row => `### ${row.question}\n\n${row.answerMarkdown}`).join('\n\n'),
    readme.split('## Common questions\n')[1].split('\n## ')[0].trim());
  for (const row of facts.faq) {
    assert.ok(readme.includes(`### ${row.question}\n\n${row.answerMarkdown}`));
    assert.equal(text(row.answerMarkdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').replace(/</g, '&lt;').replace(/>/g, '&gt;')), row.answer);
  }
});

test('RED description parity rejects a one-character package defect, then accepts the original', t => {
  const dir = fixture(t);
  const original = read('package.json');
  const pkg = JSON.parse(original);
  pkg.description += '!';
  write(dir, 'package.json', JSON.stringify(pkg));
  assert.throws(() => loadFacts(dir), /Description parity/);
  const failed = spawnSync(process.execPath, ['website/facts.mjs', '--check'], { cwd: dir, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /Description parity/);
  write(dir, 'package.json', original);
  assert.doesNotThrow(() => loadFacts(dir));
});

test('RED displayed proof number rejects a changed value, then accepts the receipt value', () => {
  const defect = html.replace('<td data-value>0 dependencies</td>', '<td data-value>1 dependencies</td>');
  assert.notEqual(defect, html);
  assert.throws(() => validateMock(facts, defect), /Proof value differs for runtime_dependencies/);
  assert.doesNotThrow(() => validateMock(facts, html));
});

test('RED displayed proof label rejects changed copy, then accepts the source claim', () => {
  const claim = facts.proof[0].claim;
  const defect = html.replace(`<th scope="row">${claim}</th>`, '<th scope="row">Changed measurement</th>');
  assert.notEqual(defect, html);
  assert.throws(() => validateMock(facts, defect), /Proof label differs/);
  assert.doesNotThrow(() => validateMock(facts, html));
});

test('RED expired proof row rejects a past expires, then accepts the current row', t => {
  const dir = fixture(t);
  const receipt = JSON.parse(read('proof/results.json'));
  receipt.rows[0].expires = '2000-01-01T00:00:00.000Z';
  write(dir, 'proof/results.json', JSON.stringify(receipt));
  assert.throws(() => loadFacts(dir), /Proof expired(?: or invalid)?: runtime_dependencies/);
  write(dir, 'proof/results.json', read('proof/results.json'));
  assert.doesNotThrow(() => loadFacts(dir));
});

test('RED FAQ question rejects a one-word page or README defect, then accepts verbatim text', t => {
  const question = facts.faq[0].question;
  const changed = question.replace('install', 'configure');
  assert.throws(() => validateMock(facts, html.replace(`<summary data-faq-question>${question}</summary>`, `<summary data-faq-question>${changed}</summary>`)), /FAQ questions differ/);
  const dir = fixture(t);
  write(dir, 'README.md', read('README.md').replace(question, changed));
  assert.throws(() => loadFacts(dir), /FAQ questions differ/);
  write(dir, 'README.md', read('README.md'));
  assert.doesNotThrow(() => loadFacts(dir));
});

test('FAQ answers equal visible copy and structured answers, and a changed answer fails', () => {
  const visible = [...html.matchAll(/<p data-faq-answer>([^]*?)<\/p>/g)].map(match => text(match[1]));
  assert.deepEqual(visible, facts.faq.map(row => row.answer));
  assert.deepEqual(buildFaqJsonLd(facts).mainEntity.map(row => row.acceptedAnswer.text), visible);
  const defect = html.replace(/(<p data-faq-answer>[^]*?)The installer copies the method, runner, briefs, and guards/, '$1The installer copies other parts');
  assert.notEqual(defect, html);
  assert.throws(() => validateMock(facts, defect), /FAQ answers differ/);
});

test('RED SoftwareApplication excludes ratings and reviews and gates both sameAs URLs on live', () => {
  for (const forbidden of ['aggregateRating', 'review']) {
    assert.throws(() => jsonLdPolicy({ ...buildJsonLd(facts), [forbidden]: {} }, false));
  }
  assert.throws(() => jsonLdPolicy({ ...buildJsonLd(facts), sameAs: [facts.repository] }, false));
  assert.throws(() => jsonLdPolicy({ ...buildJsonLd(facts, { live: true }), sameAs: [facts.repository] }, true));
  for (const live of [false, true]) jsonLdPolicy(buildJsonLd(facts, { live }), live);
  assert.deepEqual(buildJsonLd(facts), {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', '@id': facts.url + '#software',
    name: facts.name, description: facts.description, applicationCategory: 'DeveloperApplication',
    softwareRequirements: 'Node.js >=20 and Claude Code',
    license: 'https://spdx.org/licenses/MIT.html', isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, url: facts.url,
    author: { '@type': 'Person', '@id': 'https://www.aunysillyme.com/#person', name: 'Auny', url: 'https://www.aunysillyme.com/' },
    publisher: { '@type': 'Organization', '@id': 'https://www.aunysillyme.com/#organization', name: 'AunySillyMe', url: 'https://www.aunysillyme.com/' },
  });
});

test('RED static JSON-LD blocks reject a planted defect and equal both generated objects', () => {
  const defect = html.replace('"applicationCategory": "DeveloperApplication"', '"applicationCategory": "GameApplication"');
  assert.notEqual(defect, html);
  assert.throws(() => validateMock(facts, defect), /JSON-LD blocks differ/);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  assert.deepEqual(blocks, [buildJsonLd(facts, { live: false }), buildFaqJsonLd(facts)]);
});

test('RED every literal evidence anchor exists, and a planted absent string fails', () => {
  const tools = copy(facts.tools);
  for (let index = 0; index < tools.length; index++) {
    const defect = copy(tools);
    defect[index].must_appear.push('absent-source-anchor-for-test');
    assert.throws(() => validateTools(root, defect), /Source evidence missing/, tools[index].id);
  }
  assert.doesNotThrow(() => validateTools(root, facts.tools));
});

test('RED real command prefixes and documented flags reject planted violations', () => {
  const badCommand = copy(facts.tools);
  badCommand[0].commands.push('invented-command --json');
  assert.throws(() => validateTools(root, badCommand), /Invalid command/);
  const badFlag = copy(facts.tools);
  badFlag[0].commands.push('npx lean-browser-use --invented-flag');
  assert.throws(() => validateTools(root, badFlag), /Undocumented flag/);
  assert.doesNotThrow(() => validateTools(root, facts.tools));
});

test('RED keyword H1 rule rejects a planted heading and accepts both headline lines', () => {
  assert.throws(() => validateKeywords(facts, html.replace('Let your AI use the web.', 'Other headline')), /H1/);
  assert.doesNotThrow(() => validateKeywords(facts, html));
});

for (const phrase of ['browser use', 'Claude Code', 'tokens', 'subagent', 'fresh context']) {
  test(`RED first 100 words reject missing ${phrase} and accept the original`, () => {
    const defect = html.replaceAll(phrase, 'replacement');
    assert.throws(() => validateKeywords(facts, defect), /First 100 words/);
    assert.doesNotThrow(() => validateKeywords(facts, html));
  });
}

test('RED keyword title limit rejects more than 60 characters and accepts the short title', () => {
  assert.throws(() => validateKeywords(facts, html.replace(/<title>[^]*?<\/title>/, `<title>${'x'.repeat(61)}</title>`)), /Title/);
  assert.doesNotThrow(() => validateKeywords(facts, html));
});

test('RED meta description rejects drift and accepts package description verbatim', () => {
  const defect = html.replace(`<meta name="description" content="${facts.description}">`, '<meta name="description" content="Changed description">');
  assert.throws(() => validateKeywords(facts, defect), /Meta description/);
  assert.doesNotThrow(() => validateKeywords(facts, html));
});

test('RED keyword occurrence cap rejects thirteen extra occurrences and accepts original text', () => {
  const defect = html.replace('</body>', `<p>${'hooks '.repeat(13)}</p></body>`);
  assert.throws(() => validateKeywords(facts, defect), /Keyword occurs more than 12 times: hooks/);
  assert.doesNotThrow(() => validateKeywords(facts, html));
});

test('RED primary keyword must appear in each tool heading', () => {
  for (const tool of facts.tools) {
    const block = toolBlock(tool);
    const heading = block.match(/<h3\b[^>]*>[^]*?<\/h3>/)[0];
    const defect = block.replace(heading, '<h3>Other label</h3>');
    assert.notEqual(defect, block, tool.id);
    assert.throws(() => validateToolHeading(tool, defect), /Heading missing primary phrase/);
    assert.doesNotThrow(() => validateToolHeading(tool, block));
  }
  assert.doesNotThrow(() => validateKeywords(facts, html));
});

test('tool blocks cover every setup row, all references and installer removal with exact copy', () => {
  assert.equal(facts.tools.length, facts.setup.length + 1);
  assert.deepEqual(facts.tools.map(tool => tool.id), ['skill', 'runner', 'brief', 'pick', 'retry', 'batch', 'reader', 'search', 'measure', 'doctor', 'installer']);
  assert.equal(facts.tools[0].source.filter(file => file.includes('/references/')).length, 9);
  for (const tool of facts.tools) {
    const block = toolBlock(tool);
    assert.ok(text(block).includes(tool.does), tool.id);
    assert.ok(tool.commands.every(command => text(block).includes(command)), tool.id);
  }
  const article = `<article data-tool="skill"${toolBlock(facts.tools[0])}</article>`;
  const fixture = html.replace('</body>', article + '</body>');
  assert.doesNotThrow(() => validateMock(facts, fixture));
  assert.throws(() => validateMock(facts, fixture.replace(facts.tools[0].does, 'Describes other parts.')), /Tool description differs/);
});

test('mock sections, README introduction, requirements, links and credits are present', () => {
  const positions = ['class="hero"', 'id="how-it-works"', 'id="trailer"', 'id="quickstart"',
    'id="reference"', 'id="requirements"', 'id="questions"', 'id="set"', 'id="proof"', 'id="releases"', '<footer'].map(marker => html.indexOf(marker));
  assert.ok(positions.every((value, index) => value >= 0 && (!index || value > positions[index - 1])));
  for (const line of facts.lines) assert.ok(text(documents).includes(line), line);
  for (const required of ['Node 20 or newer', 'Claude Code', facts.repository, facts.npm,
    'https://github.com/aunysillyme/lean-computer-use']) assert.ok(html.includes(required), required);
  for (const required of ['npx lean-browser-use uninstall', 'https://github.com/trycua/cua']) assert.ok(documents.includes(required), required);
  assert.match(html, /Trailer/);
  assert.doesNotMatch(html, /<(?:video|iframe)\b/i);
  const proof = html.split('<table class="proof-table">')[1].split('</table>')[0];
  assert.doesNotMatch(text(proof), /\b(?:ms|seconds|traffic)\b/i);
});

test('mock metadata and static responsive layout have no external resource requests', () => {
  for (const tag of ['<meta name="robots" content="noindex">', `<link rel="canonical" href="${facts.url}">`]) assert.ok(html.includes(tag), tag);
  for (const match of html.matchAll(/<(?:img|script|iframe|video|audio|source)\b[^>]*\bsrc="([^"]+)"|<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gi)) assert.ok((match[1] || match[2]).startsWith('/assets/'));
  const css = read('website/assets/site.css');
  assert.match(css, /@media/);
  assert.match(css, /minmax\(0,\s*1fr\)/);
  assert.match(css, /white-space:\s*pre-wrap/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /overflow:\s*auto/);
  for (const file of ['website/facts.mjs', 'website/tools.json', 'website/mock/index.html', 'test/website-facts.test.mjs']) {
    assert.ok(!read(file).includes(String.fromCharCode(0x2014)), file);
  }
});

test('copy button copies the exact install command and reports a clipboard failure', async () => {
  const script = read('website/assets/site.js');
  for (const fail of [false, true]) {
    let listener, copied;
    const status = { textContent: '', dataset: { success: 'Copied.', fallback: 'Select and copy the command above.' } };
    const button = { dataset: { copy: 'install-command' }, addEventListener: (event, callback) => { assert.equal(event, 'click'); listener = callback; } };
    const document = {
      getElementById: id => id === 'copy-status' ? status : id === 'install-command' ? { textContent: 'npx lean-browser-use' } : null,
      querySelector: () => null, querySelectorAll: selector => selector === '[data-copy]' ? [button] : [],
    };
    const navigator = { clipboard: { writeText: async value => { if (fail) throw Error('Unavailable'); copied = value; } } };
    Function('document', 'navigator', script)(document, navigator);
    await listener();
    if (fail) assert.equal(status.textContent, 'Select and copy the command above.');
    else { assert.equal(copied, 'npx lean-browser-use'); assert.equal(status.textContent, 'Copied.'); }
  }
});

test('facts CLI checks without writing and --write emits the same facts in a disposable root', t => {
  const dir = fixture(t);
  for (const args of [[], ['--check'], ['--write'], ['--check', '--write']]) {
    const result = spawnSync(process.execPath, ['website/facts.mjs', ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    if (args.includes('--write')) assert.deepEqual(JSON.parse(readFileSync(join(dir, 'website/facts.json'), 'utf8')), loadFacts(dir));
    else assert.throws(() => readFileSync(join(dir, 'website/facts.json')), /ENOENT/);
  }
  const invalid = spawnSync(process.execPath, ['website/facts.mjs', '--unknown'], { cwd: dir, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Usage:/);
});

test('RED package name must occur in title and first 100 visible words', () => {
  const withoutTitleName = html.replace(/<title>[^]*?<\/title>/, '<title>Browser use for agents</title>');
  assert.throws(() => validateKeywords(facts, withoutTitleName), /Title must contain the package name/);
  const withoutVisibleName = html.replace(/(<body\b[^>]*>)([^]*?)(<\/body>)/, (_, open, body, close) => open + body.replaceAll(facts.name, 'package-label') + close);
  assert.throws(() => validateKeywords(facts, withoutVisibleName), /First 100 words missing lean-browser-use/);
  assert.doesNotThrow(() => validateKeywords(facts, html));
});

test('RED exactly one H1 and both headline lines survive the new markup', () => {
  assert.throws(() => validateKeywords(facts, html.replace('</body>', '<h1>Extra</h1></body>')), /H1 must occur exactly once/);
  assert.throws(() => validateKeywords(facts, html.replace('In a fresh, small context.</em>', 'Other line.</em>')), /H1 must contain both/);
  assert.doesNotThrow(() => validateKeywords(facts, html));
});

test('RED landing keyword cap accepts twelve and rejects thirteen occurrences', () => {
  const twelve = html.replace('</body>', `<p>${'hooks '.repeat(12 - keywordCounts(facts, html).find(row => row.keyword === 'hooks').count)}</p></body>`);
  assert.doesNotThrow(() => validateKeywords(facts, twelve));
  assert.throws(() => validateKeywords(facts, twelve.replace('</body>', '<p>hooks</p></body>')), /more than 12 times: hooks/);
});


test('historical benchmark rows omit expiry, timing rows stay out of displayed proof', () => {
  const source = JSON.parse(read('proof/results.json')).rows;
  const historic = source.filter(row => !Object.hasOwn(row, 'expires'));
  assert.ok(historic.length > 0);
  for (const row of historic) assert.ok(facts.proof.some(display => display.id === row.id), row.id);
  for (const row of source.filter(row => row.id === 'install_ms' || /^guard_ms/.test(row.id) || row.unit === 'ms')) {
    assert.ok(!facts.proof.some(display => display.id === row.id), row.id);
    assert.ok(!html.includes(`data-proof="${row.id}"`), row.id);
  }
});


test('RED tool keywords reject invented vocabulary and more than three secondary phrases', () => {
  const invented = copy(facts.tools);
  invented[0].keywords.primary = 'invented search phrase for testing';
  assert.throws(() => validateTools(root, invented), /keyword|vocabulary/i);
  const extra = copy(facts.tools);
  extra[0].keywords.secondary = ['browser use', 'Claude Code', 'tokens', 'subagent'];
  assert.throws(() => validateTools(root, extra), /Invalid keywords/);
  assert.doesNotThrow(() => validateTools(root, facts.tools));
});
