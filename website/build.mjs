import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildJsonLd, buildFaqJsonLd, loadSourceFacts, featuredProof, visibleText } from './facts.mjs';
import { pages } from './pages.mjs';
import { content } from './content.mjs';

const origin = 'https://lean-browser-use.aunysillyme.dev';
const repository = 'https://github.com/aunysillyme/lean-browser-use';
const assets = ['site.css', 'site.js', 'poster.png', 'social-preview.svg', 'social-preview.png'];
const read = (root, file) => readFileSync(join(root, file), 'utf8');
const json = (root, file) => JSON.parse(read(root, file));
const requireValue = (ok, message) => { if (!ok) throw Error(message); };
export const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const slug = text => visibleText(text).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';

function section(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}\n`);
  requireValue(start >= 0, `README section missing: ${heading}`);
  const rest = markdown.slice(start);
  const end = rest.indexOf('\n## ');
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}


function validatePages(facts) {
  requireValue(content.brand === facts.name && content.documents.landing.description === facts.description, 'Package metadata differs from site copy');
  const expected = ['/', '/docs/overview/', '/docs/how-it-works/', '/docs/guides/', '/docs/commands/', '/docs/proof/', '/docs/changelog/', '/docs/install/', '/docs/guarantees/'];
  requireValue(pages.length === expected.length && expected.every(route => pages.some(page => page.route === route)), 'Page routes must match the nine-page map');
  const ids = pages.flatMap(page => page.tools);
  for (const tool of facts.tools) requireValue(ids.filter(id => id === tool.id).length === 1, `Tool page mapping missing or duplicated: ${tool.id}`);
  requireValue(ids.every(id => facts.tools.some(tool => tool.id === id)), 'Unknown tool in page mapping');
  for (const page of pages) {
    requireValue(page.title && page.title.length <= 60 && page.description && page.h1 && Array.isArray(page.sources), `Incomplete page: ${page.route}`);
  }
}

function sourceRoutes() {
  const routes = new Map();
  for (const page of pages.filter(page => page.route !== '/')) {
    for (const source of page.sources) if (!routes.has(source)) routes.set(source, page.route);
  }
  return routes;
}

export function rewriteUrl(href, source, { image = false, routes = sourceRoutes() } = {}) {
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return '';
  if (image) {
    const local = href.startsWith('/assets/') ? href.slice(8) : posix.normalize(posix.join(posix.dirname(source), href)).replace(/^website\/assets\//, '');
    return assets.includes(local) && /\.(?:png|svg)$/.test(local) ? `/assets/${local}` : '';
  }
  if (href.startsWith('#')) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return '';
  const [file, fragment] = href.split('#');
  const normalized = posix.normalize(file.startsWith('/') ? file.slice(1) : posix.join(posix.dirname(source), file));
  if (normalized === '..' || normalized.startsWith('../')) return '';
  const suffix = fragment ? `#${fragment}` : '';
  return routes.has(normalized) ? `${routes.get(normalized)}${suffix}` : `${repository}/blob/main/${normalized}${suffix}`;
}

function uniqueId(text, ids) {
  const base = slug(text);
  let id = base, count = 0;
  while (ids.has(id)) id = `${base}-${++count}`;
  ids.add(id);
  return id;
}

