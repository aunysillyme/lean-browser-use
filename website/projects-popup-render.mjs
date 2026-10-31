import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const subhead = (line) => String(line).split(':', 1)[0].trim();
export const escapeHtml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function renderProjectsPopup({ rows, current = '', id, fallbackHref }) {
  if (!id || !fallbackHref || !Array.isArray(rows)) throw new TypeError('rows, id and fallbackHref are required');
  if (!rows.length) throw new TypeError('At least one project is required');
  const names = rows.map(({ name }) => typeof name === 'string' ? name.toLowerCase() : name);
  const currentName = typeof current === 'string' ? current.toLowerCase() : current;
  if (currentName && names.filter((name) => name === currentName).length > 1) throw new TypeError(`Multiple current projects: ${current}`);
  if (currentName && !names.includes(currentName)) throw new TypeError(`Unknown current project: ${current}`);
  if (new Set(names).size !== names.length) throw new TypeError('Duplicate project names');
  const items = rows.map(({ name, line }, index) => {
    if (typeof name !== 'string' || name.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new TypeError(`Invalid project name: ${name}`);
    if (typeof line !== 'string' || !subhead(line)) throw new TypeError(`Invalid project line for ${name}: expected a non-empty subhead`);
    const title = escapeHtml(name);
    return `<li><a class="projects-popup__link" href="https://${title}.aunysillyme.dev"${name === currentName ? ' aria-current="page"' : ''}><svg class="card-trace" aria-hidden="true" focusable="false"><rect class="ray-tail" x=".5" y=".5" pathLength="100"/><rect class="ray-mid" x=".5" y=".5" pathLength="100"/><rect class="ray-tip" x=".5" y=".5" pathLength="100"/></svg><span class="projects-popup__number" aria-hidden="true">${String(index + 1).padStart(2, '0')} /</span><span class="projects-popup__copy"><span class="projects-popup__name">${title}${name === currentName ? ' <span class="projects-popup__current">(current)</span>' : ''}</span><span class="projects-popup__line">${escapeHtml(subhead(line))}</span></span></a></li>`;
  }).join('');
  return `<div class="projects-popup" data-projects-popup><a class="projects-popup__trigger" data-projects-trigger href="${escapeHtml(fallbackHref)}">Projects</a><div class="projects-popup__panel" data-projects-panel id="${escapeHtml(id)}" hidden><ul class="projects-popup__list">${items}</ul></div></div>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, current, fallbackHref] = process.argv.slice(2);
  if (!path || !current || !fallbackHref) throw new Error('Usage: node <renderer-script> <set.json> <current-name|-> <fallbackHref>');
  const { rows } = JSON.parse(readFileSync(path, 'utf8'));
  console.log(renderProjectsPopup({ rows, current: current === '-' ? '' : current, id: 'projects-popup', fallbackHref }));
}
