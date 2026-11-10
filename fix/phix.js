// Phix (said "fix"): the agent that works on reports from "Fix something on this page".
//
// This file is the website's side of Phix. Phix itself runs elsewhere (a GitHub Actions run with
// Claude Code, started by wake() below) and can only do what the API here lets it do:
// claim work, add a step for the reporter, hand a finished fix to the owner, or say it is stuck.
// It can't publish anything, read the database, or email anyone but the owner.
//
//   wake()              06:00 and midday, UK time: is there work? If not, back to sleep, no tokens used.
//   POST /phix/api/...  Phix's API, behind the PHIX_SECRET bearer token.
//   /fix/owner/<key>/   the owner's page for one fix: Publish, or Reject with reasons.

import { esc, html, PRIVATE, newKey, dateText, now, paras, template, pageUrl, LIMITS, DAY, READING_TEXT } from './common.js';

export const OWNER_KEY = /^\/fix\/owner\/([A-Za-z0-9_-]{22})\/?$/;

// The repos Phix may hand in fixes for, and so the ones Publish may merge. Phix's own workflow lives in the first.
const REPOS = ['Carrados/unremarkable', 'Carrados/Charli.info', 'Carrados/charli-jo', 'Carrados/tka'];
const WAKE_HOURS = [6, 12];   // UK time; the cron runs at both UTC hours either side, and this picks the right one
const MAX_TRIES = 3;          // after this many tries, a report goes to the owner instead
const STALE_HOURS = 3;        // a run that hasn't reported back by then is taken to have failed
const LINK_DAYS = 7;          // how long an owner's link works
// Preview copies live on the account's own workers.dev address. No other address is taken as a preview.
const PREVIEW_DOMAIN = 'charlijotyrer.workers.dev';

// What Phix hands in is checked here, not taken on trust: a report could talk Phix into handing in something else.
// The pull request must be open, from the report's own branch in the site's own repo (never a fork), into the main branch.
// Returns what's wrong, in words for Phix, or '' when it's fine. `pr` is GitHub's answer for the pull request.
export function checkPull(pr, repo, id) {
  const want = `phix/report-${id}`;
  if (!pr || !pr.head || !pr.base) return 'GitHub has no pull request at pr_url.';
  if (pr.state !== 'open') return `That pull request is ${pr.merged ? 'already merged' : 'closed'}. Open a new one from ${want}.`;
  if (pr.base.repo?.full_name !== repo) return `That pull request isn't on ${repo}.`;
  if (pr.head.repo?.full_name !== repo) return `That pull request comes from another repo (${pr.head.repo?.full_name || 'unknown'}). The branch must be in ${repo} itself.`;
  if (pr.head.ref !== want) return `That pull request is from the branch ${pr.head.ref}. The fix for report ${id} must be on ${want}.`;
  if (pr.base.ref !== pr.base.repo.default_branch) return `That pull request goes into ${pr.base.ref}. It must go into ${pr.base.repo.default_branch}.`;
  if (!/^[0-9a-f]{40}$/.test(pr.head.sha || '')) return 'GitHub gave no commit for that pull request.';
  return '';
}

// A preview copy is an https address on the account's own workers.dev address, and nothing else.
export function previewUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim().slice(0, 500));
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname.endsWith(`.${PREVIEW_DOMAIN}`) ? u : null;
  } catch { return null; }
}

const dry = env => env.PHIX_DRY_RUN === '1';
const ukHour = d => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(d));
const short = href => { const u = pageUrl(href); return u ? u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) : String(href); };