// Source HTML is data. Only tags constructed by this renderer reach the page.
export function renderMarkdown(markdown, { source = 'README.md', ids = new Set(), routes = sourceRoutes() } = {}) {
  const references = new Map();
  markdown = markdown.replace(/^---\n[^]*?\n---\n/, '').replace(/<!--[^]*?-->/g, '');
  markdown = markdown.replace(/^\[([^\]]+)\]:\s*(\S+).*$/gm, (_, label, href) => { references.set(label.toLowerCase(), href); return ''; });
  function inline(value, tokens = []) {
    const save = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
    value = value.replace(/`([^`]+)`/g, (_, code) => save(`<code>${escape(code)}</code>`));
    value = value.replace(/<(script|style|iframe|object|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, '').replace(/<\/?[a-z][^>]*>/gi, '');
    value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, href) => {
      const src = rewriteUrl(href, source, { image: true, routes });
      return save(src ? `<img src="${escape(src)}" alt="${escape(alt)}" loading="lazy">` : '');
    });
    value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const url = rewriteUrl(href, source, { routes });
      const rendered = inline(label, tokens);
      return save(rendered.trim() && url ? `<a href="${escape(url)}">${rendered}</a>` : rendered);
    });
    value = value.replace(/\[([^\]]+)\](?:\[([^\]]*)\])?/g, (whole, label, reference) => {
      const href = references.get((reference || label).toLowerCase());
      if (!href) return whole;
      const url = rewriteUrl(href, source, { routes });
      const rendered = inline(label, tokens);
      return save(rendered.trim() && url ? `<a href="${escape(url)}">${rendered}</a>` : rendered);
    });
    value = value.replace(/https?:\/\/[^\s<>"'\u0000]+/g, whole => {
      const href = whole.replace(/[.,;]+$/, '');
      return save(`<a href="${escape(href)}">${escape(href)}</a>`) + whole.slice(href.length);
    });
    value = escape(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return value.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
  }
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (/^\s*```/.test(line)) {
      const code = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      index++;
      blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    // Drop active raw HTML blocks before joining their lines into paragraphs.
    if (/^\s*<(script|style|iframe|object|svg)\b/i.test(line)) {
      const tag = line.match(/<(\w+)/)[1];
      const raw = [];
      do { raw.push(lines[index]); if (new RegExp(`</${tag}\\s*>`, 'i').test(lines[index++])) break; } while (index < lines.length);
      const safe = inline(raw.join('\n'));
      if (safe.trim()) blocks.push(`<p>${safe}</p>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const depth = Math.max(2, heading[1].length);
      const text = inline(heading[2]);
      blocks.push(`<h${depth} id="${uniqueId(text, ids)}">${text}</h${depth}>`);
      index++; continue;
    }
    if (/^\|/.test(line) && /^\|\s*:?-{3}/.test(lines[index + 1] || '')) {
      const cells = value => value.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => inline(cell.trim().replace(/\\\|/g, '|')));
      const head = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && /^\|/.test(lines[index])) rows.push(cells(lines[index++]));
      blocks.push(`<div class="table-scroll"><table><thead><tr>${head.map(cell => `<th scope="col">${cell}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line), items = [];
      const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (index < lines.length && pattern.test(lines[index])) items.push(`<li>${inline(lines[index++].replace(pattern, ''))}</li>`);
      blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push(`<blockquote><p>${inline(quote.join('\n'))}</p></blockquote>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { blocks.push('<hr>'); index++; continue; }
    const paragraph = [lines[index++]];
    while (index < lines.length && lines[index].trim() && !/^(?:#{1,6}\s|\s*```|\||>|\s*[-*]\s|\s*\d+\.\s|\s*<(?:script|style|iframe|object|svg)\b)/i.test(lines[index])) paragraph.push(lines[index++]);
    const rendered = inline(paragraph.join('\n'));
    if (rendered.trim()) blocks.push(`<p>${rendered}</p>`);
  }
  return blocks.join('\n');
}

function proofTable(facts, rows = facts.proof) {
  const labels = content.proof;
  return `<div class="table-scroll"><table class="proof-table"><thead><tr>${[labels.measurement, labels.value, labels.measured, labels.expires].map(label => `<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody>\n${rows.map(row => `<tr data-proof="${escape(row.id)}"><th scope="row">${escape(row.claim)}</th><td data-value>${escape(row.value)} ${escape(row.unit)}</td><td data-measured>${escape(row.measured)}</td><td data-expires>${escape(row.expires || '')}</td></tr>`).join('\n')}\n</tbody></table></div>`;
}

function toolBlocks(page, facts, ids) {
  return page.tools.map(id => {
    const tool = facts.tools.find(tool => tool.id === id);
    return `<article data-tool="${escape(id)}" class="tool"><p class="eyebrow">${escape(tool.kind)}</p><h3 id="${uniqueId(`${tool.name}: ${tool.keywords.primary}`, ids)}">${escape(tool.name)}: ${escape(tool.keywords.primary)}</h3><p data-does>${escape(tool.does)}</p>${tool.commands.map(command => `<pre><code>${escape(command)}</code></pre>`).join('')}</article>`;
  }).join('\n');
}

function docsBody(root, page, facts) {
  const ids = new Set(['main', 'page-title']);
  const chunks = [];
  for (const source of page.sources) {
    let markdown;
    if (source === 'proof/results.json') {
      chunks.push(proofTable(facts)); continue;
    }
    markdown = read(root, source);
    if (source === 'docs/measure.md') markdown = markdown.replace(/\nOutput from the synthetic fixtures[^]*?```text[^]*?```\n/, '\n');
    if (source === 'README.md' && page.route === '/docs/commands/') markdown = ['After you install', 'Measure your own saving', 'Uninstall'].map(heading => section(markdown, heading)).join('\n\n');
    if (source === 'docs/benchmark.md') markdown = ['Reproduce a paired comparison', 'How far to trust it'].map(heading => section(markdown, heading)).join('\n\n');
    if (source === 'README.md') markdown = markdown.replace(/\nIn two measured runs[^]*?(?=\n```)/, '\n').replace(/\n## What it saves\n[^]*?(?=\n## )/, '\n');
    chunks.push(`<section class="source-section"><p class="source-note">${escape(content.sourceLabel)} <a href="${repository}/blob/main/${escape(source)}">${escape(source)}</a></p>\n${renderMarkdown(markdown, { source, ids })}</section>`);
  }
  return `<article class="markdown">${chunks.join('\n')}${toolBlocks(page, facts, ids)}</article>`;
}

function landingBody(root, facts) {
  const readme = read(root, 'README.md');
  const heading = (title, id, body) => `<section class="content section" id="${id}"><div class="section-title"><h2>${escape(title)}</h2></div>${body}</section>`;
  const release = readRelease(root, facts.version);
  const faq = facts.faq.map(row => `<details><summary data-faq-question>${escape(row.question)}</summary><p data-faq-answer>${renderMarkdown(row.answerMarkdown, { source: 'README.md' }).replace(/^<p>|<\/p>$/g, '')}</p></details>`).join('\n');
  const set = section(readme, 'Part of a set').replace(/^## Part of a set\n/, '');
  return `<section class="hero" id="overview"><div><p class="eyebrow">${escape(content.eyebrow)}</p><h1><span class="headline-line">${escape(content.headline)}</span><em>${escape(content.headlineAccent)}</em></h1><p class="lede">${escape(content.heroLede)}</p><div class="install"><span aria-hidden="true">$</span><code id="install-command">${escape(content.install.command)}</code><button class="copy" type="button" data-copy="install-command" aria-label="${escape(content.install.copy)}">${escape(content.install.copy)}</button></div><p id="copy-status" role="status" class="sr-only" data-success="${escape(content.install.copySuccess)}" data-fallback="${escape(content.install.copyFallback)}"></p><div class="hero-actions"><a class="primary" href="#quickstart">${escape(content.install.title)}</a><a href="${repository}">${escape(content.footer.source)}</a></div></div><div class="routing"><p class="eyebrow">${escape(content.diagram.title)}</p>${content.diagram.steps.map(step => `<div class="route-step">${escape(step)}</div>`).join('')}<p class="note">${escape(content.diagram.note)}</p></div></section>
<div class="trust">${content.chips.map(chip => `<span>${escape(chip)}</span>`).join('')}</div>
${heading(content.columnsTitle, 'how-it-works', `<div class="three">${content.columns.map((column, index) => `<article><div class="feature-num">${String(index + 1).padStart(2, '0')}</div><h3>${escape(column.title)}</h3><p>${escape(column.text)}</p></article>`).join('')}</div>`)}
${heading(content.sections.trailer, 'trailer', `<figure class="poster"><img src="/assets/poster.png" alt="${escape(content.trailer.alt)}" width="1280" height="720" loading="lazy"><figcaption>${escape(content.trailer.text)}</figcaption></figure>`)}
${heading(content.install.title, 'quickstart', `<div class="docs-grid"><div>${content.install.steps.map((step, index) => `<div class="step"><b>${String(index + 1).padStart(2, '0')}</b><div><h3>${escape(step.title)}</h3><p>${escape(step.text)}</p></div></div>`).join('')}</div><div class="code"><pre><code>${escape(content.install.commands.join('\n\n'))}</code></pre><a href="/docs/install/">${escape(content.install.guide)}</a></div></div>`)}
${heading(content.deeper.title, 'reference', `<div class="docs-links">${content.deeper.cards.map(card => `<a class="doc-link" href="${escape(card.href)}">${escape(card.title)}<span>${escape(card.text)}</span></a>`).join('')}</div>`)}
${heading(content.sections.requirements, 'requirements', `<div class="requirements">${content.requirements.map(item => `<article><h3>${escape(item.title)}</h3><p>${escape(item.text)}</p></article>`).join('')}</div>`)}
${heading(content.sections.questions, 'questions', `<div class="faq">${faq}</div>`)}
${heading(content.sections.set, 'set', `<div class="markdown">${renderMarkdown(set, { source: 'README.md' })}</div>`)}
${heading(content.sections.evidence, 'proof', `<p class="note">${escape(content.proof.note)}</p>${proofTable(facts, featuredProof(facts))}<p><a href="/docs/proof/">${escape(content.proof.details)}</a> · <a href="/docs/guarantees/">${escape(content.proof.guarantees)}</a></p>`)}
${heading(content.sections.fresh, 'releases', `<div class="release"><strong>v${escape(release.version)}${release.verified ? '' : ` ${escape(content.release.pending)}`}</strong><a href="/docs/changelog/">${escape(content.release.changelog)}</a></div>`)}`;
}

function readRelease(root, version) {
  if (!existsSync(join(root, 'website/release.json'))) return { version, verified: false };
  const release = json(root, 'website/release.json');
  if (release.verified !== true) return { version, verified: false };
  requireValue(typeof release.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version), 'Invalid verified release version');
  requireValue(release.version === version, 'Release version differs from package');
  return release;
}

function sidebar(page) {
  const nav = content.nav.map(link => {
    const active = page.route === '/' && link.href === '#overview';
    return `<a href="${page.route === '/' ? '' : '/'}${escape(link.href)}"${active ? ' class="active" aria-current="location"' : ''}>${escape(link.label)}</a>`;
  }).join('\n');
  const docs = pages.filter(item => item.route !== '/').map(item => `<a href="${item.route}"${item.route === page.route ? ' class="active" aria-current="page"' : ''}>${escape(item.h1)}</a>`).join('\n');
  return `<p class="side-label">${escape(content.brand)}</p><nav class="side-links" aria-label="${escape(content.navLabel)}">${nav}</nav><p class="side-label">${escape(content.docsLabel)}</p><nav class="side-links" aria-label="${escape(content.docsLabel)}">${docs}</nav>`;
}

function head(page, facts, live, notFound = false) {
  const url = `${origin}${page.route}`;
  const blocks = [];
  if (page.route === '/' && !notFound) blocks.push(buildJsonLd(facts, { live }), buildFaqJsonLd(facts));
  else if (!notFound) blocks.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: content.breadcrumbs.home, item: `${origin}/` },
    { '@type': 'ListItem', position: 2, name: content.breadcrumbs.section, item: `${origin}/docs/overview/` },
    { '@type': 'ListItem', position: 3, name: page.h1, item: url },
  ] });
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escape(page.title)}</title>
<meta name="description" content="${escape(page.description)}">
<link rel="canonical" href="${url}">
${!live || notFound ? '<meta name="robots" content="noindex">' : `<link rel="describedby" href="${origin}/llms.txt">
<link rel="alternate" type="text/markdown" href="${url}index.md">
<meta property="og:type" content="website">
<meta property="og:title" content="${escape(page.title)}">
<meta property="og:description" content="${escape(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${origin}/assets/social-preview.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escape(content.socialAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(page.title)}">
<meta name="twitter:description" content="${escape(page.description)}">
<meta name="twitter:image" content="${origin}/assets/social-preview.png">
<meta name="twitter:image:alt" content="${escape(content.socialAlt)}">`}
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/site.js" defer></script>
${blocks.map(block => `<script type="application/ld+json">${JSON.stringify(block, null, 2).replace(/</g, '\\u003c')}</script>`).join('\n')}`;
}

function footer(commit) {
  return `<footer class="bottom"><span>${escape(content.footer.text)}</span><a href="${repository}">${escape(content.footer.repository)}</a><span>${escape(content.footer.source)} <a href="${repository}/commit/${commit}">${commit.slice(0, 7)}</a></span></footer>`;
}

function documentBody(page, body) {
  return `<nav class="crumb" aria-label="${escape(content.breadcrumbs.label)}"><a href="/">${escape(content.breadcrumbs.home)}</a><span aria-hidden="true">/</span><a href="/docs/overview/">${escape(content.breadcrumbs.section)}</a><span aria-hidden="true">/</span><span aria-current="page">${escape(page.h1)}</span></nav><h1 id="page-title">${escape(page.h1)}</h1>${body}`;
}

function template(root, page, body, facts, live, commit, notFound = false) {
  const file = page.route === '/' && !notFound ? 'landing.template.html' : 'doc.template.html';
  const header = `<a class="skip" href="#main">${escape(content.skip)}</a><header class="top"><a class="brand" href="/">${escape(content.brand)}</a><nav class="topnav" aria-label="${escape(content.projectLinks)}"><a href="${repository}">${escape(content.github)}</a><a href="${facts.npm}">${escape(content.npm)}</a></nav></header>`;
  const values = { head: head(page, facts, live, notFound), header, sidebar: sidebar(page), body, footer: footer(commit), menu: escape(content.menu), pageClass: file.startsWith('doc') ? 'document' : 'landing' };
  return read(root, `website/${file}`).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    requireValue(Object.hasOwn(values, key), `Unknown template slot: ${key}`);
    return values[key];
  });
}

function validateRendered(documents, facts) {
  for (const { page, html } of documents) {
    requireValue((html.match(/<h1\b/g) || []).length === 1, `Expected one H1: ${page.route}`);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    requireValue(ids.length === new Set(ids).size, `Duplicate anchor: ${page.route}`);
    for (const match of html.matchAll(/<h[1-6]\b[^>]*>([^]*?)<\/h[1-6]>/g)) requireValue(!/your agent keeps working/i.test(visibleText(match[1])), `Forbidden headline: ${page.route}`);
  }
  const landing = documents.find(({ page }) => page.route === '/').html;
  const hero = visibleText(landing.split('<section class="hero"')[1]?.split('</section>')[0] || '');
  for (const keyword of ['browser use', 'Claude Code', 'tokens', 'subagent', 'fresh context']) requireValue(hero.includes(keyword), `Hero missing keyword: ${keyword}`);
  for (const tool of facts.tools) {
    const matches = documents.flatMap(({ page, html }) => [...html.matchAll(/<article data-tool="([^"]+)"[^>]*>([^]*?)<\/article>/g)].filter(match => match[1] === tool.id).map(match => ({ page, body: match[2] })));
    requireValue(matches.length === 1, `Rendered tool missing or duplicated: ${tool.id}`);
    const title = visibleText(matches[0].body.match(/<h3\b[^>]*>([^]*?)<\/h3>/)?.[1] || '');
    requireValue(title.toLowerCase().includes(tool.keywords.primary.toLowerCase()), `Tool heading missing primary phrase: ${tool.id}`);
  }
}

function markdownTwin(html, page) {
  let body = html.match(/<main\b[^>]*>([^]*?)<\/main>/)?.[1] || '';
  body = body.replace(/<footer\b[^>]*>[^]*?<\/footer>/g, '').replace(/<nav\b[^>]*>[^]*?<\/nav>/g, '');
  body = body.replace(/<h([1-6])\b[^>]*>([^]*?)<\/h\1>/g, (_, depth, text) => `\n\n${'#'.repeat(Number(depth))} ${visibleText(text)}\n\n`)
    .replace(/<a href="([^"]+)"[^>]*>([^]*?)<\/a>/g, (_, href, text) => `[${visibleText(text)}](${href.startsWith('/') ? origin : ''}${href.replace(/&amp;/g, '&')})`)
    .replace(/<pre><code>([^]*?)<\/code><\/pre>/g, (_, code) => `\n\n\`\`\`\n${decode(code)}\n\`\`\`\n\n`)
    .replace(/<code>([^]*?)<\/code>/g, (_, code) => `\`${decode(code)}\``)
    .replace(/<\/(?:p|div|section|article|details|tr|li|figure|summary)>/g, '\n\n').replace(/<\/(?:th|td)>/g, ' | ')
    .replace(/<[^>]+>/g, '');
  return `Canonical: ${origin}${page.route}\n\n${decode(body).replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]);
}

export function buildSite({ root = fileURLToPath(new URL('..', import.meta.url)), outDir = join(root, 'website/dist'), live = false, commit, buildTime = new Date().toISOString() } = {}) {
  // Check all inputs and render in memory before replacing the output directory.
  const facts = loadSourceFacts(root);
  validatePages(facts);
  commit ||= process.env.VERCEL_GIT_COMMIT_SHA || execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  requireValue(/^[a-f0-9]{40}$/i.test(commit), 'Expected a full source commit SHA');
  const documents = pages.map(page => ({ page, html: template(root, page, page.route === '/' ? landingBody(root, facts) : documentBody(page, docsBody(root, page, facts)), facts, live, commit) }));
  validateRendered(documents, facts);
  for (const asset of assets) requireValue(existsSync(join(root, 'website/assets', asset)), `Asset missing: ${asset}`);
  const output = resolve(outDir);
  requireValue(output !== resolve(root) && output !== resolve(root, 'website') && !resolve(root).startsWith(`${output}/`), 'Output must be a separate build directory');
  rmSync(output, { recursive: true, force: true });
  const write = (file, value) => { mkdirSync(dirname(join(output, file)), { recursive: true }); writeFileSync(join(output, file), value); };
  for (const { page, html } of documents) write(`${page.route.slice(1)}index.html`, html);
  const missing = { route: '/404.html', title: content.notFound.title, description: content.notFound.text, h1: content.notFound.title };
  write('404.html', template(root, missing, `<h1>${escape(missing.h1)}</h1><p>${escape(missing.description)}</p><a href="/">${escape(content.notFound.link)}</a>`, facts, false, commit, true));
  mkdirSync(join(output, 'assets'), { recursive: true });
  for (const asset of assets) copyFileSync(join(root, 'website/assets', asset), join(output, 'assets', asset));
  write('robots.txt', live ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
  if (live) {
    write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(page => `  <url><loc>${origin}${page.route}</loc></url>`).join('\n')}\n</urlset>\n`);
    const twins = documents.map(({ page, html }) => ({ page, markdown: markdownTwin(html, page) }));
    for (const { page, markdown } of twins) write(`${page.route.slice(1)}index.md`, markdown);
    write('llms.txt', `# ${facts.name}\n\n> ${facts.lead}\n\n${content.discovery.install} \`${content.install.command}\`\n\n## ${content.discovery.pages}\n\n${pages.map(page => `- [${page.h1}](${origin}${page.route}): ${page.description}`).join('\n')}\n\n## ${content.discovery.source}\n\n- [${content.discovery.readme}](${repository}/blob/main/README.md)\n- [${content.discovery.npm}](${facts.npm})\n`);
    write('llms-full.txt', twins.map(twin => twin.markdown).join('\n---\n\n'));
  }
  write('build-info.json', JSON.stringify({ commit, buildTime, packageVersion: facts.version, mode: live ? 'live' : 'default', pageCount: pages.length }, null, 2) + '\n');
  function count(directory) { return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => total + (entry.isDirectory() ? count(join(directory, entry.name)) : 1), 0); }
  return { pages: documents, files: count(output), outDir: output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireValue(args.length <= 1 && args.every(arg => arg === '--live'), 'Usage: node website/build.mjs [--live]');
    const result = buildSite({ live: args.includes('--live') });
    console.log(`Built ${result.pages.length} pages and ${result.files} files (${args.includes('--live') ? 'live' : 'default'}).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
