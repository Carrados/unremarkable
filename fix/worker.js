// unremarkable.me: static site, plus the "Fix something on this page" form.
// GET  /fix/        the form, with the reported page filled in from ?page=
// POST /fix/        save a report to D1, then go to /fix/sent/
// GET  /fix/sent/   the thank-you page: the reporter's own link, and a way back to the reported page
// GET  /fix/r/<k>/  the reporter's own page for one report: what they wrote, where it stands
// POST /fix/r/<k>/  the reporter says "it works for me", or "it still doesn't work"
// Nothing stored identifies the reporter: no name, no email, no IP address. Instead of asking
// for an email so we can reply, every report gets a long random key, and whoever holds the link
// can follow it. The key is the only way in, so it is never shown anywhere else.

import { READINGS, LIMITS, esc, SITES, pageUrl, template, SECURITY, html, PRIVATE, newKey, KEY, reportUrl, CONFIRM_DAYS, DAY, forgetOldReports, dateText, now, paras, READING_TEXT } from './common.js';
import { scheduled, phixApi, ownerPage, phixLine, step, OWNER_KEY } from './phix.js';
// Cloud Dancer's way to GitHub (wake Flo, look at and merge her pull requests): fix/door.js.
export { Dancer } from './door.js';

// The reported page. When we know it from the link the visitor followed, it is a sentence, not a
// field: a pre-filled address box was one more stop for VoiceOver on iPhone ("Page, text field, h t t p s...")
// that nobody needed to change. The address travels in a hidden input. Only when we don't know the page
// (someone came to /fix/ directly, or typed an address we can't accept) do we ask for it.
function pageField(raw) {
  const page = pageUrl(raw);
  if (page) {
    let shown = page.hostname.replace(/^www\./, '') + (page.pathname === '/' ? '' : page.pathname) + page.search;
    try { shown = decodeURI(shown); } catch {}
    return `<p class="from-page">This report is about the page you came from: <span class="from-page-address">${esc(shown)}</span></p>
<input type="hidden" name="page" value="${esc(page.href)}">`;
  }
  return `<div class="field">
<label for="page">Page</label>
<p class="hint" id="page-hint">The address of the page with the problem, starting with https://</p>
<input type="url" id="page" name="page" value="${esc(raw)}" required maxlength="500" aria-describedby="page-hint" autocomplete="off">
</div>`;
}

