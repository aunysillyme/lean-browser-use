import fs from 'node:fs';
import { gate } from './gate.mjs';
process.exitCode = gate();
try {
  const proof = JSON.parse(fs.readFileSync('proof/results.json', 'utf8'));
  for (const row of proof.rows) if (Date.now() > Date.parse(`${row.expires}T23:59:59Z`)) console.error(`Warning: proof row ${row.id} expired on ${row.expires}; run npm run proof.`);
} catch { console.error('Warning: proof/results.json is unavailable; run npm run proof.'); }
if (!process.exitCode) console.log('Privacy and terms gate passed.');
