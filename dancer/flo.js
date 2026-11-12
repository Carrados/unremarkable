// Flo (Florence): the agent who does flow on the owner's sites.
//
// Every request goes to Cloud Dancer first (fabric.js), who sorts it. Flow is handed to Flo; fabric Cloud
// Dancer does herself, on a private preview copy, and the owner decides whether to publish it.
//
// Flow is what an owner adds or changes often, each piece on its own: a news item, a blog post, a product in
// a catalogue. Fabric is the rest: layout, sections, design and the standing wording. A new kind of flow (a site
// that had news now wanting events) is fabric too: adding a shape is design work, filling one is not.
//
// Flow goes live as soon as Flo has done it and her checks pass. The owner asking is the approval, as it is
// for Charlotte Joanne on blind-ant.com, and the safety comes afterwards: "take it down" or "change that line"
// are just more flow. Fabric is never Flo's: if something reaches her that is really fabric, she hands it back
// to Cloud Dancer, who does it on a preview copy for the owner to decide on.
//
// Flo runs as a GitHub Actions run in Carrados/unremarkable (.github/workflows/flo.yml), woken through the
// door in the site Worker (fix/door.js) the moment Cloud Dancer hands her a request. She proves who she is with the run's
// own GitHub identity token (OIDC), so there is no shared secret to keep or leak. Her API, at /flo/api/:
//
//   claim    up to three flow requests to work on, marked as hers
//   step     one sentence on what is happening, for the owner
//   posted   she has put it on a branch with a pull request; Cloud Dancer checks it with GitHub and merges it
//   fabric   it is design work after all, not flow: it goes back to Cloud Dancer to do on a preview copy
//   stuck    she can't do it by herself: the owner is told why

import { SITES } from './sites.js';

export const AUDIENCE = 'https://dancer.unremarkable.me';
export const FLO_WORKFLOW = 'Carrados/unremarkable/.github/workflows/flo.yml@refs/heads/main';
export const DANCER_WORKFLOW = 'Carrados/unremarkable/.github/workflows/dancer.yml@refs/heads/main';
const ISSUER = 'https://token.actions.githubusercontent.com';
const PER_RUN = 3;
const STALE_HOURS = 2;

export const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
export const text = (v, n) => String(v ?? '').trim().slice(0, n);
export const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
});

// ---- Who is calling: a GitHub Actions identity token for Flo's (or Cloud Dancer's) own workflow on main ---

const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
const decode = s => JSON.parse(new TextDecoder().decode(b64(s)));

// What the token says must be true. Returns what's wrong, or '' when it's the run named by `workflow`.
// Exported for the tests.
export function checkClaims(c, at = Date.now() / 1000, workflow = FLO_WORKFLOW) {
  if (!c || c.iss !== ISSUER) return 'not a GitHub Actions token';
  if ((Array.isArray(c.aud) ? !c.aud.includes(AUDIENCE) : c.aud !== AUDIENCE)) return 'meant for someone else';
  if (!(c.exp > at) || (c.nbf && c.nbf > at + 60)) return 'out of date';
  if (c.repository !== 'Carrados/unremarkable') return 'from another repository';
  if (c.job_workflow_ref !== workflow) return 'from another workflow, or not from main';
  return '';
}

let keys = null, keysAt = 0;
async function key(kid) {
  if (!keys || Date.now() - keysAt > 3600000 || !keys.find(k => k.kid === kid)) {
    const res = await fetch(`${ISSUER}/.well-known/jwks`);
    if (!res.ok) throw new Error(`GitHub's keys: ${res.status}`);
    keys = (await res.json()).keys; keysAt = Date.now();
  }
  const k = keys.find(x => x.kid === kid);
  return k ? crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) : null;
}

