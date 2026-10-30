import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildJsonLd, buildFaqJsonLd, loadSourceFacts, featuredProof, visibleText } from './facts.mjs';
import { pages } from './pages.mjs';
import { content } from './content.mjs';
import { readPins, copyPinFailures } from './copy.mjs';

const origin = 'https://lean-browser-use.aunysillyme.dev';
const repository = 'https://github.com/aunysillyme/lean-browser-use';
import { assets, csp, fontStylesheet } from './resources.mjs';
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
  markdown = markdown.replace(/^---\n[^]*?\n---\n/, '').replace(/<!--[^]*?-->/g, ' ');
  markdown = markdown.replace(/^\[([^\]]+)\]:\s*(\S+).*$/gm, (_, label, href) => { references.set(label.toLowerCase(), href); return ''; });
  function inline(value, tokens = []) {
    const save = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
    value = value.replace(/`([^`]+)`/g, (_, code) => save(`<code>${escape(code)}</code>`));
    value = value.replace(/<(script|style|iframe|object|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ').replace(/<\/?[a-z][^>]*>/gi, ' ');
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

function cardTrace() {
  return '<svg class="card-trace" aria-hidden="true" focusable="false"><rect class="ray-tail" x=".5" y=".5" pathLength="100"/><rect class="ray-mid" x=".5" y=".5" pathLength="100"/><rect class="ray-tip" x=".5" y=".5" pathLength="100"/></svg>';
}

function proofTable(facts, rows = facts.proof) {
  const labels = content.proof;
  return `<div class="proof-card card">${cardTrace()}<div class="table-scroll"><table class="proof-table"><thead><tr>${[labels.measurement, labels.value, labels.measured, labels.expires].map(label => `<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody>\n${rows.map(row => `<tr data-proof="${escape(row.id)}"><th scope="row">${escape(row.claim)}</th><td data-value>${escape(row.value)} ${escape(row.unit)}</td><td data-measured>${escape(row.measured)}</td><td data-expires>${escape(row.expires || '')}</td></tr>`).join('\n')}\n</tbody></table></div></div>`;
}

function toolBlocks(page, facts, ids) {
  return page.tools.map(id => {
    const tool = facts.tools.find(tool => tool.id === id);
    return `<article data-tool="${escape(id)}" class="tool card">${cardTrace()}<p class="eyebrow">${escape(tool.kind)}</p><h3 id="${uniqueId(`${tool.name}: ${tool.keywords.primary}`, ids)}">${escape(tool.name)}: ${escape(tool.keywords.primary)}</h3><p data-does>${escape(tool.does)}</p>${tool.commands.map(command => `<pre><code>${escape(command)}</code></pre>`).join('')}</article>`;
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
  const heading = (title, id, label, body, extra = '') => `<section class="content ${extra}" id="${id}"><div class="section-title"><h2>${escape(title)}</h2><span>${escape(label)}</span></div>${body}</section>`;
  const release = readRelease(root, facts.version);
  const faq = facts.faq.map(row => `<details><summary data-faq-question>${escape(row.question)}</summary><p data-faq-answer>${renderMarkdown(row.answerMarkdown, { source: 'README.md' }).replace(/^<p>|<\/p>$/g, '')}</p></details>`).join('\n');
  const scene = content.scene;
  const introduction = read(root, 'README.md').match(/^For Claude Code users[^]*?(?=\nNext:)/m)?.[0];
  requireValue(introduction, 'README audience and package summary missing');
  const costTable = section(read(root, 'docs/benchmark.md'), 'What it cost in dollars').match(/(?:^\|.*(?:\n|$))+/m)?.[0]?.trim();
  requireValue(costTable, 'Benchmark cost table missing');
  const graphic = `<div class="routing card" id="routing">${cardTrace()}<div class="routing-head"><span>${escape(scene.title)}</span><span>${escape(scene.label)}</span></div><div class="task-tabs" role="group" aria-label="Browser task stages">${scene.steps.map((step, index) => `<button type="button" data-task="${step.title.toLowerCase()}" data-caption="${escape(step.text)}" aria-pressed="${index === 0}">${escape(step.title)}</button>`).join('')}</div><div class="task" id="task-text" aria-live="polite">${escape(scene.steps[0].text)}</div><div class="stem"></div><div class="route-core selected" data-role="frame">MAIN SESSION + TASK PACKET</div><div class="split"></div><div class="route-options"><div class="route-node" data-role="run"><b>Fresh runner</b>Work the pages in bulk</div><div class="route-node" data-role="read"><b>Saved evidence</b>Read named fields together</div><div class="route-node" data-role="verify"><b>Main session</b>Check evidence + cleanup</div></div><p class="route-foot">The user chooses the browser profile.<br>The runner returns saved evidence and cleanup proof.</p></div>`;
  return `<div class="crumb"><a href="https://aunysillyme.dev/">Home</a><span>/</span><b>${escape(content.brand)}</b></div>
<section class="hero" id="overview"><div><p class="eyebrow">${escape(content.eyebrow)}</p><h1 data-headline-source="${escape(facts.lead)}">${escape(content.headline)}<br><em>${escape(content.headlineAccent)}</em></h1><p class="lede">${escape(content.heroLede)}</p><div class="install card">${cardTrace()}<span class="dollar" aria-hidden="true">$</span><code id="install-command">${escape(content.install.command)}</code><button class="copy" type="button" data-copy="install-command" aria-label="${escape(content.install.copy)}" title="${escape(content.install.copy)}"><span data-button-label>⧉</span></button></div><div class="hero-actions"><a class="primary" href="#quickstart">Get started ↓</a><a href="${repository}">Explore the source ↗</a></div></div>${graphic}</section>
<div class="trust">${content.chips.map(chip => `<span>${escape(chip)}</span>`).join('')}</div>
${heading(content.sections.trailer, 'trailer', 'WATCH THE TRAILER', `<video autoplay muted loop playsinline preload="auto" width="1280" height="720" poster="/assets/trailer-poster.jpg" aria-label="${escape(content.trailer.alt)}" aria-describedby="trailer-note"><source src="/assets/trailer.webm" type="video/webm"><source src="/assets/trailer.mp4" type="video/mp4">Your browser does not support embedded video. <a href="/assets/trailer.mp4">Watch the trailer ↗</a></video><div class="trailer-caption"><p class="note" id="trailer-note">${escape(content.trailer.text)}</p><button type="button" class="trailer-toggle" aria-label="Pause trailer" aria-pressed="true"><svg class="icon-pause" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x="2" y="1.5" width="3" height="9"/><rect x="7" y="1.5" width="3" height="9"/></svg><svg class="icon-play" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 1.5v9l7.5-4.5z"/></svg><span class="sr-only" data-button-label>Pause trailer</span></button></div>`, 'trailer')}
${heading(content.columnsTitle, 'how-it-works', content.sectionLabels.how, `<div class="markdown product-summary">${renderMarkdown(introduction, { source: 'README.md' })}</div><div class="three">${content.columns.map((column, index) => `<article class="card">${cardTrace()}<div class="feature-num">${String(index + 1).padStart(2, '0')} / ${escape(column.label)}</div><h3>${escape(column.title)}</h3><p>${escape(column.text)}</p><a href="${column.href}">${escape(column.link)} ↗</a></article>`).join('')}</div>`)}
${heading(content.install.title, 'quickstart', content.sectionLabels.install, `<div class="docs-grid"><div>${content.install.steps.map((step, index) => `<div class="step"><b>${String(index + 1).padStart(2, '0')}</b><div>${escape(step.title)}<p>${escape(step.text)}</p></div></div>`).join('')}</div><div><div class="code card">${cardTrace()}<pre><code>${escape(content.install.commands.join('\n\n'))}</code></pre></div><p class="note">${escape(content.install.note)}<br><a href="/docs/install/">${escape(content.install.guide)} ↗</a></p></div></div>`)}
${heading(content.deeper.title, 'reference', content.sectionLabels.deeper, `<div class="docs-links">${content.deeper.cards.map(card => `<a class="doc-link card" href="${escape(card.href)}">${cardTrace()}${escape(card.title)} ↗<span>${escape(card.text)}</span></a>`).join('')}</div>`)}
${heading(content.sections.requirements, 'requirements', 'YOUR SETUP', `<div class="three requirements">${content.requirements.map(item => `<article class="card">${cardTrace()}<h3>${escape(item.title)}</h3><p>${escape(item.text)}</p></article>`).join('')}</div>`)}
${heading(content.sections.questions, 'questions', 'FROM THE README', `<div class="markdown faq">${faq}</div>`)}
${heading(content.sections.evidence, 'proof', content.sectionLabels.evidence, `<p class="note">${escape(content.proof.note)}</p><div class="markdown">${renderMarkdown(costTable, { source: 'docs/benchmark.md' })}</div><p class="note">A browser step re-reads about 3x fewer tokens in the runner. Whole-run tokens rose in both measured runs. The break-even estimate is unmeasured.</p>${proofTable(facts, featuredProof(facts))}<div class="docs-grid"><p class="note">Dated measurements and saved benchmark rows. Measure your own transcripts.</p><div class="hero-actions"><a class="primary" href="/docs/proof/">${escape(content.proof.details)} ↗</a><a href="/docs/guarantees/">${escape(content.proof.guarantees)} ↗</a></div></div>`)}
${heading(content.sections.fresh, 'releases', content.sectionLabels.fresh, `<div class="release"><div><strong>v${escape(release.version)}</strong><small>${release.verified ? '' : escape(content.release.pending)}</small></div><p>${escape(content.release.text)}</p></div><p><a class="primary" href="/docs/changelog/">${escape(content.release.changelog)} ↗</a></p>`)}`;
}

function readRelease(root, version) {
  if (!existsSync(join(root, 'website/release.json'))) return { version, verified: false };
  const release = json(root, 'website/release.json');
  if (release.verified !== true) return { version, verified: false };
  requireValue(typeof release.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version), 'Invalid verified release version');
  requireValue(release.version === version, 'Release version differs from package');
  return release;
}

function navigation(page) {
  if (page.route === '/') return content.nav.map(link => `<a href="${escape(link.href)}"${link.href === '#overview' ? ' class="active" aria-current="location"' : ''}>${escape(link.label)}</a>`).join('\n');
  return pages.filter(item => item.route !== '/').map(item => `<a href="${item.route}"${item.route === page.route ? ' class="active" aria-current="page"' : ''}>${escape(item.h1)}</a>`).join('\n');
}

function sidebar(root, page) {
  const set = section(read(root, 'README.md'), 'Part of a set');
  const siblings = [...set.matchAll(/\[([^\]]+)\]\((https:\/\/github\.com\/aunysillyme\/[^)]+)\)/g)];
  if (page.route !== '/') return `<p class="side-label">DOCUMENTATION</p><nav class="side-links" aria-label="Documentation">${navigation(page)}</nav><div class="side-bottom">Questions or feedback?<a class="issue-button" href="${repository}/issues/new/choose" target="_blank" rel="noopener noreferrer">File an issue ↗</a></div>`;
  return `<p class="side-label">${page.route === '/' ? escape(content.brand.toUpperCase()) : content.docsLabel}</p><nav class="side-links" aria-label="Documentation">${navigation(page)}</nav><p class="side-label">THE REST OF THE SET</p><nav class="side-links" aria-label="Related repositories">${siblings.map(([, label, url]) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>`).join('')}<\/nav><div class="side-bottom"><div>Questions or feedback?</div><a class="issue-button" href="${repository}/issues/new/choose" target="_blank" rel="noopener noreferrer" aria-label="File an issue for ${escape(content.brand)} on GitHub">File an issue ↗</a><span>Open source · MIT license</span></div>`;
}

function head(page, facts, live, notFound = false) {
  const url = `${origin}${page.route}`;
  const blocks = [];
  if (page.route === '/' && !notFound) blocks.push(buildJsonLd(facts, { live }), buildFaqJsonLd(facts));
  else if (!notFound) blocks.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: content.brand, item: `${origin}/` },
    { '@type': 'ListItem', position: 2, name: 'Documentation', item: url },
  ] });
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta http-equiv="Content-Security-Policy" content="${csp}">
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
<link rel="icon" href="/assets/avatar.png"><link rel="apple-touch-icon" href="/assets/avatar.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fontStylesheet}" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
<script type="module" src="/assets/site.js"></script>
${blocks.map(block => `<script type="application/ld+json">${JSON.stringify(block, null, 2).replace(/</g, '\\u003c')}</script>`).join('\n')}`;
}

function footer(commit, page) {
  if (page.route !== '/') return `<footer class="bottom"><a href="/">← Back to ${escape(content.brand)}</a><a href="${repository}/issues/new/choose" target="_blank" rel="noopener noreferrer">File an issue ↗</a></footer>`;
  return `<p id="copy-status" class="sr-only" role="status" data-success="${escape(content.install.copySuccess)}" data-fallback="${escape(content.install.copyFallback)}"></p><footer class="bottom"><span>Built by <a href="https://aunysillyme.dev/">AunySillyMe</a> · Frame the task. Check the evidence. MIT licensed.</span><a href="${repository}">${escape(content.footer.repository)} ↗</a><span>${escape(content.footer.source)} <a href="${repository}/commit/${commit}">${commit.slice(0, 7)}</a></span></footer>`;
}

function documentBody(page, body, commit, buildTime) {
  const firstSource = body.match(/<p class="source-note">[^]*?<\/p>/)?.[0] || '';
  body = body.replace(firstSource, '');
  if (page.sources[0].endsWith('.md')) body = body.replace(/<h2 id="([^"]+)">[^]*?<\/h2>/, '<span id="$1"></span>');
  const provenance = firstSource.replace('/blob/main/', `/blob/${commit}/`).replace('</p>', ` · <a href="${repository}/tree/${commit}">${commit.slice(0, 7)}</a> · Built ${escape(buildTime.slice(0, 10))}</p>`);
  return `<nav class="crumb" aria-label="${escape(content.breadcrumbs.label)}"><a href="/">${escape(content.brand)}</a><span aria-hidden="true">/</span><span>Documentation</span></nav>${provenance}<article class="markdown"><h1 id="page-title">${escape(page.h1)}</h1></article>${body}`;
}

function template(root, page, body, facts, live, commit, notFound = false) {
  const file = page.route === '/' && !notFound ? 'landing.template.html' : 'doc.template.html';
  const header = page.route === '/' ? `<a class="skip" href="#main">${escape(content.skip)}</a><header class="top"><a class="brand" href="https://aunysillyme.dev/" target="_blank" rel="noopener noreferrer"><img src="/assets/avatar.png" alt="AunySillyMe"><span>AunySillyMe.dev</span><span class="slash">/</span><b>${escape(content.brand)}</b></a><nav class="topnav" aria-label="${escape(content.projectLinks)}"><span class="pill"><i class="dot"></i><span data-version>v${escape(facts.version)}</span></span><a href="${repository}" target="_blank" rel="noopener noreferrer">GitHub ↗</a><a href="${facts.npm}" target="_blank" rel="noopener noreferrer">npm ↗</a></nav></header>` : `<a class="skip" href="#main">${escape(content.skip)}</a><header class="top"><a class="brand" href="/"><img src="/assets/avatar.png" alt="AunySillyMe"><span>${escape(content.brand)}</span></a><nav class="topnav" aria-label="Project links"><a href="/">Home</a><a href="${repository}" target="_blank" rel="noopener noreferrer">GitHub ↗</a></nav></header>`;
  const mobileNav = `<details class="mobile-nav"><summary>${escape(page.route === '/' ? content.onThisPage : 'Documentation')}</summary><nav aria-label="Mobile documentation">${navigation(page)}</nav></details>`;
  const values = { head: head(page, facts, live, notFound), header, sidebar: sidebar(root, page), mobileNav, body, footer: footer(commit, page) };
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
  body = body.replace(/<details class="mobile-nav">[^]*?<\/details>/g, '').replace(/<footer\b[^>]*>[^]*?<\/footer>/g, '').replace(/<nav\b[^>]*>[^]*?<\/nav>/g, '');
  const codeBlocks = [];
  const saveCode = code => { codeBlocks.push(code); return `\u0000CODE${codeBlocks.length - 1}\u0000`; };
  body = body.replace(/<h([1-6])\b[^>]*>([^]*?)<\/h\1>/g, (_, depth, text) => `\n\n${'#'.repeat(Number(depth))} ${visibleText(text)}\n\n`)
    .replace(/<a href="([^"]+)"[^>]*>([^]*?)<\/a>/g, (_, href, text) => `[${visibleText(text)}](${href.startsWith('/') ? origin : ''}${href.replace(/&amp;/g, '&')})`)
    .replace(/<pre><code>([^]*?)<\/code><\/pre>/g, (_, code) => saveCode(`\n\n\`\`\`\n${decode(code)}\n\`\`\`\n\n`))
    .replace(/<code>([^]*?)<\/code>/g, (_, code) => saveCode(`\`${decode(code)}\``))
    .replace(/<\/(?:p|div|section|article|details|tr|li|figure|summary)>/g, '\n\n').replace(/<\/(?:th|td)>/g, ' | ')
    .replace(/<[^>]+>/g, ' ');
  const markdown = decode(body).replace(/</g, '&lt;').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // Restore code placeholders with literal delimiter searches; code contents are
  // inserted only after all HTML/entity processing has finished.
  const delimiter = '\u0000';
  let restored = '', cursor = 0;
  while (cursor < markdown.length) {
    const start = markdown.indexOf(delimiter, cursor);
    if (start < 0) break;
    const end = markdown.indexOf(delimiter, start + 1);
    if (end < 0) break;
    const token = markdown.slice(start + 1, end).match(/^CODE(\d+)$/);
    if (token) {
      restored += markdown.slice(cursor, start) + codeBlocks[Number(token[1])];
      cursor = end + 1;
    } else {
      restored += markdown.slice(cursor, start + 1);
      cursor = start + 1;
    }
  }
  return `Canonical: ${origin}${page.route}\n\n${restored + markdown.slice(cursor)}\n`;
}

function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]);
}

export function buildSite({ root = fileURLToPath(new URL('..', import.meta.url)), outDir = join(root, 'website/dist'), live = false, commit, buildTime = new Date().toISOString() } = {}) {
  // Check all inputs and render in memory before replacing the output directory.
  const facts = loadSourceFacts(root);
  validatePages(facts);
  const drift = copyPinFailures(readPins(root), { headlineSource: facts.lead, headline: content.headline, installCommand: content.install.command, description: content.documents.landing.description });
  requireValue(drift.length === 0, drift.join('; '));
  commit ||= process.env.VERCEL_GIT_COMMIT_SHA || execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  requireValue(/^[a-f0-9]{40}$/i.test(commit), 'Expected a full source commit SHA');
  const documents = pages.map(page => ({ page, html: template(root, page, page.route === '/' ? landingBody(root, facts) : documentBody(page, docsBody(root, page, facts), commit, buildTime), facts, live, commit) }));
  validateRendered(documents, facts);
  for (const asset of assets) requireValue(existsSync(join(root, 'website/assets', asset)), `${live ? 'Live build' : 'Preview build'} asset missing: website/assets/${asset}. Supply the local asset before building.`);
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
