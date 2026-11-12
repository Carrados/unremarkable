// Cloud Dancer: the agent who gets every request first, sorts it, and does the fabric herself.
//
// Every request an owner makes goes to Cloud Dancer. She decides which kind of change it is:
//   flow     a news item, a post, a catalogue entry, in a shape the site's FLOW.md already has.
//            She hands it to Flo (flo.js), who puts it live, because the owner asking is the approval.
//   fabric   the layout, sections, menus, pages, design or standing wording, or a new shape of flow.
//            She does it herself, on a new branch, and puts it on a private preview copy. The owner is
//            emailed the preview link and decides: publish, or send it back. Nothing goes live until
//            they say so. Cloud Dancer never merges her own work: publish (mcp.js) does, on the owner's word.
//
// She runs as a GitHub Actions run in Carrados/unremarkable (.github/workflows/dancer.yml), woken through the
// door in the site Worker (fix/door.js) the moment a request comes in, and proves who she is with the run's
// own GitHub identity token (OIDC), as Flo does. Her rules are dancer/DANCER.md. The agent holds no Cloudflare
// key: a second job in the same run, with no model in it (dancer/preview.mjs), uploads the preview copy and
// calls `ready`. Her API, at /dancer/api/:
//
//   claim    up to three requests to sort (new ones, and fabric the owner sent back), marked as hers
//   step     one sentence on what is happening, for the owner
//   flow     it is flow: handed to Flo
//   ready    the fabric change is on a branch, a pull request and a preview copy: the owner is emailed the link
//            (called by the preview job, not by the agent)
//   stuck    she can't do it by herself: the owner is told why

import { SITES, previewUrl, PREVIEW_DOMAIN } from './sites.js';
import { DANCER_WORKFLOW, whoIs, github, checkPull, wakeFlo, addStep, tell, now, text, json } from './flo.js';

const PER_RUN = 3;
const STALE_HOURS = 3;
const FROM = 'Cloud Dancer';

