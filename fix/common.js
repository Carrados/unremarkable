// Helpers shared by the fix form (worker.js) and Phix (phix.js).

export const READINGS = ['by-eye', 'screen-reader', 'magnifier', 'voice', 'keyboard', 'switch', 'braille', 'agent', 'other'];
export const LIMITS = { page: 500, what: 5000, expected: 2000, setup: 300, ua: 500 };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only pages on sites Unremarkable built are accepted as the reported page.
export const SITES = ['unremarkable.me', 'carrados.com', 'charli.info', 'zeroinformationcasualty.org', 'blind-ant.com', 'aegisdynamics.blind-ant.com', 'charli-jo.com', 'tka.unremarkable.me'];
export function pageUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim().slice(0, LIMITS.page));
    const host = u.hostname.replace(/^www./, '');
    return (u.protocol === 'https:' || u.protocol === 'http:') && SITES.includes(host) ? u : null;
  } catch { return null; }
}

export async function template(env, request, path) {
  const res = await env.ASSETS.fetch(new URL(path, request.url));
  return res.text();
}

export const SECURITY = {
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

export function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      ...SECURITY,
      ...extra,
    },
  });
}

// Pages that carry a report's key never pass their address on to the next page.
export const PRIVATE = { 'Referrer-Policy': 'no-referrer' };

// 128 random bits, as 22 URL-safe characters.
export function newKey() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const KEY = /^\/fix\/r\/([A-Za-z0-9_-]{22})\/?$/;
export const reportUrl = (request, key) => new URL(`/fix/r/${key}/`, request.url).href;

// How long a fix waits for "it works for me" before the report closes by itself.
export const CONFIRM_DAYS = 30;
export const DAY = 86400000;
export const dateText = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
export const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

// What someone wrote, back as paragraphs: blank lines start a new one, single line breaks are kept.
export const paras = s => String(s).split(/\n\s*\n/).map(p => `<p>${esc(p.trim()).replace(/\r?\n/g, '<br>\n')}</p>`).join('\n');

// The ways of reading the page, in words.
export const READING_TEXT = {
  'by-eye': 'Reading the screen', 'screen-reader': 'A screen reader', magnifier: 'Magnification or zoom',
  voice: 'Voice control', keyboard: 'Keyboard only', switch: 'Switch access', braille: 'A braille display',
  agent: 'An AI agent', other: 'Something else',
};
