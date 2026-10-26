import { readFileSync, readdirSync, existsSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { isIP } from 'node:net';
import { pages } from './pages.mjs';
import { loadFacts, featuredProof, buildJsonLd, buildFaqJsonLd, visibleText, validateKeywords,
  validateToolHeading, commandEvidence, validateCommand } from './facts.mjs';
import { readPins, copyPinFailures } from './copy.mjs';
import { scanText } from '../scripts/gate.mjs';
const hashMatches = (value, hashes) => scanText(value, hashes).some(hit => hit.class.startsWith('private-term:'));

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const origin = 'https://lean-browser-use.aunysillyme.dev';
const pageFile = route => `${route.slice(1)}index.html`;
const twinFile = route => `${route.slice(1)}index.md`;
import { assets, csp, fontLink, fontFile } from './resources.mjs';
const read = (root, file) => readFileSync(join(root, file), 'utf8');
const decode = text => text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
  const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  if (named[entity]) return named[entity];
  const number = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3), 16) : Number(entity.slice(2, -1));
  return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
});
const text = value => decode(visibleText(value));
const same = (a, b) => isDeepStrictEqual(a, b);
// Latin-1 preserves every byte outside the footer's source commit fields.
const withoutSourceCommit = bytes => bytes.toString('latin1').replace(
  /(<footer class="bottom">[^]*?<span>Source <a href="https:\/\/github\.com\/aunysillyme\/lean-browser-use\/commit\/)[a-fA-F\d]{40}(">)[a-fA-F\d]{7}(<\/a><\/span><\/footer>)/g,
  '$1SOURCE_COMMIT$2SOURCE_COMMIT$3');
const own = (object, key) => Object.hasOwn(object, key);
const projectUrls = new Set(['https://github.com/aunysillyme/lean-browser-use', 'https://www.npmjs.com/package/lean-browser-use']);
const safeAnchor = url => {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return url.protocol === 'https:' && !url.username && !url.password
    && !isIP(host.replace(/^\[|\]$/g, '')) && host !== 'localhost' && !host.endsWith('.localhost');
};

