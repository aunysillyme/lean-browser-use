import fs from 'node:fs';
import path from 'node:path';
import { termHashes } from './gate.mjs';
const source = process.argv[2] || '.repo-build/private.local.txt';
const target = process.argv[3] || 'test/terms.private.sha256';
try {
  const hashes = [...new Set(termHashes(fs.readFileSync(source, 'utf8')))].sort();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${hashes.join('\n')}\n`);
  console.log(`Wrote ${hashes.length} term hashes.`);
} catch { console.error('Unable to read the private list or write its hashes.'); process.exitCode = 2; }