function fillForm(t, v, error) {
  let out = t
    .replace('{{PAGE_FIELD}}', pageField(v.page))
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

  const key = newKey();
  await env.DB.prepare(
    `INSERT INTO reports (token, site, page, what_happened, expected, reading, setup, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    key, page.hostname, page.href, v.what, v.expected || null, v.reading.join(',') || null, v.setup || null,
    (request.headers.get('User-Agent') || '').slice(0, LIMITS.ua) || null,
  ).run();

  const sent = new URL('/fix/sent/', request.url);
  sent.searchParams.set('r', key);
  sent.searchParams.set('page', page.href);
  return Response.redirect(sent, 303);
}

async function showSent(request, env) {
  const q = new URL(request.url).searchParams;
  const page = pageUrl(q.get('page'));
  const key = String(q.get('r') || '');
  const t = await template(env, request, '/fix/sent/');
  // A bot that filled in the hidden field lands here with no key: it gets the page without a link.
  const link = /^[A-Za-z0-9_-]{22}$/.test(key)
    ? `<h2 id="your-link">Your link</h2>
<p>This link goes to your report's own page. Keep it: bookmark it, or copy it somewhere safe. We don't know who you are, so it's the only way back to your report.</p>
<p class="report-link"><a href="/fix/r/${key}/">${esc(reportUrl(request, key))}</a></p>
<p>On that page you can see what you sent and where it stands. When the fix is live, it asks whether it works for you now. Anyone with the link can see your report, so share it only with someone you'd show the report to.</p>`
    : '';
  const back = page ? `<p><a href="${esc(page.href)}">Back to the page you were on</a></p>` : '';
  return html(t.replace('{{LINK}}', link).replace('{{BACK}}', back), 200, PRIVATE);
}

// The reporter's own page for one report.

function standing(r) {
  const fixedOn = r.fixed_at ? dateText(r.fixed_at) : '';
  const closes = r.fixed_at ? new Date(Date.parse(r.fixed_at) + CONFIRM_DAYS * DAY) : null;
  switch (r.status) {
    case 'fixed':
      if (r.confirmed_at) return { text: `<p class="lede">Fixed, and it works for you.</p>\n<p>The fix went live${fixedOn ? ` on ${fixedOn}` : ''}, and on ${dateText(r.confirmed_at)} you told us it works for you. This report is closed. Thank you.</p>` };
      if (closes && Date.now() > closes.getTime()) return { text: `<p class="lede">Fixed. This report has closed.</p>\n<p>The fix went live on ${fixedOn}. We didn't hear whether it works for you, so after ${CONFIRM_DAYS} days the report closed by itself.</p>`, newReport: true };
      return { text: `<p class="lede">Fixed, and live on the page.</p>\n<p>The fix went live${fixedOn ? ` on ${fixedOn}` : ''}. Please try the page again the way you were using it when it went wrong.</p>`, ask: true, closes };
    case 'wont-fix': return { text: '<p class="lede">Closed: we\'re not changing this.</p>\n<p>We looked at it and decided to leave the page as it is. Why is below.</p>' };
    case 'duplicate': return { text: '<p class="lede">Closed: we already knew about this.</p>\n<p>Someone else reported the same problem, and it is being fixed there. When it is, the fix goes live on the page.</p>' };
    case 'spam': return { text: '<p class="lede">Closed.</p>' };
    default:
      if (r.reporter_notes) return { text: `<p class="lede">Open again.</p>\n<p>You told us it still didn't work, so we are on it again. This page will say when the new fix is live.</p>\n${phixLine(r)}` };
      return { text: `<p class="lede">Open. We have your report.</p>\n<p>It hasn't been fixed yet. When the fix is live on the page, this page will say so and ask whether it works for you.</p>\n${phixLine(r)}` };
  }
}

function reportPage(r, request, notice, steps = []) {
  const s = standing(r);
  const page = pageUrl(r.page);
  const reading = String(r.reading || '').split(',').filter(Boolean).map(k => READING_TEXT[k] || k);
  const out = [];
  if (notice) out.push(`<div class="notice" role="status"><p>${notice}</p></div>`);
  out.push('<h2 id="where-it-stands">Where it stands</h2>', s.text);
  if (steps.length) {
    out.push('<h2 id="what-has-happened">What has happened</h2>', `<ul class="steps">\n${steps.map(st => `<li>${esc(dateText(st.at))}: ${esc(st.text)}</li>`).join('\n')}\n</ul>`);
  }
  // Phix's account of the fix is shown once it has been decided on, not while it waits for the owner.
  if ((r.understood || r.did) && (r.status !== 'open' || r.phix === 'done')) {
    out.push('<h2 id="what-we-did">What we did</h2>');
    // When the owner leaves the page as it is, the reporter sees the owner's reasons, not Phix's notes.
    if (r.understood && r.status !== 'wont-fix') out.push('<h3>What we understood</h3>', paras(r.understood));
    if (r.did) out.push(`<h3>${r.status === 'wont-fix' ? 'Why' : 'What we changed'}</h3>`, paras(r.did));
  }
  if (s.ask) {
    out.push(`<h2 id="does-it-work">Does it work for you now?</h2>
<form class="fix-form" method="post" action="/fix/r/${r.token}/">
<p><button type="submit" name="answer" value="works">It works for me</button></p>
</form>
<form class="fix-form" method="post" action="/fix/r/${r.token}/">
<div class="field">
<label for="note">What's still wrong? <span class="optional">(only if it still doesn't work)</span></label>
<textarea id="note" name="note" rows="4" maxlength="${LIMITS.expected}"></textarea>
</div>
<p><button type="submit" name="answer" value="again">It still doesn't work</button></p>
</form>
<p>If we don't hear, this report closes by itself on ${dateText(s.closes.toISOString())}.</p>`);
  }
  if (s.newReport && page) out.push(`<p>If it still doesn't work, <a href="/fix/?page=${encodeURIComponent(page.href)}">send a new report about that page</a>.</p>`);
  out.push(`<h2 id="what-you-sent">What you sent</h2>
<p>On ${dateText(r.created_at)}, about ${page ? `<a href="${esc(page.href)}">${esc(page.hostname.replace(/^www\./, '') + (page.pathname === '/' ? '' : page.pathname))}</a>` : esc(r.page)}.</p>
<h3>What happened</h3>
${paras(r.what_happened)}`);
  if (r.expected) out.push('<h3>What you expected</h3>', paras(r.expected));
  if (reading.length) out.push('<h3>How you were reading the page</h3>', `<ul>\n${reading.map(x => `<li>${esc(x)}</li>`).join('\n')}\n</ul>`);
  if (r.setup) out.push('<h3>Your setup</h3>', paras(r.setup));
  if (r.reporter_notes) out.push('<h3>What you told us since</h3>', paras(r.reporter_notes));
  out.push(`<h2 id="this-link">This page's link</h2>
<p class="report-link">${esc(reportUrl(request, r.token))}</p>
<p>Anyone with this link can see this report. We don't know who you are, so keep it if you want to come back.</p>`);
  return out.join('\n');
}

async function findReport(env, key) {
  return env.DB.prepare('SELECT * FROM reports WHERE token = ?').bind(key).first();
}

async function showReport(request, env, key, notice) {
  const r = await findReport(env, key);
  if (!r) {
    const t = await template(env, request, '/fix/r/');
    return html(t.replace('<title>', '<title>Not found: ').replace('{{REPORT}}',
      '<p class="lede">There\'s no report at this address.</p>\n<p>Check the link is complete: it ends with a long run of letters, numbers and dashes, then a slash. If you copied it from somewhere, it may have been cut short.</p>\n<p><a href="/fix/">Send a new report</a></p>'), 404, PRIVATE);
  }
  const t = await template(env, request, '/fix/r/');
  const { results: steps } = await env.DB.prepare('SELECT at, who, text FROM steps WHERE report_id = ? ORDER BY id').bind(r.id).all();
  return html(t.replace('{{REPORT}}', reportPage(r, request, notice, steps)), 200, PRIVATE);
}

async function answerReport(request, env, key) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.LIMITER.limit({ key: ip });
  if (!success) return html('<!doctype html><html lang="en-GB"><title>Too many answers</title><p>Too many answers in a minute. Please wait a moment and try again.</p></html>', 429);
  const r = await findReport(env, key);
  const back = new URL(`/fix/r/${key}/`, request.url);
  // Answers only count while the fix is waiting for one.
  if (!r || !standing(r).ask) return Response.redirect(back, 303);
  const form = await request.formData();
  const answer = String(form.get('answer') || '');
  const note = String(form.get('note') || '').trim().slice(0, LIMITS.expected);
  if (answer === 'works') {
    await env.DB.prepare(`UPDATE reports SET confirmed_by = 'reporter', confirmed_at = ? WHERE id = ?`).bind(now(), r.id).run();
    await step(env, r.id, 'reporter', 'You told us it works for you.');
    back.searchParams.set('said', 'works');
  } else if (answer === 'again') {
    const line = `${dateText(now())}: it still didn't work.${note ? `\n${note}` : ''}`;
    await env.DB.prepare(`UPDATE reports SET status = 'open', fixed_at = NULL, phix = 'retry', reporter_notes = CASE WHEN reporter_notes IS NULL THEN ? ELSE reporter_notes || char(10) || char(10) || ? END WHERE id = ?`)
      .bind(line, line, r.id).run();
    await step(env, r.id, 'reporter', 'You told us it still didn\'t work.');
    back.searchParams.set('said', 'again');
  }
  return Response.redirect(back, 303);
}