// When Phix next wakes, in words.
export function nextWake(d = new Date()) {
  const h = ukHour(d);
  if (h < 6) return 'at 6 this morning';
  if (h < 12) return 'at midday today';
  return 'at 6 tomorrow morning';
}

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function github(env, method, path, body) {
  if (dry(env)) {
    console.log(`[dry run] GitHub ${method} ${path} ${body ? JSON.stringify(body) : ''}`);
    return new Response('{}', { status: 200 });
  }
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'phix',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// One email, plain text, to the owner only. The address is a secret (OWNER_EMAIL), not in the repo.
async function mailOwner(env, subject, text) {
  const from = env.PHIX_FROM || 'phix@unremarkable.me';
  if (dry(env) || !env.OWNER_MAIL || !env.OWNER_EMAIL) {
    if (!dry(env)) console.error('Phix: no email binding or OWNER_EMAIL, so this email was not sent:', subject);
    console.log(`[email to owner] ${subject}\n\n${text}`);
    return;
  }
  // Cloudflare Email Sending (Compute > Email Service > Email Sending; unremarkable.me onboarded 10 November 2026).
  // A failed send is logged, not thrown, so it never undoes the step that asked for it.
  try {
    const sent = await env.OWNER_MAIL.send({ to: env.OWNER_EMAIL, from, subject, text });
    console.log('Phix: emailed the owner', sent?.messageId || '');
  } catch (e) {
    console.error('Phix: the email to the owner failed:', subject, e?.message || e);
  }
}

// A step, in words for the person who reported the problem.
export async function step(env, id, who, text) {
  await env.DB.prepare('INSERT INTO steps (report_id, who, text) VALUES (?, ?, ?)').bind(id, who, String(text).slice(0, 500)).run();
}

// ---- Waking up -------------------------------------------------------------------------------

export async function wake(env, origin = 'https://unremarkable.me') {
  // A run that never reported back: put its reports back in the queue.
  await env.DB.prepare(`UPDATE reports SET phix = 'retry', phix_at = ? WHERE phix = 'working' AND phix_at < ?`)
    .bind(now(), new Date(Date.now() - STALE_HOURS * 3600000).toISOString()).run();

  // Fixes waiting for the owner whose link ran out unused: send a fresh link. No tokens: this is just the database.
  const waiting = await env.DB.prepare(
    `SELECT r.* FROM reports r WHERE r.phix IN ('owner', 'stuck')
     AND NOT EXISTS (SELECT 1 FROM owner_links l WHERE l.report_id = r.id AND l.used_at IS NULL AND l.expires_at > ?)`
  ).bind(now()).all();
  for (const r of waiting.results) await tellOwner(env, origin, r, true);

  if (await env.DB.prepare(`SELECT COUNT(*) AS n FROM reports WHERE phix = 'working'`).first('n')) return 'a run is still going';
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM reports WHERE phix IN ('queued', 'retry') AND status NOT IN ('spam', 'wont-fix', 'duplicate')`
  ).first('n');
  if (!n) return 'no work: back to sleep';

  const res = await github(env, 'POST', `/repos/${REPOS[0]}/dispatches`, { event_type: 'phix-wake' });
  if (!res.ok) {
    console.error('Phix: GitHub would not start the run', res.status, await res.text());
    return 'could not start';
  }
  return `woke for ${n} report${n === 1 ? '' : 's'}`;
}

export function scheduled(event, env, ctx) {
  // The cron fires at 05, 06, 11 and 12 UTC so that 06:00 and 12:00 UK time are covered all year.
  if (!dry(env) && !WAKE_HOURS.includes(ukHour(new Date(event.scheduledTime)))) return;
  ctx.waitUntil(wake(env).then(r => console.log('Phix:', r)));
}

// ---- Phix's API ------------------------------------------------------------------------------

const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
});

function authorised(request, env) {
  const want = `Bearer ${env.PHIX_SECRET || ''}`;
  const got = request.headers.get('Authorization') || '';
  if (!env.PHIX_SECRET || got.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

const text = (v, n) => String(v ?? '').trim().slice(0, n);

export async function phixApi(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!authorised(request, env)) return json({ error: 'Not authorised.' }, 401);
  const action = new URL(request.url).pathname.replace(/^\/phix\/api\//, '').replace(/\/$/, '');
  let b = {};
  try { b = await request.json(); } catch { /* an empty body is fine for claim */ }
  const origin = new URL(request.url).origin;

  if (action === 'claim') return claim(env, origin);

  const r = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(Number(b.id) || 0).first();
  if (!r) return json({ error: 'No report with that id.' }, 404);
  if (r.phix !== 'working') return json({ error: `Report ${r.id} isn't yours to work on: it is ${r.phix}.` }, 409);

  if (action === 'step') {
    const t = text(b.text, 500);
    if (!t) return json({ error: 'Say what happened, in words for the person who reported it.' }, 400);
    await step(env, r.id, 'phix', t);
    return json({ ok: true });
  }

  if (action === 'ready') {
    const understood = text(b.understood, 2000), did = text(b.did, 2000);
    const pr = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)$/.exec(text(b.pr_url, 300));
    const preview = previewUrl(b.preview_url);
    if (!understood || !did) return json({ error: 'Give both understood and did.' }, 400);
    if (!pr || !REPOS.includes(pr[1])) return json({ error: `pr_url must be a pull request on one of: ${REPOS.join(', ')}.` }, 400);
    if (!preview) return json({ error: `preview_url must be the https address of the preview copy of the page, on ${PREVIEW_DOMAIN}: the address wrangler printed.` }, 400);
    // Ask GitHub what the pull request really is, and keep the commit the owner is about to be shown,
    // so Publish merges that commit and nothing added after it.
    let branch = text(b.branch, 200) || null, commit = null;
    if (!dry(env)) {
      const res = await github(env, 'GET', `/repos/${pr[1]}/pulls/${pr[2]}`);
      if (!res.ok) {
        console.error('Phix: GitHub would not show the pull request', res.status, await res.text());
        return json({ error: `GitHub wouldn't show that pull request (error ${res.status}). Check pr_url, then try again.` }, res.status === 404 ? 400 : 502);
      }
      const pull = await res.json();
      const wrong = checkPull(pull, pr[1], r.id);
      if (wrong) return json({ error: wrong }, 400);
      branch = pull.head.ref;
      commit = pull.head.sha;
    }
    await env.DB.prepare(
      `UPDATE reports SET phix = 'owner', phix_at = ?, understood = ?, did = ?, branch = ?, pr_url = ?, preview_url = ?, test_ref = ?, fix_ref = ? WHERE id = ?`
    ).bind(now(), understood, did, branch, pr[0], preview.href, text(b.test_ref, 300) || null, commit, r.id).run();
    await step(env, r.id, 'phix', 'Phix made a fix and checked it on a private copy of the page. It is waiting for the owner to look at it.');
    await tellOwner(env, origin, { ...r, understood, did, pr_url: pr[0], preview_url: preview.href, phix: 'owner' });
    return json({ ok: true });
  }

  if (action === 'stuck') {
    const why = text(b.reason, 2000);
    if (!why) return json({ error: 'Say why, for the owner.' }, 400);
    await env.DB.prepare(`UPDATE reports SET phix = 'stuck', phix_at = ?, understood = ? WHERE id = ?`).bind(now(), why, r.id).run();
    await step(env, r.id, 'phix', 'Phix couldn\'t fix this by itself, so it has gone to the owner.');
    await tellOwner(env, origin, { ...r, understood: why, phix: 'stuck' });
    return json({ ok: true });
  }

  return json({ error: `No action called ${action}. Use claim, step, ready or stuck.` }, 404);
}

