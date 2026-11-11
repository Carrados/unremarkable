// Cloud Dancer's own way into the in-tray: /agent/next, /agent/get, /agent/step, /agent/ready, /agent/stuck.
// Only the run in .github/workflows/dancer.yml calls these, with DANCER_SECRET as a bearer token.
//
// The model never holds that secret, a GitHub token or a Cloudflare token. It works in a job that has none of
// them, and leaves a patch. A second job, a fixed script with no model in it (run.mjs), checks the patch, pushes
// it, makes the preview copy and calls `ready`. And `ready` takes nothing on trust: it asks GitHub what the pull
// request is, which files it changes, and keeps the commit, so Publish merges exactly what was previewed.

import { SITES, previewUrl, outsideFence, branchFor } from './sites.js';
import { github, wake, dry } from './github.js';

const MAX_TRIES = 3;        // tries at one request before it goes to the owner as stuck
const STALE_MINUTES = 60;   // a request left "working" this long goes back in the in-tray

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function allowed(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.DANCER_SECRET || !given) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(env.DANCER_SECRET)]);
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function addStep(env, id, text) {
  await env.DB.prepare('INSERT INTO steps (request_id, who, text) VALUES (?, ?, ?)').bind(id, 'dancer', clip(text, 500)).run();
}

// A short note to the owner that something is waiting for them. What changed is told by their agent, not by email.
async function tell(env, r, subject, lines) {
  const text = [...lines, '', 'Cloud Dancer', 'The publishing agent at Unremarkable'].join('\n');
  if (dry(env) || !env.OWNER_MAIL) { console.log(`[email to owner] ${subject}`); return; }
  try {
    await env.OWNER_MAIL.send({ to: r.owner, from: env.DANCER_FROM || 'dancer@unremarkable.me', subject, text });
  } catch (e) {
    console.error('Cloud Dancer: the email to the owner failed', e?.message || e);
  }
}

// What the pull request must be: open, from this request's own branch in the site's own repo (never a fork),
// into the main branch. Returns what's wrong, in plain words, or '' when it's fine.
export function checkPull(pr, repo, id) {
  const want = branchFor(id);
  if (!pr || !pr.head || !pr.base) return 'GitHub has no pull request at pr_url.';
  if (pr.state !== 'open') return `That pull request is ${pr.merged ? 'already merged' : 'closed'}.`;
  if (pr.base.repo?.full_name !== repo) return `That pull request isn't on ${repo}.`;
  if (pr.head.repo?.full_name !== repo) return `That pull request comes from another repo (${pr.head.repo?.full_name || 'unknown'}).`;
  if (pr.head.ref !== want) return `That pull request is from the branch ${pr.head.ref}. Request ${id} must be on ${want}.`;
  if (pr.base.ref !== pr.base.repo.default_branch) return `That pull request goes into ${pr.base.ref}, not ${pr.base.repo.default_branch}.`;
  if (!/^[0-9a-f]{40}$/.test(pr.head.sha || '')) return 'GitHub gave no commit for that pull request.';
  return '';
}

const reposOf = repo => Object.keys(SITES).filter(s => SITES[s].repo === repo);

// What the run is given about a request. Never the owner's email address: the run doesn't need it.
function forRun(r) {
  const s = SITES[r.site];
  return {
    id: r.id, site: r.site, page: r.page, instruction: r.instruction, tries: r.tries,
    owner_reason: r.owner_reason || null,
    previous: r.did || r.understood ? { understood: r.understood, did: r.did, wrote: r.wrote } : null,
    branch: branchFor(r.id), paths: s.paths, built: s.built, build: s.build, worker: s.worker,
  };
}

async function working(env, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const r = await env.DB.prepare(`SELECT * FROM requests WHERE id = ? AND status = 'working'`).bind(n).first();
  return r && SITES[r.site] ? r : null;
}

async function wakeIfMore(env, repo) {
  const sites = reposOf(repo);
  const marks = sites.map(() => '?').join(', ');
  const more = await env.DB.prepare(`SELECT COUNT(*) AS n FROM requests WHERE status IN ('queued', 'retry') AND site IN (${marks})`).bind(...sites).first('n');
  if (more > 0) await wake(env, repo);
}

