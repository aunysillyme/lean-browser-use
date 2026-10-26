import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readPins(root) {
  const pins = JSON.parse(readFileSync(join(root, 'website/pins.json'), 'utf8'));
  for (const key of ['about', 'readmeLead', 'installCommand', 'packageDescription']) {
    if (typeof pins[key] !== 'string' || !pins[key].trim()) throw Error(`Missing copy pin: ${key}`);
  }
  if (!/^(.+) in Claude Code:/.test(pins.readmeLead)) throw Error('Pinned README lead format differs');
  return pins;
}

export function copyPinFailures(pins, { headlineSource, headline, installCommand, description }) {
  const failures = [];
  const headlineFromLead = `${pins.readmeLead.match(/^(.+) in Claude Code:/)[1]}.`;
  if (headlineSource !== pins.readmeLead) failures.push('pinned headline source differs from README lead');
  if (headline !== headlineFromLead) failures.push('pinned headline differs from README lead');
  if (installCommand !== pins.installCommand) failures.push('pinned install command differs');
  if (description !== pins.packageDescription || description !== pins.about) failures.push('pinned meta description differs from package or About');
  return failures;
}
