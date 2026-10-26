import { reap, summary, exitCodeFor, age, sessionFromEnv } from '../hooks/lease.mjs';

export async function cleanup(options = {}) {
  const session = options.session || (options.all ? '' : sessionFromEnv());
  let result;
  try { result = await reap({ apply: !!options.apply, session, run: options.run }); }
  catch { console.error('cleanup: the process list could not be read; nothing was ended.'); return 1; }
  if (options.json) { console.log(JSON.stringify(result, null, 2)); return exitCodeFor(result); }
  if (!result.apply) for (const c of result.candidates) console.log(`candidate ${c.name} pid=${c.pid} processes=${c.processes} age=${age(c.ageSeconds)} session=${c.session ? c.session.slice(0, 8) : '-'} run=${c.run || '-'}`);
  for (const r of result.refused) console.error(`refused pid=${r.pid} lease=${r.id}: ${r.reason}`);
  console.log(summary(result));
  return exitCodeFor(result);
}