export async function agentApi(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);
  if (!(await allowed(request, env))) return json({ error: 'Not allowed.' }, 401);
  const action = new URL(request.url).pathname.replace(/^\/agent\//, '').replace(/\/$/, '');
  let b = {};
  try { b = await request.json(); } catch { /* an empty body is fine */ }

  if (action === 'next') {
    const sites = reposOf(clip(b.repo, 200));
    if (!sites.length) return json({ error: 'No site of Cloud Dancer\'s lives in that repo.' }, 400);
    const marks = sites.map(() => '?').join(', ');
    // A request a run took and never finished goes back in the in-tray.
    const stale = new Date(Date.now() - STALE_MINUTES * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
    await env.DB.prepare(`UPDATE requests SET status = 'queued' WHERE status = 'working' AND status_at < ?`).bind(stale).run();
    for (let i = 0; i < 5; i++) {
      const next = await env.DB.prepare(`SELECT id, tries FROM requests WHERE status IN ('queued', 'retry') AND site IN (${marks}) ORDER BY id LIMIT 1`).bind(...sites).first();
      if (!next) return json({ request: null });
      if (next.tries >= MAX_TRIES) {
        await env.DB.prepare(`UPDATE requests SET status = 'stuck', status_at = ?, understood = ? WHERE id = ? AND status IN ('queued', 'retry')`)
          .bind(now(), `Cloud Dancer has tried this ${next.tries} times without finishing. It needs you, or Unremarkable, to look at it.`, next.id).run();
        continue;
      }
      // Claim it only if nobody else just did.
      const r = await env.DB.prepare(`UPDATE requests SET status = 'working', status_at = ?, tries = tries + 1 WHERE id = ? AND status IN ('queued', 'retry') RETURNING *`).bind(now(), next.id).first();
      if (!r) continue;
      await addStep(env, r.id, r.tries > 1 ? 'Cloud Dancer started again.' : 'Cloud Dancer started work.');
      return json({ request: forRun(r) });
    }
    return json({ request: null });
  }

  const r = await working(env, b.id);
  if (!r) return json({ error: 'No request with that number is being worked on.' }, 404);
  const repo = SITES[r.site].repo;

  if (action === 'get') return json({ request: forRun(r) });

  if (action === 'step') {
    const text = clip(b.text, 500);
    if (!text) return json({ error: 'Give the step\'s text.' }, 400);
    await addStep(env, r.id, text);
    return json({ ok: true });
  }

  if (action === 'stuck') {
    const reason = clip(b.reason, 3000);
    if (!reason) return json({ error: 'Give the reason.' }, 400);
    await env.DB.prepare(`UPDATE requests SET status = 'stuck', status_at = ?, understood = ? WHERE id = ?`).bind(now(), reason, r.id).run();
    await addStep(env, r.id, 'Cloud Dancer stopped and needs you.');
    await tell(env, r, `Cloud Dancer needs you: request ${r.id}`, [`Cloud Dancer couldn't finish request ${r.id}, about ${r.site}, by itself.`, '', `Ask your agent where request ${r.id} stands, and it will tell you why and what you can do.`]);
    await wakeIfMore(env, repo);
    return json({ ok: true });
  }

  if (action === 'ready') {
    const understood = clip(b.understood, 3000), did = clip(b.did, 3000), wrote = clip(b.wrote, 6000) || null;
    const pr = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)$/.exec(clip(b.pr_url, 300));
    const preview = previewUrl(b.preview_url);
    if (!understood || !did) return json({ error: 'Give both understood and did.' }, 400);
    if (!pr || pr[1] !== repo) return json({ error: `pr_url must be a pull request on ${repo}.` }, 400);
    if (!preview) return json({ error: 'preview_url must be the https address of the preview copy, on the account\'s own workers.dev address.' }, 400);
    let commit = 'd'.repeat(40);
    if (!dry(env)) {
      const res = await github(env, 'GET', `/repos/${repo}/pulls/${pr[2]}`);
      if (!res.ok) {
        console.error('Cloud Dancer: GitHub would not show the pull request', res.status, await res.text());
        return json({ error: `GitHub wouldn't show that pull request (error ${res.status}).` }, res.status === 404 ? 400 : 502);
      }
      const pull = await res.json();
      const wrong = checkPull(pull, repo, r.id);
      if (wrong) return json({ error: wrong }, 400);
      // Every file it changes must be inside the site's fence.
      if (pull.changed_files > 300) return json({ error: `That pull request changes ${pull.changed_files} files, more than Cloud Dancer may hand in at once.` }, 400);
      const files = [];
      let seen = 0;
      for (let page = 1; page <= 3 && seen < pull.changed_files; page++) {
        const fr = await github(env, 'GET', `/repos/${repo}/pulls/${pr[2]}/files?per_page=100&page=${page}`);
        if (!fr.ok) return json({ error: `GitHub wouldn't list that pull request's files (error ${fr.status}).` }, 502);
        const batch = await fr.json();
        if (!batch.length) break;
        seen += batch.length;
        for (const f of batch) { files.push(f.filename); if (f.previous_filename) files.push(f.previous_filename); }
      }
      if (!files.length || seen < pull.changed_files) return json({ error: 'GitHub didn\'t list every file that pull request changes, so it can\'t be checked.' }, 400);
      const outside = outsideFence(r.site, files);
      if (outside.length) return json({ error: `That pull request changes files Cloud Dancer may not change: ${outside.slice(0, 5).join(', ')}.` }, 400);
      commit = pull.head.sha;
    }
    await env.DB.prepare(
      `UPDATE requests SET status = 'ready', status_at = ?, understood = ?, did = ?, wrote = ?, branch = ?, pr_url = ?, preview_url = ?, commit_sha = ? WHERE id = ?`
    ).bind(now(), understood, did, wrote, branchFor(r.id), pr[0], preview.href, commit, r.id).run();
    await addStep(env, r.id, 'A change is ready for you to check.');
    await tell(env, r, `Ready for you to check: request ${r.id}`, [`Cloud Dancer has made the change you asked for in request ${r.id}, about ${r.site}, on a private preview copy.`, 'Nothing is live yet.', '', `Ask your agent where request ${r.id} stands. It will tell you what changed, and you can then publish it or send it back.`]);
    await wakeIfMore(env, repo);
    return json({ ok: true });
  }

  return json({ error: 'No such action.' }, 404);
}