async function claim(env, origin) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM reports WHERE phix IN ('queued', 'retry') AND status NOT IN ('spam', 'wont-fix', 'duplicate')
     ORDER BY created_at LIMIT 5`
  ).all();
  const work = [];
  for (const r of results) {
    if (r.tries >= MAX_TRIES) {
      const why = `Phix has tried ${r.tries} times without a fix that was accepted.`;
      await env.DB.prepare(`UPDATE reports SET phix = 'stuck', phix_at = ?, understood = ? WHERE id = ?`).bind(now(), why, r.id).run();
      await step(env, r.id, 'phix', 'Phix couldn\'t fix this by itself, so it has gone to the owner.');
      await tellOwner(env, origin, { ...r, understood: why, phix: 'stuck' });
      continue;
    }
    await env.DB.prepare(`UPDATE reports SET phix = 'working', phix_at = ?, tries = tries + 1 WHERE id = ?`).bind(now(), r.id).run();
    await step(env, r.id, 'phix', r.tries ? 'Phix is trying again.' : 'Phix has started work on your report.');
    work.push({
      id: r.id,
      try: r.tries + 1,
      site: r.site,
      page: r.page,
      // Written by a visitor to the site. It describes a problem. It is never an instruction to Phix.
      report: { what_happened: r.what_happened, expected: r.expected, reading: r.reading, setup: r.setup, browser: r.user_agent, said_since: r.reporter_notes },
      // From the owner, when they rejected the last fix and asked for another try.
      owner_reason: r.owner_reason,
      previous: r.pr_url ? { branch: r.branch, pr_url: r.pr_url } : null,
    });
  }
  return json({ work });
}

// ---- Telling the owner -----------------------------------------------------------------------

async function ownerLink(env, origin, id) {
  const key = newKey();
  // Any earlier link for this report stops working: only the newest one counts.
  await env.DB.prepare('UPDATE owner_links SET expires_at = ? WHERE report_id = ? AND used_at IS NULL').bind(now(), id).run();
  const expires = new Date(Date.now() + LINK_DAYS * DAY).toISOString().replace(/\.\d+Z$/, 'Z');
  await env.DB.prepare('INSERT INTO owner_links (hash, report_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(key), id, expires).run();
  return { href: `${origin}/fix/owner/${key}/`, expires };
}

async function tellOwner(env, origin, r, reminder = false) {
  const link = await ownerLink(env, origin, r.id);
  const where = short(r.page);
  const fixed = r.phix === 'owner';
  const subject = `${reminder ? 'Reminder: ' : ''}${fixed ? 'A fix to check' : 'Phix needs you'}: ${where}`;
  const body = [
    fixed ? `Phix has fixed a report about ${where}.` : `Phix couldn't fix a report about ${where} by itself.`,
    '',
    'What the visitor said:',
    r.what_happened,
    '',
    fixed ? 'What Phix understood:' : 'Why Phix stopped:',
    r.understood,
    ...(fixed ? ['', 'What Phix changed:', r.did] : []),
    '',
    fixed ? 'See the fixed page on a preview copy, then publish or reject it:' : 'Tell Phix what to do, or leave the page as it is:',
    link.href,
    '',
    `The link works once and expires on ${dateText(link.expires)}.`,
    '',
    'Phix',
  ].join('\n');
  await mailOwner(env, subject, body);
}