export async function whoIs(request, workflow = FLO_WORKFLOW) {
  const m = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return 'no token';
  let head, claims;
  try { head = decode(m[1]); claims = decode(m[2]); } catch { return 'unreadable token'; }
  if (head.alg !== 'RS256') return 'wrong kind of token';
  const k = await key(head.kid);
  if (!k) return 'unknown key';
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, b64(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  if (!ok) return 'bad signature';
  return checkClaims(claims, Date.now() / 1000, workflow);
}

// ---- GitHub, through the site Worker's door ---------------------------------------------------------

// `env.SITE` is the service binding to the unremarkable Worker's Dancer entrypoint (fix/door.js).
// Without it (tests, a laptop) this falls back to a direct call with GITHUB_TOKEN.
export async function github(env, method, path, body) {
  if (env.SITE) {
    const r = await env.SITE.github(method, path, body);
    return new Response(r.body, { status: r.status });
  }
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cloud-dancer',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Wake an agent now: 'flo-wake' for Flo, 'dancer-wake' for Cloud Dancer. A failed wake is logged, not
// thrown: the request is kept and the next wake finds it.
async function wake(env, event_type, who) {
  try {
    const res = await github(env, 'POST', `/repos/${SITES['unremarkable.me'].repo}/dispatches`, { event_type });
    if (!res.ok) console.error(`${who}: GitHub would not start the run`, res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error(`${who}: could not wake`, e?.message || e);
    return false;
  }
}
export const wakeFlo = env => wake(env, 'flo-wake', 'Flo');
export const wakeDancer = env => wake(env, 'dancer-wake', 'Cloud Dancer');

// What an agent hands in is checked here, not taken on trust: the pull request must be open, from its own
// branch for this request (flo/request-<id>, or dancer/request-<id> for Cloud Dancer), in the site's own repo
// (never a fork), into its main branch. Returns what's wrong, or ''.
export function checkPull(pr, repo, id, prefix = 'flo') {
  const want = `${prefix}/request-${id}`;
  if (!pr || !pr.head || !pr.base) return 'GitHub has no pull request at pr_url.';
  if (pr.state !== 'open') return `That pull request is ${pr.merged ? 'already merged' : 'closed'}. Open a new one from ${want}.`;
  if (pr.base.repo?.full_name !== repo) return `That pull request isn't on ${repo}.`;
  if (pr.head.repo?.full_name !== repo) return `That pull request comes from another repo. The branch must be in ${repo} itself.`;
  if (pr.head.ref !== want) return `That pull request is from ${pr.head.ref}. Request ${id} must be on ${want}.`;
  if (pr.base.ref !== pr.base.repo.default_branch) return `That pull request goes into ${pr.base.ref}. It must go into ${pr.base.repo.default_branch}.`;
  if (!/^[0-9a-f]{40}$/.test(pr.head.sha || '')) return 'GitHub gave no commit for that pull request.';
  return '';
}

// A live address on the request's own site, or null.
export function liveOn(site, raw) {
  try {
    const u = new URL(text(raw, 500));
    return u.protocol === 'https:' && u.hostname.replace(/^www\./, '') === site ? u : null;
  } catch { return null; }
}

export async function addStep(env, id, text_, who = 'flo') {
  await env.DB.prepare('INSERT INTO steps (request_id, who, text) VALUES (?, ?, ?)').bind(id, who, text(text_, 500)).run();
}

// One short email to the owner who asked, so they hear without having to ask their agent.
export async function tell(env, r, subject, body, from = 'Flo, at Cloud Dancer') {
  if (!env.OWNER_MAIL) { console.log(`[email to ${r.owner}] ${subject}\n${body}`); return; }
  try {
    await env.OWNER_MAIL.send({ to: r.owner, from: env.DANCER_FROM || 'dancer@unremarkable.me', subject, text: `${body}\n\nRequest ${r.id}, about ${r.site}. Ask your agent where request ${r.id} stands for the whole story.\n\n${from}\n` });
  } catch (e) { console.error(`${from}: the email to the owner failed`, e?.message || e); }
}

// ---- The API ---------------------------------------------------------------------------------------

export async function floApi(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const wrong = await whoIs(request).catch(e => `could not check: ${e.message}`);
  if (wrong) { console.error('Flo API refused:', wrong); return json({ error: 'Not authorised.' }, 401); }
  const action = new URL(request.url).pathname.replace(/^\/flo\/api\//, '').replace(/\/$/, '');
  let b = {};
  try { b = await request.json(); } catch { /* an empty body is fine for claim */ }
  return act(action, b, env);
}

export async function act(action, b, env) {
  // Flo only ever claims flow: what Cloud Dancer has sorted and handed to her ('flow'), or a flow request the
  // owner sent back to be done again.
  if (action === 'claim') {
    await env.DB.prepare(`UPDATE requests SET status = 'retry', status_at = ? WHERE status = 'working' AND kind = 'flow' AND status_at < ?`)
      .bind(now(), new Date(Date.now() - STALE_HOURS * 3600000).toISOString().replace(/\.\d+Z$/, 'Z')).run();
    const { results } = await env.DB.prepare(`SELECT * FROM requests WHERE kind = 'flow' AND status IN ('flow', 'retry') ORDER BY id LIMIT ${PER_RUN}`).all();
    const work = [];
    for (const r of results) {
      if (!SITES[r.site]) continue;
      await env.DB.prepare(`UPDATE requests SET status = 'working', status_at = ?, tries = tries + 1 WHERE id = ? AND kind = 'flow' AND status IN ('flow', 'retry')`).bind(now(), r.id).run();
      work.push({ id: r.id, site: r.site, repo: SITES[r.site].repo, page: r.page, instruction: r.instruction, owner_reason: r.owner_reason || null, previous_branch: r.branch || null, try: r.tries + 1 });
    }
    return json({ work });
  }

  const r = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(Number(b.id) || 0).first();
  if (!r) return json({ error: 'No request with that id.' }, 404);
  if (r.status !== 'working' || r.kind !== 'flow') return json({ error: `Request ${r.id} isn't yours to work on: it is ${r.kind === 'flow' ? r.status : 'not flow'}.` }, 409);

  if (action === 'step') {
    const t = text(b.text, 500);
    if (!t) return json({ error: 'Say what happened, in one sentence for the owner.' }, 400);
    await addStep(env, r.id, t);
    return json({ ok: true });
  }

  if (action === 'posted') {
    const understood = text(b.understood, 2000), did = text(b.did, 3000), wrote = text(b.wrote, 3000) || null;
    const repo = SITES[r.site].repo;
    const pr = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)$/.exec(text(b.pr_url, 300));
    const live = liveOn(r.site, b.live_url);
    if (!understood || !did) return json({ error: 'Give both understood and did.' }, 400);
    if (!pr || pr[1] !== repo) return json({ error: `pr_url must be a pull request on ${repo}.` }, 400);
    if (!live) return json({ error: `live_url must be the https address on ${r.site} where it will be.` }, 400);
    const res = await github(env, 'GET', `/repos/${repo}/pulls/${pr[2]}`);
    if (!res.ok) return json({ error: `GitHub wouldn't show that pull request (error ${res.status}).` }, 502);
    const pull = await res.json();
    const bad = checkPull(pull, repo, r.id);
    if (bad) return json({ error: bad }, 400);
    // Merge exactly the commit that was checked. Merging publishes (Cloudflare Workers Builds).
    const m = await github(env, 'PUT', `/repos/${repo}/pulls/${pr[2]}/merge`, { merge_method: 'merge', commit_title: `Flo: request ${r.id} (${r.site})`, sha: pull.head.sha });
    if (!m.ok) {
      const why = await m.text();
      console.error('Flo: merge failed', m.status, why);
      return json({ error: m.status === 409 ? 'The branch changed after you checked it. Push nothing more, then call posted again.' : `GitHub wouldn't merge (error ${m.status}). Nothing went live.` }, 502);
    }
    await env.DB.prepare(
      `UPDATE requests SET status = 'published', status_at = ?, kind = 'flow', understood = ?, did = ?, wrote = ?, branch = ?, pr_url = ?, commit_sha = ?, live_url = ? WHERE id = ?`
    ).bind(now(), understood, did, wrote, pull.head.ref, pr[0], pull.head.sha, live.href, r.id).run();
    await addStep(env, r.id, `Posted it. It will be live at ${live.href} within a couple of minutes.`);
    await tell(env, r, `Posted: ${understood.slice(0, 80)}`, `${did}\n\nIt will be live at ${live.href} within a couple of minutes.${wrote ? `\n\nWhat I wrote myself, for you to check:\n${wrote}` : ''}\n\nTo take it down or change it, just ask.`);
    return json({ ok: true, merged: pull.head.sha });
  }

  // Fabric after all: back to Cloud Dancer, who does it on a preview copy. The owner hears when it is ready.
  if (action === 'fabric') {
    const reason = text(b.reason, 2000);
    if (!reason) return json({ error: 'Give the reason, in words for the owner.' }, 400);
    await env.DB.prepare(`UPDATE requests SET status = 'queued', status_at = ?, kind = 'fabric', understood = ?, tries = 0 WHERE id = ?`).bind(now(), reason, r.id).run();
    await addStep(env, r.id, 'Flo found this is design work, so it went back to Cloud Dancer to do on a preview copy.');
    await wakeDancer(env);
    return json({ ok: true });
  }

  if (action === 'stuck') {
    const reason = text(b.reason, 2000);
    if (!reason) return json({ error: 'Give the reason, in words for the owner.' }, 400);
    await env.DB.prepare(`UPDATE requests SET status = 'stuck', status_at = ?, understood = ? WHERE id = ?`).bind(now(), reason, r.id).run();
    await addStep(env, r.id, 'Flo stopped and needs you.');
    await tell(env, r, 'Flo needs you', reason);
    return json({ ok: true });
  }

  return json({ error: `Flo's API has no ${action}.` }, 404);
}
