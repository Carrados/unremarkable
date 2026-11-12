// The sites Phix may fix, and how each one is previewed. This table decides where a fix is pushed and which
// Worker its preview copy goes on. Phix (the agent) does not get to say: it comes from the page that was reported.
//
//   repo     the site's own repo
//   config   the wrangler file for that site, as it is on the repo's main branch
//   assets   the folder of built pages that file serves
//   build    the npm script that builds that folder, when the built pages are not kept in the repo

export const SITES = {
  'unremarkable.me': { repo: 'Carrados/unremarkable', config: 'wrangler.jsonc', assets: 'site' },
  'tka.unremarkable.me': { repo: 'Carrados/tka', config: 'wrangler.jsonc', assets: 'site' },
  'charli-jo.com': { repo: 'Carrados/charli-jo', config: 'wrangler.jsonc', assets: 'site' },
  'carrados.com': { repo: 'Carrados/Charli.info', config: 'wrangler.carrados.jsonc', assets: 'dist/carrados', build: 'build:carrados' },
  'charli.info': { repo: 'Carrados/Charli.info', config: 'wrangler.charli.jsonc', assets: 'dist/charli', build: 'build:charli' },
  'zeroinformationcasualty.org': { repo: 'Carrados/Charli.info', config: 'wrangler.zic.jsonc', assets: 'dist/zic', build: 'build:zic' },
  'blind-ant.com': { repo: 'Carrados/Charli.info', config: 'wrangler.blind-ant.jsonc', assets: 'dist/blind-ant', build: 'build:blind-ant' },
  'aegisdynamics.blind-ant.com': { repo: 'Carrados/Charli.info', config: 'wrangler.aegis.jsonc', assets: 'dist/aegis', build: 'build:aegis' },
};

// The site a report is about, from the host it was made on, or null.
export const siteOf = host => SITES[String(host || '').toLowerCase().replace(/^www\./, '')] || null;

// What a fix may never touch: it would change what the agents are, what their keys reach, or code that runs
// with a site's secrets. The owner approves what they see on the preview, and none of this shows there.
const MACHINERY = [
  /^\.github\//, /^\.claude\//, /^dancer\//, /^flo\//, /^phix\//, /^fix\//,
  /^wrangler[^/]*\.(jsonc|json|toml)$/, /^package(-lock)?\.json$/, /^(CLAUDE|AGENTS)\.md$/,
  /(^|\/)worker\.(js|mjs|ts)$/, /(^|\/)mcp\//,
];

// The first changed file that is part of a site's machinery, or ''. `files` are paths from the repo's root.
export const machinery = files => files.find(f => MACHINERY.some(m => m.test(f))) || '';

// The work the claim step handed on: only whole numbers, and only sites in the table.
export function readWork(raw) {
  let w;
  try { w = JSON.parse(raw); } catch { return []; }
  return (Array.isArray(w) ? w : []).filter(x => Number.isInteger(x.id) && x.id > 0 && siteOf(x.site)).map(x => ({ id: x.id, ...siteOf(x.site) }));
}