// ---- The owner's page ------------------------------------------------------------------------

async function findLink(env, key) {
  const l = await env.DB.prepare('SELECT * FROM owner_links WHERE hash = ?').bind(await sha256(key)).first();
  if (!l) return {};
  const r = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(l.report_id).first();
  return { l, r };
}

const DECIDED = {
  published: 'You published this fix',
  retry: 'You sent this fix back to Phix to try again',
  left: 'You decided to leave the page as it is',
};

function visitorSaid(r) {
  const out = [`<h2 id="the-report">What the visitor said</h2>`, paras(r.what_happened)];
  if (r.expected) out.push('<h3>What they expected</h3>', paras(r.expected));
  if (r.reading) out.push('<h3>How they were reading the page</h3>', `<p>${esc(r.reading.split(',').map(k => READING_TEXT[k] || k).join(', '))}</p>`);
  if (r.setup) out.push('<h3>Their setup</h3>', paras(r.setup));
  if (r.user_agent) out.push('<h3>Their browser</h3>', `<p>${esc(r.user_agent)}</p>`);
  if (r.reporter_notes) out.push('<h3>What they told us since</h3>', paras(r.reporter_notes));
  return out.join('\n');
}

function reasonForm(key, v = {}, error = '') {
  return `${error ? `<div class="error" role="alert"><h2 class="error-title">There's a problem</h2><p>${esc(error)}</p></div>\n` : ''}<form class="fix-form" method="post" action="/fix/owner/${key}/">
<input type="hidden" name="decision" value="reasons">
<div class="field">
<label for="reason">Why are you rejecting this fix?</label>
<p class="hint" id="reason-hint">Say what's wrong with it, or what you'd like instead.</p>
<textarea id="reason" name="reason" rows="6" required maxlength="${LIMITS.what}" aria-describedby="reason-hint" autofocus>${esc(v.reason)}</textarea>
</div>
<fieldset class="field">
<legend>What happens next?</legend>
<ul class="choices">
<li><input type="radio" id="next-retry" name="next" value="retry"${v.next === 'leave' ? '' : ' checked'}> <label for="next-retry">Phix tries again, using your reasons</label></li>
<li><input type="radio" id="next-leave" name="next" value="leave"${v.next === 'leave' ? ' checked' : ''}> <label for="next-leave">Leave the page as it is. Your reasons are shown to the visitor who reported it.</label></li>
</ul>
</fieldset>
<p><button type="submit">Reject with these reasons</button></p>
</form>
<p><a href="/fix/owner/${key}/">Go back</a></p>`;
}

function ownerView(key, l, r) {
  const where = short(r.page);
  const fixed = r.phix === 'owner' && r.pr_url;
  const out = [];
  out.push(fixed
    ? `<p class="lede">Phix has fixed a report about ${esc(where)}.</p>`
    : `<p class="lede">Phix couldn't fix a report about ${esc(where)} by itself.</p>`);
  out.push(visitorSaid(r));
  out.push(`<h2 id="what-phix-did">${fixed ? 'What Phix did' : 'Why Phix stopped'}</h2>`);
  if (fixed) out.push('<h3>What Phix understood</h3>', paras(r.understood), '<h3>What Phix changed</h3>', paras(r.did));
  else out.push(paras(r.understood || 'Phix gave no reason.'));
  if (fixed) {
    out.push(`<h2 id="see-it">See it</h2>
<ul>
<li><a href="${esc(r.preview_url)}">The fixed page, on a preview copy</a></li>
<li><a href="${esc(r.pr_url)}">The change, on GitHub</a></li>
</ul>
<p>Try it the way the visitor described. Nothing goes live until you publish it.</p>
<h2 id="decide">Publish or reject</h2>
<form class="fix-form" method="post" action="/fix/owner/${key}/">
<input type="hidden" name="decision" value="publish">
<p><button type="submit">Publish</button></p>
</form>
<p>Publishing puts the fix live, usually within two minutes. Phix then asks the visitor whether it works for them.</p>
<form class="fix-form" method="post" action="/fix/owner/${key}/">
<input type="hidden" name="decision" value="reject">
<p><button type="submit">Reject</button></p>
</form>
<p>Rejecting asks for your reasons before anything happens.</p>`);
  } else {
    out.push('<h2 id="decide">What should happen?</h2>', reasonForm(key).replace('Why are you rejecting this fix?', 'What should Phix know?').replace('Reject with these reasons', 'Send'));
  }
  out.push(`<p>This link works once and expires on ${dateText(l.expires_at)}.</p>`);
  return out.join('\n');
}