// Read tags once so quoted attributes and script text keep their boundaries.
function parseHtml(html) {
  const nodes = [], stack = [];
  const pattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][a-z\d:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  for (let match; (match = pattern.exec(html));) {
    const tag = match[0];
    if (/^<!/.test(tag)) continue;
    const name = tag.match(/^<\/?([\w:-]+)/)[1].toLowerCase();
    if (tag.startsWith('</')) {
      const index = stack.findLastIndex(node => node.name === name);
      if (index >= 0) {
        for (const node of stack.splice(index)) { node.end = match.index; node.inner = html.slice(node.start, match.index); }
      }
      continue;
    }
    const attrs = {};
    const rest = tag.replace(/^<[\w:-]+/, '').slice(0, -1);
    for (const attr of rest.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[attr[1].toLowerCase()] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    const node = { name, attrs, offset: match.index, start: pattern.lastIndex, end: pattern.lastIndex, inner: '', parent: stack.at(-1) };
    nodes.push(node);
    if (['script', 'style', 'textarea', 'title'].includes(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'gi');
      close.lastIndex = pattern.lastIndex;
      const end = close.exec(html);
      node.end = end?.index ?? html.length;
      node.inner = html.slice(node.start, node.end);
      pattern.lastIndex = end ? close.lastIndex : html.length;
    } else if (!/\/\s*>$/.test(tag) && !['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(name)) stack.push(node);
  }
  return nodes;
}

function filesAt(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const file = prefix + entry.name;
    return entry.isDirectory() ? filesAt(root, file + '/') : [file];
  }).sort();
}

export function expectedFiles(live = false) {
  return [...pages.map(page => pageFile(page.route)), '404.html', 'robots.txt', 'build-info.json',
    ...assets.map(asset => `assets/${asset}`),
    ...(live ? ['sitemap.xml', 'llms.txt', 'llms-full.txt', ...pages.map(page => twinFile(page.route))] : []),
  ].sort();
}

const commonProperties = ['@context', '@type', '@id'];
const properties = Object.fromEntries(Object.entries({
  SoftwareApplication: ['name', 'description', 'applicationCategory', 'operatingSystem', 'softwareRequirements', 'license', 'isAccessibleForFree', 'offers', 'url', 'author', 'publisher', 'sameAs'],
  Offer: ['price', 'priceCurrency'], Person: ['name', 'url'], Organization: ['name', 'url'],
  FAQPage: ['mainEntity'], Question: ['name', 'acceptedAnswer'], Answer: ['text'],
  BreadcrumbList: ['itemListElement'], ListItem: ['position', 'name', 'item'],
}).map(([type, keys]) => [type, new Set([...commonProperties, ...keys])]));

export function checkSite({ root = rootDir, dist = join(root, 'website/dist'), live = false,
  now = new Date().toISOString(), termsFile = join(root, 'test/terms.private.sha256') } = {}) {
  const failures = [];
  const fail = (file, message) => failures.push(`${file}: ${message}`);
  const check = (ok, file, message) => { if (!ok) fail(file, message); };
  const attempt = (file, action) => { try { return action(); } catch (error) { fail(file, error.message); } };
  const timestamp = Date.parse(now);
  check(Number.isFinite(timestamp), 'clock', 'invalid --now date');
  const facts = attempt('facts', () => loadFacts(root));
  if (!facts) return failures;
  const pins = attempt('copy pins', () => readPins(root));
  if (pins) {
    check(facts.lead === pins.readmeLead, 'copy pins', 'pinned headline source differs from current README');
    check(facts.description === pins.packageDescription && facts.description === pins.about, 'copy pins', 'pinned meta description differs from current package or About');
  }
  const jsonUrls = new Set([...projectUrls, ...pages.map(page => origin + page.route)]);
  const collectUrls = value => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) jsonUrls.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collectUrls);
  };
  [buildJsonLd(facts, { live }), buildFaqJsonLd(facts)].forEach(collectUrls);
  const all = attempt('dist', () => filesAt(dist));
  if (!all) return failures;
  const expected = expectedFiles(live);
  for (const file of expected) check(all.includes(file), file, 'missing output file');
  for (const file of all) check(expected.includes(file), file, 'unexpected output file');
  const bytes = new Map();
  for (const file of all) {
    if (lstatSync(join(dist, file)).isSymbolicLink()) { fail(file, 'symlink in output'); continue; }
    attempt(file, () => bytes.set(file, readFileSync(join(dist, file))));
  }
  const texts = new Map([...bytes].filter(([file, value]) => /\.(?:html|css|js|json|txt|md|xml|svg)$/i.test(file) || !value.includes(0))
    .map(([file, value]) => [file, value.toString('utf8')]));
  const documents = new Map([...texts].filter(([file]) => file.endsWith('.html')).map(([file, html]) => [file, { html, nodes: parseHtml(html) }]));
  const resolveLink = (file, value, { anchor = true } = {}) => {
    let url;
    try { url = new URL(value, `${origin}/${file === 'index.html' ? '' : file}`); }
    catch { fail(file, `invalid URL: ${value}`); return; }
    if (url.origin !== origin) return;
    let target;
    try { target = decodeURIComponent(url.pathname).slice(1); }
    catch { fail(file, 'invalid URL encoding'); return; }
    if (!target || target.endsWith('/')) target += 'index.html';
    check(bytes.has(target), file, `unresolved file: ${value}`);
    if (anchor && url.hash && bytes.has(target)) {
      let id;
      try { id = decodeURIComponent(url.hash.slice(1)); } catch { id = ''; }
      const nodes = documents.get(target)?.nodes || parseHtml(texts.get(target) || '');
      check(nodes.some(node => node.attrs.id === id), file, `unresolved anchor: ${value}`);
    }
  };
  function jsonPolicy(file, value, key = '') {
    if (Array.isArray(value)) { value.forEach(item => jsonPolicy(file, item, key)); return; }
    if (typeof value === 'string' && (['@context', '@id', 'url', 'item', 'license', 'sameAs'].includes(key)
      || /^(?:https?:\/\/|\/\/)/i.test(value))) {
      check((key === 'sameAs' ? projectUrls : jsonUrls).has(value), file, 'JSON-LD URL outside allowed pages');
    }
    if (!value || typeof value !== 'object') return;
    const allowed = properties[value['@type']];
    check(allowed, file, `unknown JSON-LD type: ${value['@type']}`);
    for (const [key, child] of Object.entries(value)) {
      check(key !== 'aggregateRating' && key !== 'review', file, `forbidden JSON-LD property: ${key}`);
      check(allowed?.has(key), file, `unknown JSON-LD property: ${key}`);
      if (!live) check(key !== 'sameAs', file, 'sameAs in default mode');
      jsonPolicy(file, child, key);
    }
  }
  const evidence = attempt('commands', () => commandEvidence(root, facts.tools));
  const tools = new Map(facts.tools.map(tool => [tool.id, []]));
  for (const [file, { html, nodes }] of documents) {
    const route = file === '404.html' ? '/404.html' : '/' + file.replace(/index\.html$/, '');
    const tags = name => nodes.filter(node => node.name === name);
    const meta = name => tags('meta').filter(node => (node.attrs.name || node.attrs.property || '').toLowerCase() === name);
    const links = rel => tags('link').filter(node => (node.attrs.rel || '').split(/\s+/).includes(rel));
    const h1s = tags('h1');
    const policy = tags('meta').filter(node => node.attrs['http-equiv']?.toLowerCase() === 'content-security-policy');
    check(policy.length === 1 && policy[0].attrs.content === csp, file, 'resource CSP differs from allowed policy');
    check(h1s.length === 1, file, 'expected one H1');
    const titles = tags('title');
    check(titles.length === 1 && text(titles[0].inner).length > 0 && text(titles[0].inner).length <= 60, file, 'title must have 1 to 60 characters');
    const descriptions = meta('description');
    check(descriptions.length === 1 && descriptions[0].attrs.content?.trim() && descriptions[0].attrs.content.length <= 160, file, 'description must have 1 to 160 characters');
    if (file === 'index.html') check(descriptions[0]?.attrs.content === facts.description, file, 'landing description differs from package');
    check(links('canonical').length === 1 && links('canonical')[0].attrs.href === origin + route, file, 'wrong canonical');
    const ids = nodes.filter(node => own(node.attrs, 'id')).map(node => node.attrs.id);
    check(new Set(ids).size === ids.length, file, 'duplicate id');
    const sidebar = tags('aside').filter(node => (node.attrs.class || '').split(/\s+/).includes('sidebar'));
    const current = nodes.filter(node => own(node.attrs, 'aria-current') && node.attrs['aria-current'] !== 'false'
      && sidebar.some(side => node.offset >= side.start && node.offset < side.end));
    const currentUrl = attempt(file, () => new URL(current[0]?.attrs.href || '', origin + route));
    check(file === '404.html' ? current.length === 0 : current.length === 1 && current[0].name === 'a'
      && ['page', 'location'].includes(current[0].attrs['aria-current'])
      && currentUrl?.origin === origin && currentUrl.pathname === route, file,
    file === '404.html' ? '404 must not mark a current sidebar page' : 'sidebar must mark exactly the current page');
    const noindex = meta('robots').some(node => /\bnoindex\b/i.test(node.attrs.content || ''));
    check(file === '404.html' ? noindex : live ? !noindex : noindex, file,
      file === '404.html' ? '404 must keep noindex' : live ? 'noindex in live mode' : 'missing noindex in default mode');
    if (!live) {
      check(links('describedby').length === 0, file, 'describedby in default mode');
      check(!links('alternate').some(node => node.attrs.type === 'text/markdown'), file, 'markdown alternate in default mode');
      check(meta('og:image').length === 0, file, 'og:image in default mode');
    } else if (file !== '404.html') {
      check(links('describedby').length === 1 && links('describedby')[0].attrs.href === origin + '/llms.txt', file, 'wrong describedby');
      check(links('alternate').filter(node => node.attrs.type === 'text/markdown' && node.attrs.href === origin + '/' + twinFile(route)).length === 1, file, 'wrong markdown alternate');
      check(meta('og:image').length === 1 && meta('og:image')[0].attrs.content === origin + '/assets/social-preview.png', file, 'wrong social preview');
    }
    for (const node of nodes) {
      for (const [attr, value] of Object.entries(node.attrs)) {
        if (!/(?:https?:)?\/\//i.test(value)) continue;
        const rels = (node.attrs.rel || '').split(/\s+/);
        const allowed = fontLink(node) && attr === 'href'
          || node.name === 'meta' && attr === 'content' && node.attrs['http-equiv']?.toLowerCase() === 'content-security-policy' && value === csp
          || node.name === 'a' && attr === 'href'
          || node.name === 'link' && attr === 'href' && rels.some(rel => ['canonical', 'describedby', 'alternate'].includes(rel))
          || node.name === 'meta' && attr === 'content' && /^(?:og:|twitter:)/.test(node.attrs.property || node.attrs.name || '');
        // Local resources also use absolute site URLs.
        const urls = value.match(/(?:https?:)?\/\/[^\s'"<>;)]+/gi) || [];
        for (const url of urls) check(allowed || attempt(file, () => new URL(url, origin).origin === origin), file, `external URL in ${node.name}[${attr}]`);
      }
      for (const attr of ['href', 'src', 'poster', 'data', 'action', 'srcset']) {
        if (!own(node.attrs, attr)) continue;
        const values = attr === 'srcset' ? node.attrs[attr].split(',').map(value => value.trim().split(/\s+/)[0]) : [node.attrs[attr]];
        for (const value of values) {
          let url;
          try { url = new URL(value, origin + route); } catch { fail(file, `invalid URL: ${value}`); continue; }
          if (url.origin === origin) resolveLink(file, value, { anchor: node.name !== 'link' });
          else {
            const rel = (node.attrs.rel || '').split(/\s+/);
            const permitted = attr === 'href' && (fontLink(node) || node.name === 'a' || node.name === 'link' && rel.some(value => ['canonical', 'describedby', 'alternate'].includes(value)));
            check(permitted && ['http:', 'https:'].includes(url.protocol), file, `external resource: ${node.name}[${attr}]`);
          }
          if (node.name === 'a' && attr === 'href') check(safeAnchor(url), file, 'unsafe external anchor');
        }
      }
      if (['video', 'source'].includes(node.name)) {
        for (const attr of ['src', 'poster']) if (own(node.attrs, attr)) check(/^\/assets\/[a-zA-Z0-9._-]+$/.test(node.attrs[attr]), file, 'media must use local /assets/ sources');
      }
      if (node.name === 'article' && own(node.attrs, 'data-tool')) {
        const tool = facts.tools.find(tool => tool.id === node.attrs['data-tool']);
        check(tool, file, 'unknown tool entry');
        if (tool) {
          tools.get(tool.id).push(file);
          attempt(file, () => validateToolHeading(tool, node.inner));
          const description = parseHtml(node.inner).find(child => child.name === 'p' && own(child.attrs, 'data-does'));
          check(text(description?.inner || '') === tool.does, file, `tool description differs: ${tool.id}`);
          const commands = parseHtml(node.inner).filter(child => child.name === 'pre').map(child => text(child.inner));
          check(same(commands, tool.commands), file, `tool commands differ: ${tool.id}`);
        }
      }
      if (node.name === 'code') {
        for (const match of text(node.inner).matchAll(/https?:\/\/[^\s<>"']+/gi)) {
          check(evidence && evidence('').includes(match[0]), file, 'undocumented URL in code');
        }
      }
      if (node.name === 'pre') {
        const code = node.inner.match(/<code\b[^>]*>([^]*?)<\/code>/i)?.[1] || '';
        const commands = decode(code).split(/\r?\n|&&|\|\||;/).map(line => line.trim().replace(/^\$\s+/, ''));
        for (const command of commands) if (evidence) attempt(file, () => validateCommand(command, evidence(command)));
      }
      if (node.name === 'tr' && own(node.attrs, 'data-proof')) {
        const row = facts.proof.find(row => row.id === node.attrs['data-proof']);
        check(row, file, 'unknown proof row');
        if (row) {
          const cells = parseHtml(node.inner).filter(cell => ['td', 'th'].includes(cell.name));
          const cell = attr => text(cells.find(cell => own(cell.attrs, attr))?.inner || '');
          check(text(cells.find(cell => cell.name === 'th')?.inner || '') === row.claim, file, `proof label differs: ${row.id}`);
          check(cell('data-value') === `${row.value} ${row.unit}`, file, `proof value differs: ${row.id}`);
          check(cell('data-measured') === row.measured, file, `proof measured date differs: ${row.id}`);
          check(cell('data-expires') === (row.expires || ''), file, `proof expiry date differs: ${row.id}`);
          check((!row.expires || Date.parse(row.expires) >= timestamp), file, `expired proof row: ${row.id}`);
        }
      }
    }
    if (pages.find(page => pageFile(page.route) === file)?.sources.includes('proof/results.json')) {
      const shown = nodes.filter(node => node.name === 'tr' && own(node.attrs, 'data-proof')).map(node => node.attrs['data-proof']).sort();
      check(same(shown, (file === 'index.html' ? featuredProof(facts) : facts.proof).map(row => row.id).sort()), file, 'proof rows missing or duplicated');
    }
    const blocks = tags('script').filter(node => node.attrs.type === 'application/ld+json')
      .map(node => attempt(file, () => JSON.parse(node.inner))).filter(Boolean);
    blocks.forEach(block => jsonPolicy(file, block));
    if (file === 'index.html') {
      check(same(blocks, [buildJsonLd(facts, { live }), buildFaqJsonLd(facts)]), file, 'landing JSON-LD differs from generated facts');
      attempt(file, () => validateKeywords(facts, html));
      const hero = nodes.find(node => node.name === 'section' && (node.attrs.class || '').split(/\s+/).includes('hero'))?.inner || '';
      if (pins) for (const finding of copyPinFailures(pins, {
        headlineSource: h1s[0]?.attrs['data-headline-source'],
        headline: text((h1s[0]?.inner || '').split(/<br\s*\/?>/i)[0]),
        installCommand: text(nodes.find(node => node.attrs.id === 'install-command')?.inner || ''),
        description: descriptions[0]?.attrs.content,
      })) fail(file, finding);
      const headline = text(h1s[0]?.inner || '');
      check(!/about 25%/.test(headline) || /\b(?:cost|dollars?|USD)\b/i.test(headline), file, 'hero about 25% needs a dollar qualifier');
      for (const phrase of ['browser use', 'Claude Code', 'tokens', 'subagent', 'fresh context']) check(text(hero).includes(phrase), file, `hero missing ${phrase}`);
      const release = attempt('release', () => existsSync(join(root, 'website/release.json')) ? JSON.parse(read(root, 'website/release.json')) : {});
      const verified = release?.verified === true && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version);
      check(tags('a').some(node => node.attrs.class === 'brand' && text(parseHtml(node.inner).find(child => child.name === 'b')?.inner || '') === facts.name), file, 'package name differs from displayed brand');
      const fresh = nodes.find(node => node.attrs.id === 'releases');
      check(fresh && text(fresh.inner).includes(`v${facts.version}`) && (!verified || release.version === facts.version), file, 'package version differs from display');
      check(fresh && text(fresh.inner).includes('Fresh from the repo') && (verified || /not released yet/i.test(text(fresh.inner))), file, 'Fresh from the repo must say not released yet');
      check(!/your agent keeps working/i.test(text(hero)), file, 'forbidden hero headline');
      if (!live) check(withoutSourceCommit(bytes.get(file)) === withoutSourceCommit(readFileSync(join(root, 'website/mock/index.html'))), file, 'default landing differs from saved mock');
    } else if (file !== '404.html') {
      const crumb = tags('nav').find(node => node.attrs['aria-label'] === 'Breadcrumb');
      const visible = crumb ? parseHtml(crumb.inner).filter(node => node.name === 'a' || node.name === 'span' && node.attrs['aria-hidden'] !== 'true').map(node => text(node.inner)) : [];
      check(blocks.length === 1 && blocks[0]['@type'] === 'BreadcrumbList' && visible.length > 0
        && same(blocks[0].itemListElement?.map(item => item.name), visible), file, 'BreadcrumbList names differ from visible breadcrumb');
    }
    for (const value of [...h1s.map(node => text(node.inner)), ...titles.map(node => text(node.inner)), ...descriptions.map(node => node.attrs.content)]) check(!/your agent keeps working/i.test(value || ''), file, 'forbidden headline');
    for (const match of text(html.replace(/<(code|a)\b[^>]*>[^]*?<\/\1>/gi, '')).matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const url = attempt(file, () => new URL(match[0]));
      if (url) check(url.origin === origin, file, 'external URL outside allowed markup');
    }
  }
  for (const [id, found] of tools) check(found.length === 1, 'tools', `tool must appear exactly once: ${id} (${found.length})`);
  const robots = texts.get('robots.txt') || '';
  check(/^User-agent:\s*\*\s*$/m.test(robots) && (live
    ? /^Allow:\s*\/\s*$/m.test(robots) && !/^Disallow:[ \t]*\S/m.test(robots) && robots.includes(`Sitemap: ${origin}/sitemap.xml`)
    : /^Disallow:\s*\/\s*$/m.test(robots) && !/^Allow:/m.test(robots)), 'robots.txt', 'wrong discovery policy');
  if (live) {
    const urls = [...(texts.get('sitemap.xml') || '').matchAll(/<loc>([^<]*)<\/loc>/g)].map(match => decode(match[1])).sort();
    check(same(urls, pages.map(page => origin + page.route).sort()), 'sitemap.xml', 'sitemap must list exactly the canonical pages');
    const png = bytes.get('assets/social-preview.png');
    check(png && png.length >= 33 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && png.readUInt32BE(8) === 13 && png.toString('ascii', 12, 16) === 'IHDR'
      && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, 'assets/social-preview.png', 'expected a 1200 x 630 PNG');
  }
  const hashes = attempt('privacy', () => {
    const lines = readFileSync(termsFile, 'utf8').trim().split(/\r?\n/);
    if (!lines.length || lines.some(line => !/^[a-f\d]{64}$/.test(line)) || !same(lines, [...new Set(lines)].sort())) throw Error('invalid term hash file');
    return new Set(lines);
  });
  for (const [file, value] of texts) {
    const privateText = value + '\n' + text(value);
    check(!privateText.includes(String.fromCharCode(0x2014)), file, 'em dash');
    check(!hashes || !hashMatches(file + '\n' + value, hashes) && !hashMatches(text(value), hashes), file, 'private term hash match');
    check(!/\/Us[e]rs\//.test(privateText), file, 'personal path');
    check(!/\bAU[N]-\d+/.test(privateText), file, 'private issue id');
    check(!/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(privateText), file, 'email address');
    check(!/\bVau[l]ts?[\/\\]|obs[i]dian(?:-tc)?:\/\//i.test(privateText), file, 'private storage path');
    check(!/\bgtag\s*\(|googletagmanager|google-analytics|\bdataLayer\b|analytics\.(?:track|identify|page)\s*\(/i.test(value), file, 'analytics or tag-manager snippet');
    if (/\.(?:html|css|svg|js)$/.test(file)) {
      for (const match of value.matchAll(/(?:url\(\s*["']?|@import\s+["'])([^\s'";)]+)/gi)) {
        const url = attempt(file, () => new URL(decode(match[1]), `${origin}/${file}`));
        if (url) { check(url.origin === origin || fontFile(url), file, 'external CSS resource'); if (url.origin === origin) resolveLink(file, match[1]); }
      }
    }
    const scripts = file.endsWith('.js') ? [value] : file.endsWith('.html')
      ? (documents.get(file)?.nodes || []).filter(node => node.name === 'script' && node.attrs.type !== 'application/ld+json').map(node => node.inner) : [];
    for (const script of scripts) {
      check(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(|\bimport\s*\(/.test(script), file, 'network or dynamic script call');
      check(!/(?:https?:)?\/\//i.test(script), file, 'external script URL');
    }
    if (file.endsWith('.svg')) for (const node of parseHtml(value)) {
      for (const attr of ['href', 'xlink:href', 'src']) if (own(node.attrs, attr)) {
        const url = attempt(file, () => new URL(node.attrs[attr], `${origin}/${file}`));
        if (url) { check(url.origin === origin, file, 'external SVG resource'); if (url.origin === origin) resolveLink(file, node.attrs[attr]); }
      }
    }
  }
  return [...new Set(failures)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--live') options.live = true;
      else if (['--dist', '--now'].includes(args[index]) && args[index + 1] && !args[index + 1].startsWith('--')) options[args[index].slice(2)] = args[++index];
      else throw Error('Usage: node website/check.mjs [--live] [--dist <dir>] [--now <ISO date>]');
    }
    const failures = checkSite(options);
    for (const failure of failures) console.error(failure.replace(/[\r\n]+/g, ' '));
    console.log(`${failures.length} failure(s).`);
    process.exitCode = failures.length ? 1 : 0;
  } catch (error) { console.error(error.message.replace(/[\r\n]+/g, ' ')); console.log('1 failure(s).'); process.exitCode = 1; }
}
