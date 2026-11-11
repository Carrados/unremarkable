// The sites Cloud Dancer may change, and where each one lives. Who owns a site is in the database (owners), not here.
//
// `paths` is the fence: the only folders Cloud Dancer may change in the site's repo. `built` is what the
// site's own build writes from them. Anything else (the build script, a Worker, the workflows, Cloud Dancer's
// own rules) is the machinery, and a change that touches it is refused, both by the run (run.mjs) and by
// the Worker (agent.js). The fence doesn't move because a model got better: a person moves it.
export const SITES = {
  'unremarkable.me': { name: 'Unremarkable', repo: 'Carrados/unremarkable', paths: ['src/'], built: ['site/'], build: 'node build.mjs', worker: 'unremarkable' },
};

// Preview copies live on the account's own workers.dev address. No other address is taken as a preview.
export const PREVIEW_DOMAIN = 'charlijotyrer.workers.dev';

// The address of a page on one of the owner's sites, or null. `site` is the host it must be on.
export function pageOn(site, raw) {
  try {
    const u = new URL(String(raw || '').trim().slice(0, 500));
    return u.protocol === 'https:' && u.hostname.replace(/^www\./, '') === site ? u : null;
  } catch { return null; }
}

export function previewUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim().slice(0, 500));
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname.endsWith(`.${PREVIEW_DOMAIN}`) ? u : null;
  } catch { return null; }
}

// Is this file inside the fence for this site? A path that climbs out ("..") or starts at the root is never inside.
export function inFence(site, file) {
  const s = SITES[site];
  const f = String(file || '');
  if (!s || !f || f.startsWith('/') || f.split('/').includes('..') || f.includes('\\')) return false;
  return [...s.paths, ...s.built].some(p => f.startsWith(p));
}

// The files that are outside the fence, from a list of changed files.
export const outsideFence = (site, files) => files.filter(f => !inFence(site, f));

export const branchFor = id => `dancer/request-${id}`;