export async function ownerPage(request, env, key) {
  const t = await template(env, request, '/fix/owner/');
  const page = (body, status = 200, title = '') => html(t.replace('<title>', `<title>${title}`).replace('{{OWNER}}', body), status, PRIVATE);
  const { l, r } = await findLink(env, key);
  if (!l || !r) return page('<p class="lede">There\'s no link like this.</p>\n<p>Check the link is complete. If it came in an email, use the newest one: each new email replaces the links before it.</p>', 404, 'Not found: ');
  if (l.used_at) return page(`<p class="lede">${DECIDED[l.decision] || 'This link has been used'}, on ${dateText(l.used_at)}.</p>\n<p>Each link decides once.${l.decision === 'published' && pageUrl(r.page) ? ` <a href="${esc(r.page)}">See the page</a>` : ''}</p>`);
  if (l.expires_at < now()) return page('<p class="lede">This link has expired.</p>\n<p>Phix sends a new link at its next wake-up, at 6 in the morning or midday.</p>', 410, 'Expired: ');

  if (request.method !== 'POST') return page(ownerView(key, l, r));

  const form = await request.formData();
  const decision = String(form.get('decision') || '');
  const fixed = r.phix === 'owner' && r.pr_url;

  if (decision === 'reject') return page(`<p class="lede">Reject this fix.</p>\n${reasonForm(key)}`, 200, 'Reject: ');

  if (decision === 'publish' && fixed) {
    const [, repo, n] = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(r.pr_url);
    // Publish merges the commit Phix handed in (fix_ref), the one the preview copy was made from.
    // If anything has been added to the branch since, GitHub refuses with 409 and nothing goes live.
    const pinned = /^[0-9a-f]{40}$/.test(r.fix_ref || '') ? { sha: r.fix_ref } : {};
    const res = await github(env, 'PUT', `/repos/${repo}/pulls/${n}/merge`, { merge_method: 'merge', commit_title: `Phix: fix report ${r.id} (${short(r.page)})`, ...pinned });
    if (res.status === 409 && pinned.sha) {
      console.error('Phix: the branch changed after the fix was handed in', await res.text());
      return page(`<div class="error" role="alert"><h2 class="error-title">It didn't publish</h2><p>The change was altered after Phix handed it in, so it isn't the fix you were shown. Nothing went live. Reject it and ask Phix to try again: that sends you a fresh fix to check.</p></div>\n${ownerView(key, l, r)}`, 409, 'Error: ');
    }
    if (!res.ok) {
      console.error('Phix: merge failed', res.status, await res.text());
      return page(`<div class="error" role="alert"><h2 class="error-title">It didn't publish</h2><p>GitHub wouldn't merge the change (error ${res.status}). Nothing went live. Try again in a minute, or open <a href="${esc(r.pr_url)}">the change on GitHub</a>.</p></div>\n${ownerView(key, l, r)}`, 502, 'Error: ');
    }
    await env.DB.batch([
      env.DB.prepare(`UPDATE reports SET status = 'fixed', fixed_at = ?, phix = 'done', phix_at = ?, confirmed_by = NULL, confirmed_at = NULL WHERE id = ?`).bind(now(), now(), r.id),
      env.DB.prepare(`UPDATE owner_links SET used_at = ?, decision = 'published' WHERE hash = ?`).bind(now(), l.hash),
    ]);
    await step(env, r.id, 'owner', 'The owner checked the fix and published it.');
    return page(`<p class="lede">Published.</p>\n<p>The fix will be live within a couple of minutes. Phix will ask the visitor whether it works for them.</p>${pageUrl(r.page) ? `\n<p><a href="${esc(r.page)}">See the page</a></p>` : ''}`, 200, 'Published: ');
  }

  if (decision === 'reasons') {
    const v = { reason: text(form.get('reason'), LIMITS.what), next: form.get('next') === 'leave' ? 'leave' : 'retry' };
    if (!v.reason) return page(`<p class="lede">${fixed ? 'Reject this fix.' : 'Tell Phix what to do.'}</p>\n${reasonForm(key, v, 'Please give your reasons.')}`, 400, 'Error: ');
    if (v.next === 'retry') {
      await env.DB.batch([
        env.DB.prepare(`UPDATE reports SET phix = 'retry', phix_at = ?, owner_reason = ?, tries = CASE WHEN phix = 'stuck' THEN 0 ELSE tries END WHERE id = ?`).bind(now(), v.reason, r.id),
        env.DB.prepare(`UPDATE owner_links SET used_at = ?, decision = 'retry' WHERE hash = ?`).bind(now(), l.hash),
      ]);
      await step(env, r.id, 'owner', fixed ? 'The owner looked at Phix\'s fix and asked it to try again.' : 'The owner told Phix how to go on.');
      return page(`<p class="lede">Sent back to Phix.</p>\n<p>Phix tries again at its next wake-up, ${nextWake()}, with your reasons. You'll get an email when there's a new fix to check.</p>`, 200, 'Sent back: ');
    }
    if (fixed) {
      const [, repo, n] = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(r.pr_url);
      await github(env, 'PATCH', `/repos/${repo}/pulls/${n}`, { state: 'closed' });
    }
    await env.DB.batch([
      env.DB.prepare(`UPDATE reports SET status = 'wont-fix', phix = 'done', phix_at = ?, did = ? WHERE id = ?`).bind(now(), v.reason, r.id),
      env.DB.prepare(`UPDATE owner_links SET used_at = ?, decision = 'left' WHERE hash = ?`).bind(now(), l.hash),
    ]);
    await step(env, r.id, 'owner', 'The owner decided to leave the page as it is.');
    return page('<p class="lede">The page stays as it is.</p>\n<p>The visitor can see your reasons on their report\'s page, and the report is closed.</p>', 200, 'Left as it is: ');
  }

  return page(ownerView(key, l, r));
}

// ---- On the reporter's page ------------------------------------------------------------------

// Where an open report is with Phix, in words for the person who reported it.
export function phixLine(r) {
  switch (r.phix) {
    case 'working': return '<p>Phix (said "fix"), the agent that works on reports, has it now.</p>';
    case 'owner': return '<p>Phix (said "fix"), the agent that works on reports, has made a fix. It is waiting for the site\'s owner to check it and publish it.</p>';
    case 'retry': return `<p>Phix (said "fix"), the agent that works on reports, will try again ${nextWake()}.</p>`;
    case 'stuck': return '<p>Phix (said "fix"), the agent that works on reports, couldn\'t fix it by itself, so it is with the site\'s owner.</p>';
    default: return `<p>Phix (said "fix"), the agent that works on reports, looks at new reports at 6 in the morning and at midday. It will start on yours ${nextWake()}.</p>`;
  }
}