export async function dancerApi(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const wrong = await whoIs(request, DANCER_WORKFLOW).catch(e => `could not check: ${e.message}`);
  if (wrong) { console.error('Cloud Dancer API refused:', wrong); return json({ error: 'Not authorised.' }, 401); }
  const action = new URL(request.url).pathname.replace(/^\/dancer\/api\//, '').replace(/\/$/, '');
  let b = {};
  try { b = await request.json(); } catch { /* an empty body is fine for claim */ }
  return dancerAct(action, b, env);
}

// Cloud Dancer's requests are everything that isn't flow: new ones not yet sorted, and fabric.
const HERS = `(kind IS NULL OR kind = 'fabric')`;

export async function dancerAct(action, b, env) {
  if (action === 'claim') {
    await env.DB.prepare(`UPDATE requests SET status = 'retry', status_at = ? WHERE status = 'working' AND ${HERS} AND status_at < ?`)
      .bind(now(), new Date(Date.now() - STALE_HOURS * 3600000).toISOString().replace(/\.\d+Z$/, 'Z')).run();
    const { results } = await env.DB.prepare(`SELECT * FROM requests WHERE status IN ('queued', 'retry') AND ${HERS} ORDER BY id LIMIT ${PER_RUN}`).all();
    const work = [];
    for (const r of results) {
      if (!SITES[r.site]) continue;
      await env.DB.prepare(`UPDATE requests SET status = 'working', status_at = ?, tries = tries + 1 WHERE id = ? AND status IN ('queued', 'retry') AND ${HERS}`).bind(now(), r.id).run();
      work.push({
        id: r.id, site: r.site, repo: SITES[r.site].repo, page: r.page, instruction: r.instruction,
        // Set when Flo found a request was fabric after all: it is fabric, and this is what she said.
        sorted: r.kind === 'fabric' ? { kind: 'fabric', said: r.understood || null } : null,
        owner_reason: r.owner_reason || null, previous_branch: r.branch || null, try: r.tries + 1,
      });
    }
    return json({ work });
  }

  const r = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(Number(b.id) || 0).first();
  if (!r) return json({ error: 'No request with that id.' }, 404);
  if (r.status !== 'working' || r.kind === 'flow') return json({ error: `Request ${r.id} isn't yours to work on: it is ${r.kind === 'flow' ? 'flow, so it is Flo\'s' : r.status}.` }, 409);

  if (action === 'step') {
    const t = text(b.text, 500);
    if (!t) return json({ error: 'Say what happened, in one sentence for the owner.' }, 400);
    await addStep(env, r.id, t, 'dancer');
    return json({ ok: true });
  }

  if (action === 'flow') {
    if (r.kind === 'fabric') return json({ error: `Request ${r.id} came back from Flo as design work. Do it on a preview copy, or call stuck.` }, 409);
    const reason = text(b.reason, 2000);
    if (!reason) return json({ error: 'Say in a sentence what kind of flow it is.' }, 400);
    await env.DB.prepare(`UPDATE requests SET status = 'flow', status_at = ?, kind = 'flow', understood = ?, tries = 0 WHERE id = ?`).bind(now(), reason, r.id).run();
    await addStep(env, r.id, 'Cloud Dancer sorted this as flow and handed it to Flo.', 'dancer');
    await wakeFlo(env);
    return json({ ok: true });
  }

  if (action === 'ready') {
    const understood = text(b.understood, 2000), did = text(b.did, 3000), wrote = text(b.wrote, 3000) || null;
    const repo = SITES[r.site].repo;
    const pr = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)$/.exec(text(b.pr_url, 300));
    const preview = previewUrl(b.preview_url);
    if (!understood || !did) return json({ error: 'Give both understood and did.' }, 400);
    if (!pr || pr[1] !== repo) return json({ error: `pr_url must be a pull request on ${repo}.` }, 400);
    if (!preview) return json({ error: `preview_url must be the https address of the preview copy, on ${PREVIEW_DOMAIN}: the address wrangler printed.` }, 400);
    const res = await github(env, 'GET', `/repos/${repo}/pulls/${pr[2]}`);
    if (!res.ok) return json({ error: `GitHub wouldn't show that pull request (error ${res.status}).` }, 502);
    const pull = await res.json();
    const bad = checkPull(pull, repo, r.id, 'dancer');
    if (bad) return json({ error: bad }, 400);
    // Publish merges this commit and nothing pushed after it: what the owner saw on the preview is what goes live.
    await env.DB.prepare(
      `UPDATE requests SET status = 'ready', status_at = ?, kind = 'fabric', understood = ?, did = ?, wrote = ?, branch = ?, pr_url = ?, preview_url = ?, commit_sha = ? WHERE id = ?`
    ).bind(now(), understood, did, wrote, pull.head.ref, pr[0], preview.href, pull.head.sha, r.id).run();
    await addStep(env, r.id, 'The change is ready on a private preview copy, for you to check. Nothing is live yet.', 'dancer');
    await tell(env, r, `Ready for you to check: request ${r.id}`, [
      `This is design work, so it is not live. It is on a private preview copy for you to check first.`,
      '', `What I understood: ${understood}`, '', `What I changed: ${did}`,
      ...(wrote ? ['', `What I wrote myself, for you to check:\n${wrote}`] : []),
      '', `The preview copy: ${preview.href}`,
      '', `To put it live, tell your agent to publish request ${r.id}. To change it, or to leave the site as it is, tell your agent to send request ${r.id} back, with your reasons.`,
    ].join('\n'), FROM);
    return json({ ok: true, preview: preview.href, commit: pull.head.sha });
  }

  if (action === 'stuck') {
    const reason = text(b.reason, 2000);
    if (!reason) return json({ error: 'Give the reason, in words for the owner.' }, 400);
    await env.DB.prepare(`UPDATE requests SET status = 'stuck', status_at = ?, understood = ? WHERE id = ?`).bind(now(), reason, r.id).run();
    await addStep(env, r.id, 'Cloud Dancer stopped and needs you.', 'dancer');
    await tell(env, r, 'Cloud Dancer needs you', reason, FROM);
    return json({ ok: true });
  }

  return json({ error: `Cloud Dancer's API has no ${action}. Use claim, step, flow, ready or stuck.` }, 404);
}
