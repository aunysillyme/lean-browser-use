import { content } from './content.mjs';

const page = (key, route, sources, tools = []) => ({ route, ...content.documents[key], sources, tools });

export const pages = [
  page('landing', '/', ['README.md', 'proof/results.json']),
  page('overview', '/docs/overview/', ['README.md']),
  page('how', '/docs/how-it-works/', ['docs/how-it-works.md', 'agents/aun-browser-runner.md'], ['runner']),
  page('guides', '/docs/guides/', [
    'skills/lean-browser-use/SKILL.md',
    'skills/lean-browser-use/references/route-by-job.md',
    'skills/lean-browser-use/references/logged-in-run.md',
    'skills/lean-browser-use/references/packet-principle.md',
    'skills/lean-browser-use/references/cleanup.md',
    'skills/lean-browser-use/references/failure-modes.md',
    'skills/lean-browser-use/references/cost-model.md',
    'skills/lean-browser-use/references/draft-offline.md',
    'skills/lean-browser-use/references/runner-rules.md',
    'skills/lean-browser-use/references/verify.md',
    'briefs/browser-read.md',
    'briefs/helper-read.md',
    'docs/reader.md',
    'docs/search.md',
  ], ['skill', 'brief']),
  page('commands', '/docs/commands/', ['docs/install.md', 'docs/measure.md', 'docs/reader.md', 'docs/search.md', 'README.md'], ['reader', 'search', 'measure', 'doctor', 'installer']),
  page('proof', '/docs/proof/', ['proof/results.json', 'docs/benchmark.md']),
  page('changelog', '/docs/changelog/', ['CHANGELOG.md']),
  page('install', '/docs/install/', ['docs/install.md']),
  page('guarantees', '/docs/guarantees/', ['docs/cleanup.md', 'docs/guards.md', 'docs/PROVENANCE.md', 'CREDITS.md'], ['pick', 'retry', 'batch']),
];

export default pages;
