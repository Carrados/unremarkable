// The fixed parts of Cloud Dancer's run (.github/workflows/dancer.yml). No model runs in this file.
//
//   node dancer/run.mjs claim            job 1, before the model: take one request, write .dancer/request.json
//   node dancer/run.mjs handin <folder>  job 2, after the model: check its patch, push it, preview it, hand it in
//
// The model works between the two, in a job that holds no keys, and leaves two things in <folder>:
// change.patch (what it changed) and result.json (what it says it did). Nothing it leaves is trusted:
//   - the request is fetched again from the API, by the number the claim step gave;
//   - the patch may only touch the site's own folders (the fence in sites.js), and no links or submodules;
//   - the site is built again here, from the main branch's own build script, so the preview is what will go live;
//   - and the Worker checks the pull request with GitHub once more before the owner is told (agent.js).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { outsideFence, branchFor, previewUrl } from './sites.js';

const API = process.env.DANCER_API || 'https://dancer.unremarkable.me/agent';
const REPO = process.env.GITHUB_REPOSITORY || '';

async function api(action, body = {}) {
  const res = await fetch(`${API}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.DANCER_SECRET || ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`The in-tray answered ${res.status}: ${data.error || text.slice(0, 200)}`);
  return data;
}

// Run a command with none of this job's keys in its environment.
const CLEAN = { PATH: process.env.PATH, HOME: process.env.HOME || '/tmp', LANG: 'C.UTF-8' };
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', env: CLEAN, maxBuffer: 64 * 1024 * 1024, ...opts });
const git = (...args) => run('git', ['-c', 'core.hooksPath=/dev/null', ...args]);

// What a staged change touches: every path (old and new names), and anything that isn't an ordinary file.
export function staged() {
  const raw = git('diff', '--cached', '--raw', '--no-renames', '-z').split('\0').filter(Boolean);
  const files = [], odd = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const [, newMode] = raw[i].replace(/^:/, '').split(' ');
    const file = raw[i + 1];
    files.push(file);
    if (!['100644', '100755', '000000'].includes(newMode)) odd.push(file);
  }
  return { files, odd };
}

// What the model says it did. Returns { outcome, understood, did, wrote, reason } or throws with why it won't do.
export function readResult(text) {
  let r;
  try { r = JSON.parse(text); } catch { throw new Error('Cloud Dancer finished without a readable account of what it did.'); }
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  if (r.outcome === 'stuck') {
    if (!s(r.reason, 3000)) throw new Error('Cloud Dancer stopped without saying why.');
    return { outcome: 'stuck', reason: s(r.reason, 3000) };
  }
  if (r.outcome !== 'ready') throw new Error('Cloud Dancer finished without saying whether the change was made.');
  if (!s(r.understood, 3000) || !s(r.did, 3000)) throw new Error('Cloud Dancer made a change without saying what it understood and what it did.');
  return { outcome: 'ready', understood: s(r.understood, 3000), did: s(r.did, 3000), wrote: s(r.wrote, 6000) };
}

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.DANCER_GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'cloud-dancer', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub answered ${res.status} to ${method} ${path.split('?')[0]}: ${data.message || ''}`);
  return data;
}

