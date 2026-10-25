// Let the documented directory command resolve on every supported Node version.
import fs from 'node:fs';
for (const file of fs.readdirSync(new URL('./', import.meta.url)).filter(name => name.endsWith('.test.mjs')).sort()) {
  await import(new URL(file, import.meta.url));
}