const SAID = {
  works: 'Thank you. We\'ve noted that it works for you, and closed the report.',
  again: 'Thank you. We\'ve opened the report again, with what you told us.',
};

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
    if (pathname.startsWith('/phix/api/')) return phixApi(request, env);
    const owner = OWNER_KEY.exec(pathname);
    if (owner) {
      if (!pathname.endsWith('/')) return Response.redirect(new URL(pathname + '/', request.url), 301);
      return ownerPage(request, env, owner[1]);
    }
    const mine = KEY.exec(pathname);
    if (mine) {
      if (!pathname.endsWith('/')) return Response.redirect(new URL(pathname + '/', request.url), 301);
      if (request.method === 'POST') return answerReport(request, env, mine[1]);
      if (request.method === 'GET' || request.method === 'HEAD') return showReport(request, env, mine[1], SAID[url.searchParams.get('said')]);
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
    }
    // The raw templates (/fix/index.html and so on) are never served as they are.
    if (pathname.startsWith('/fix/')) return Response.redirect(new URL('/fix/', request.url), 302);
    return env.ASSETS.fetch(request);
  },
  // Phix wakes at 06:00 and midday, UK time, if there's work (the cron in wrangler.jsonc).
  // Every time the cron fires, reports past their 12 months are deleted.
  scheduled(event, env, ctx) {
    ctx.waitUntil(forgetOldReports(env).then(n => { if (n) console.log('Deleted old reports:', n); }));
    return scheduled(event, env, ctx);
  },
};
