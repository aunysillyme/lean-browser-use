import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, walk, exists } from '../src/util.mjs';

export function tokens(text) {
  return [...String(text).toLowerCase().matchAll(/[a-z0-9][a-z0-9._-]*[a-z0-9]|[a-z0-9]/g)].map(m => ({ value: m[0].replace(/[._-]+$/, ''), index: m.index }));
}
export const normalize = text => tokens(text).map(t => t.value).join(' ');
export function termHashes(text) {
  return text.split(/\r?\n/).filter(line => line.trim() && !line.trimStart().startsWith('#')).map(line => sha256(normalize(line)));
}
export function loadHashes(root, extra = process.env.LBU_PRIVATE_LIST) {
  const hashes = new Set();
  const digestFile = path.join(root, 'test/terms.private.sha256');
  if (exists(digestFile)) for (const line of fs.readFileSync(digestFile, 'utf8').split(/\s+/)) if (/^[a-f0-9]{64}$/.test(line)) hashes.add(line);
  for (const file of [path.join(root, '.repo-build/private.local.txt'), extra].filter(Boolean)) {
    if (exists(file)) for (const hash of termHashes(fs.readFileSync(file, 'utf8'))) hashes.add(hash);
  }
  return hashes;
}
export function scanText(text, hashes = new Set()) {
  const hits = [];
  const add = (line, type) => hits.push({ line, class: type });
  text.split(/\r?\n/).forEach((line, index) => {
    const n = index + 1;
    for (const m of line.matchAll(/\/(?:Users|home)\/[^\s/"'<>`]+/g)) {
      if (!['/home/user', '/Users/you'].includes(m[0])) add(n, 'home-path');
    }
    for (const m of line.matchAll(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
      if (!(new RegExp('^\\s*Co-authored-by:', 'i').test(line) && ['noreply' + '@' + 'anthropic.com', 'noreply' + '@' + 'openai.com'].includes(m[0]))) add(n, 'email');
    }
    for (const m of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      const ip = m[0], parts = ip.split('.').map(Number);
      if (parts.some(x => x > 255)) continue;
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) add(n, 'tailnet');
      else if (!['127.0.0.1', '0.0.0.0'].includes(ip) && !/^(192\.0\.2|198\.51\.100|203\.0\.113)\./.test(ip)) add(n, 'ipv4');
    }
    if (/\bAUN-\d+\b/.test(line)) add(n, 'ticket');
    if (line.toLowerCase().includes('linear' + '.app')) add(n, 'tracker');
    const secret = new RegExp('sk-' + '[A-Za-z0-9]{20,}|gh' + 'p_|github' + '_pat_|AKIA[0-9A-Z]{16}|xox[abp]-|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----');
    if (secret.test(line)) add(n, 'secret');
    if (line.includes(String.fromCodePoint(0x2014))) add(n, 'em-dash');
  });
  const words = tokens(text);
  for (let i = 0; i < words.length; i++) {
    let phrase = '';
    for (let n = 1; n <= 4 && i + n <= words.length; n++) {
      phrase += (n > 1 ? ' ' : '') + words[i + n - 1].value;
      const hash = sha256(phrase);
      if (hashes.has(hash)) add(text.slice(0, words[i].index).split('\n').length, `private-term:${hash.slice(0, 8)}`);
    }
  }
  return [...new Map(hits.map(hit => [`${hit.line}:${hit.class}`, hit])).values()];
}
function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
export function gate(root = process.cwd(), { extraList, output = console.log } = {}) {
  root = path.resolve(root);
  const hashes = loadHashes(root, extraList);
  const listing = git(root, ['ls-files', '-z', '-co', '--exclude-standard']);
  const files = listing.status === 0 ? [...new Set(listing.stdout.split('\0').filter(Boolean))] : walk(root).map(f => path.relative(root, f)).filter(f => !f.split(path.sep).some(p => ['.git', 'node_modules', '__pycache__', 'state', '.repo-build'].includes(p)) && !f.endsWith('.tgz'));
  let count = 0;
  for (const file of files) {
    const stem = file.slice(0, file.length - path.extname(file).length);
    const nameHits = [...new Map([...scanText(file, hashes), ...scanText(stem, hashes)].map(h => [h.class, h])).values()];
    // A private filename must not become a disclosure in the diagnostic itself.
    const label = nameHits.length ? `file-${sha256(file).slice(0, 8)}` : file;
    for (const hit of nameHits) { output(`${label}:name:${hit.class}`); count++; }
    const full = path.join(root, file);
    try {
      if (!exists(full)) continue;
      const stat = fs.lstatSync(full);
      const text = stat.isSymbolicLink() ? fs.readlinkSync(full) : stat.isFile() ? fs.readFileSync(full, 'utf8') : '';
      for (const hit of scanText(text, hashes)) { output(`${label}:${hit.line}:${hit.class}`); count++; }
    } catch { output(`${label}:0:unreadable`); count++; }
  }
  const log = git(root, ['log', '--all', '--format=%H%x00%B%x00']);
  if (log.status === 0) {
    const pieces = log.stdout.split('\0');
    for (let i = 0; i + 1 < pieces.length; i += 2) {
      const sha = pieces[i].trim().slice(0, 8);
      for (const hit of scanText(pieces[i + 1], hashes)) { output(`commit:${sha}:${hit.class}`); count++; }
    }
  }
  const tags = git(root, ['tag', '--list']);
  if (tags.status === 0) for (const tag of tags.stdout.trim().split('\n').filter(Boolean)) {
    for (const hit of scanText(tag, hashes)) { output(`tag:${sha256(tag).slice(0, 8)}:${hit.class}`); count++; }
  }
  return count ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = gate(process.argv[2] || process.cwd());
