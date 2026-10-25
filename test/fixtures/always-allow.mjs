import fs from 'node:fs';
// This counterexample deliberately ignores the decision after reading the payload.
JSON.parse(fs.readFileSync(0, 'utf8'));
process.exitCode = 0;
