// unremarkable.me: static site, plus the "Fix something on this page" form.
// GET  /fix/        the form, with the reported page filled in from ?page=
// POST /fix/        save a report to D1, then go to /fix/sent/
// GET  /fix/sent/   the thank-you page, with a link back to the reported page
// Nothing stored identifies the reporter: no name, no email, no IP address.

const READINGS = ['by-eye', 'screen-reader', 'magnifier', 'voice', 'keyboard', 'switch', 'braille', 'agent', 'other'];
const LIMITS = { page: 500, what: 5000, expected: 2000, setup: 300, ua: 500 };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only pages on sites Unremarkable built are accepted as the reported page.
const SITES = ['unremarkable.me', 'carrados.com', 'charli.info', 'zeroinformationcasualty.org', 'blind-ant.com', 'aegisdynamics.blind-ant.com', 'charli-jo.com', 'tka.unremarkable.me'];
function pageUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim().slice(0, LIMITS.page));
    const host = u.hostname.replace(/^www./, '');
    return (u.protocol === 'https:' || u.protocol === 'http:') && SITES.includes(host) ? u : null;
  } catch { return null; }
}

async function template(env, request, path) {
  const res = await env.ASSETS.fetch(new URL(path, request.url));
  return res.text();
}

const SECURITY = {
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      ...SECURITY,
    },
  });
}

function fillForm(t, v, error) {
  let out = t
    .replace('{{PAGE}}', esc(v.page))
    .replace('{{WHAT}}', esc(v.what))
    .replace('{{EXPECTED}}', esc(v.expected))
    .replace('{{SETUP}}', esc(v.setup))
    .replace(/\{\{R:([a-z-]+)\}\}/g, (_, r) => ((v.reading || []).includes(r) ? ' checked' : ''));
  if (error) {
    out = out
      .replace('<title>', '<title>Error: ')
      .replace('{{ERROR}}', `<div class="error" role="alert"><h2 class="error-title">There's a problem</h2><p>${esc(error)}</p></div>`);
  } else {
    out = out.replace('{{ERROR}}', '');
  }
  return out;
}

async function showForm(request, env) {
  const page = pageUrl(new URL(request.url).searchParams.get('page'));
  const t = await template(env, request, '/fix/');
  return html(fillForm(t, { page: page ? page.href : '' }));
}

async function saveReport(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.LIMITER.limit({ key: ip });
  if (!success) return html('<!doctype html><html lang="en-GB"><title>Too many reports</title><p>Too many reports in a minute. Please wait a moment and try again.</p></html>', 429);

  const form = await request.formData();
  const get = (k, n) => String(form.get(k) || '').trim().slice(0, n);
  const v = {
    page: get('page', LIMITS.page),
    what: get('what', LIMITS.what),
    expected: get('expected', LIMITS.expected),
    setup: get('setup', LIMITS.setup),
    // Ways of reading: any of the form's choices, in the form's order.
    reading: READINGS.filter(r => form.getAll('reading').map(String).includes(r)),
  };

  // The hidden field only a bot fills in. Pretend it worked, store nothing.
  if (get('website', 200)) return Response.redirect(new URL('/fix/sent/', request.url), 303);

  const page = pageUrl(v.page);
  let error = '';
  if (!page) error = 'Please give the address of the page with the problem, starting with https://. It needs to be a page on a site Unremarkable built, such as unremarkable.me or blind-ant.com.';
  else if (!v.what) error = 'Please say what happened.';
  if (error) return html(fillForm(await template(env, request, '/fix/'), v, error), 400);

  await env.DB.prepare(
    `INSERT INTO reports (site, page, what_happened, expected, reading, setup, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    page.hostname, page.href, v.what, v.expected || null, v.reading.join(',') || null, v.setup || null,
    (request.headers.get('User-Agent') || '').slice(0, LIMITS.ua) || null,
  ).run();

  const sent = new URL('/fix/sent/', request.url);
  sent.searchParams.set('page', page.href);
  return Response.redirect(sent, 303);
}

async function showSent(request, env) {
  const page = pageUrl(new URL(request.url).searchParams.get('page'));
  const t = await template(env, request, '/fix/sent/');
  const back = page ? `<p><a href="${esc(page.href)}">Back to the page you were on</a></p>` : '';
  return html(t.replace('{{BACK}}', back));
}

// The Start form, under the As If standard (src/as-if.html): Unremarkable isn't trading yet,
// so what is written is checked and thrown away. Nothing is stored or sent.
const START_LIMITS = { name: 200, organisation: 200, email: 320, what: 5000, more: 2000 };

function fillStart(t, v, error) {
  let out = t;
  for (const k of Object.keys(START_LIMITS)) out = out.replace(`{{${k.toUpperCase()}}}`, esc(v[k]));
  if (error) {
    return out
      .replace('<title>', '<title>Error: ')
      .replace('{{ERROR}}', `<div class="error" role="alert"><h2 class="error-title">There's a problem</h2><p>${esc(error)}</p></div>`);
  }
  return out.replace('{{ERROR}}', '');
}

async function showStart(request, env) {
  const t = await template(env, request, '/start/');
  return new Response(fillStart(t, {}), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY } });
}

async function checkStart(request, env) {
  const form = await request.formData();
  const get = k => String(form.get(k) || '').trim().slice(0, START_LIMITS[k] || 200);
  const v = Object.fromEntries(Object.keys(START_LIMITS).map(k => [k, get(k)]));
  const sent = new URL('/start/sent/', request.url);
  if (String(form.get('website') || '').trim()) return Response.redirect(sent, 303);
  let error = '';
  if (!v.name) error = 'Please give your name.';
  else if (!v.organisation) error = 'Please give the name of your organisation.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) error = 'Please give an email address, like name@example.org.';
  else if (!v.what) error = 'Please say what people come to you to do.';
  if (error) return html(fillStart(await template(env, request, '/start/'), v, error), 400);
  // Checked, and now thrown away: nothing is stored or sent.
  return Response.redirect(sent, 303);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    // One address for the site: www goes to the bare domain.
    if (url.hostname === 'www.unremarkable.me') {
      url.hostname = 'unremarkable.me';
      return Response.redirect(url.toString(), 301);
    }
    if (pathname === '/start') return Response.redirect(new URL('/start/', request.url), 301);
    if (pathname === '/start/') {
      if (request.method === 'POST') return checkStart(request, env);
      if (request.method === 'GET' || request.method === 'HEAD') return showStart(request, env);
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
    }
    if (pathname === '/start/index.html') return Response.redirect(new URL('/start/', request.url), 302);
    if (pathname === '/fix') return Response.redirect(new URL('/fix/' + new URL(request.url).search, request.url), 301);
    if (pathname === '/fix/') {
      if (request.method === 'POST') return saveReport(request, env);
      if (request.method === 'GET' || request.method === 'HEAD') return showForm(request, env);
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
    }
    if (pathname === '/fix/sent/') return showSent(request, env);
    // The raw templates (/fix/index.html and so on) are never served as they are.
    if (pathname.startsWith('/fix/')) return Response.redirect(new URL('/fix/', request.url), 302);
    return env.ASSETS.fetch(request);
  },
};
