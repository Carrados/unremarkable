// unremarkable.me: static site, plus the "Fix something on this page" form.
// GET  /fix/        the form, with the reported page filled in from ?page=
// POST /fix/        save a report to D1, then go to /fix/sent/
// GET  /fix/sent/   the thank-you page, with a link back to the reported page
// Nothing stored identifies the reporter: no name, no email, no IP address.

const READINGS = ['by-eye', 'screen-reader', 'magnifier', 'voice', 'keyboard', 'switch', 'braille', 'agent', 'other'];
const LIMITS = { page: 500, what: 5000, expected: 2000, setup: 300, ua: 500 };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only http(s) addresses are accepted as the reported page.
function pageUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim().slice(0, LIMITS.page));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch { return null; }
}

async function template(env, request, path) {
  const res = await env.ASSETS.fetch(new URL(path, request.url));
  return res.text();
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

function fillForm(t, v, error) {
  let out = t
    .replace('{{PAGE}}', esc(v.page))
    .replace('{{WHAT}}', esc(v.what))
    .replace('{{EXPECTED}}', esc(v.expected))
    .replace('{{SETUP}}', esc(v.setup))
    .replace(/\{\{R:([a-z-]+)\}\}/g, (_, r) => (r === v.reading ? ' checked' : ''));
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
    reading: READINGS.includes(get('reading', 40)) ? get('reading', 40) : '',
  };

  // The hidden field only a bot fills in. Pretend it worked, store nothing.
  if (get('website', 200)) return Response.redirect(new URL('/fix/sent/', request.url), 303);

  const page = pageUrl(v.page);
  let error = '';
  if (!page) error = 'Please give the address of the page with the problem, starting with https://.';
  else if (!v.what) error = 'Please say what happened.';
  if (error) return html(fillForm(await template(env, request, '/fix/'), v, error), 400);

  await env.DB.prepare(
    `INSERT INTO reports (site, page, what_happened, expected, reading, setup, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    page.hostname, page.href, v.what, v.expected || null, v.reading || null, v.setup || null,
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

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
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
