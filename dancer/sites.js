// The sites Cloud Dancer may change, and where each one lives. Who owns a site is in the database (owners), not here.
//
// `flow` is the list of folders Flo may change on that site. Empty means flow is off: Cloud Dancer can't hand
// a request to Flo, and Flo's `posted` is refused, so nothing goes live without the owner's "publish". Turn it on
// for a site only once its FLOW.md has a shape, and list only the folders that shape uses.
export const SITES = {
  'unremarkable.me': { name: 'Unremarkable', repo: 'Carrados/unremarkable', flow: [] },
};

// Whether flow is on for a site. Checked by the Worker, not left to the agents' judgement.
export const flowOn = site => (SITES[site]?.flow || []).length > 0;

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