async function claim() {
  const { request } = await api('next', { repo: REPO });
  if (!request) { console.log('The in-tray is empty.'); return; }
  mkdirSync('.dancer', { recursive: true });
  writeFileSync('.dancer/request.json', JSON.stringify(request, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `id=${request.id}\n`);
  console.log(`Took request ${request.id}, about ${request.site}.`);
}

// A reason the owner can read, when the run fails at a step that isn't the model's doing.
class Stop extends Error {}

async function handin(folder) {
  const id = Number(process.env.DANCER_ID);
  const { request } = await api('get', { id });
  try {
    const resultPath = join(folder, 'result.json'), patchPath = join(folder, 'change.patch');
    if (!existsSync(resultPath)) throw new Stop('Cloud Dancer\'s run ended before it finished, so nothing was changed. Send this back to try again.');
    let result;
    try { result = readResult(readFileSync(resultPath, 'utf8')); } catch (e) { throw new Stop(e.message); }
    if (result.outcome === 'stuck') { await api('stuck', { id, reason: result.reason }); console.log('Stuck, as Cloud Dancer asked.'); return; }
    if (!existsSync(patchPath) || statSync(patchPath).size === 0) throw new Stop('Cloud Dancer said it had made the change, but nothing on the site was different. Send this back to try again, or say it another way.');

    // 1. The patch, and only inside the fence.
    try { git('apply', '--index', '--whitespace=nowarn', patchPath); } catch { throw new Stop('The change Cloud Dancer made could not be applied to the site as it is now. Send this back to try again.'); }
    let s = staged();
    let outside = outsideFence(request.site, s.files);
    if (outside.length || s.odd.length) throw new Stop(`This needs a change to how the site is built, not only to its pages (${[...outside, ...s.odd].slice(0, 4).join(', ')}). Cloud Dancer isn't allowed to make that kind of change. Unremarkable can.`);

    // 2. Build the site again here, with the main branch's own build script and none of this job's keys.
    try { run('sh', ['-c', request.build], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { throw new Stop(`The site wouldn't build with this change: ${String(e.stderr || e.message).trim().split('\n').slice(-2).join(' ').slice(0, 300)}`); }
    git('add', '-A');
    s = staged();
    outside = outsideFence(request.site, s.files);
    if (outside.length || s.odd.length) throw new Stop(`Building the site changed files outside its pages (${[...outside, ...s.odd].slice(0, 4).join(', ')}), so the change was not handed in. Unremarkable needs to look at this.`);
    if (!s.files.length) throw new Stop('The change made no difference to the site once it was built. Send this back to try again, or say it another way.');

    // 3. Commit and push to this request's own branch. Never to main.
    const branch = branchFor(id);
    git('-c', 'user.name=Cloud Dancer', '-c', 'user.email=dancer@unremarkable.me', 'commit', '-q', '-m', `Cloud Dancer: request ${id} (${request.site})\n\n${result.did}`);
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'push', '--force', `https://x-access-token:${process.env.DANCER_GITHUB_TOKEN}@github.com/${REPO}.git`, `HEAD:refs/heads/${branch}`], { stdio: 'ignore', env: CLEAN });

    // 4. One pull request per request: reuse it on a second try.
    const owner = REPO.split('/')[0];
    const open = await gh('GET', `/repos/${REPO}/pulls?state=open&head=${owner}:${branch}`);
    const body = `What Cloud Dancer understood:\n${result.understood}\n\nWhat it changed:\n${result.did}\n\nThe owner publishes this, or sends it back, through their own agent. Don't merge it by hand.`;
    const pr = open[0]
      ? await gh('PATCH', `/repos/${REPO}/pulls/${open[0].number}`, { body })
      : await gh('POST', `/repos/${REPO}/pulls`, { title: `Cloud Dancer: request ${id} (${request.site})`, head: branch, base: 'main', body });

    // 5. A preview copy of exactly this commit. The Worker's code and settings are the main branch's own.
    let out;
    try {
      out = execFileSync('npx', ['--yes', 'wrangler@4', 'versions', 'upload', '--preview-alias', `dancer-${id}`, '--message', `Cloud Dancer request ${id}`], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...CLEAN, CI: '1', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID },
      });
    } catch (e) { console.error(String(e.stderr || e.message).slice(-1500)); throw new Stop('The change was made, but the preview copy couldn\'t be put up, so there is nothing for you to check yet. Send this back to try again.'); }
    const found = [...out.matchAll(/https:\/\/[a-z0-9.-]+\.workers\.dev/g)].map(m => m[0]).find(u => u.includes(`dancer-${id}-`)) || '';
    const preview = previewUrl(found);
    if (!preview) { console.error(out.slice(-1500)); throw new Stop('The change was made, but the preview copy gave no address, so there is nothing for you to check yet. Send this back to try again.'); }
    if (request.page) { const p = new URL(request.page); preview.pathname = p.pathname; }

    await api('ready', { id, understood: result.understood, did: result.did, wrote: result.wrote, pr_url: pr.html_url, preview_url: preview.href });
    console.log(`Handed in request ${id}: ${pr.html_url}`);
  } catch (e) {
    const reason = e instanceof Stop ? e.message : `Cloud Dancer's run failed before the change could be handed in (${String(e.message).slice(0, 300)}). Send this back to try again; if it happens twice, tell Unremarkable.`;
    console.error(e);
    await api('stuck', { id, reason }).catch(err => console.error('Could not report it as stuck:', err.message));
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  const [action, arg] = process.argv.slice(2);
  if (action === 'claim') await claim();
  else if (action === 'handin' && arg) await handin(arg);
  else { console.error('Usage: node dancer/run.mjs claim | handin <folder>'); process.exit(2); }
}
