// Puts Cloud Dancer's finished work on a preview copy and hands it in. No model runs here.
//
// Cloud Dancer (the agent) works in one job of .github/workflows/dancer.yml, with no Cloudflare key. When a
// fabric change is done she leaves a hand-in file, dancer-out/ready-<id>.json. This script runs afterwards in a
// job of its own, on a fresh machine, and is the only thing that holds the Cloudflare key. For each hand-in it:
//
//   1. asks GitHub for the pull request, and checks it is from dancer/request-<id> in the site's own repo
//   2. fetches exactly that commit, and refuses it if anything in it could run code or move the key
//   3. uploads it as a preview copy (wrangler versions upload --preview-alias dancer-<id>)
//   4. checks the preview answers, then calls `ready`, which emails the owner the preview address
//
// Everything Cloud Dancer wrote (the hand-in, the branch) is treated as data. Nothing from the branch is run:
// wrangler comes from a folder of its own, and the branch's wrangler.jsonc must be the same as main's.
// If any step fails, the request is marked stuck with the reason, so the owner hears and nothing is left hanging.
//
//   WORK                   [{"id": 12, "repo": "Carrados/unremarkable"}], from the claim step (before the agent ran)
//   HANDIN_DIR             where the hand-in files were downloaded to
//   WRANGLER               the path of the wrangler program to use
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GH_TOKEN

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, lstatSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const CONFIG = 'wrangler.jsonc';

const text = (v, n) => String(v ?? '').trim().slice(0, n);

// The hand-in, as plain checked values. Throws with words for the owner when it can't be used.
export function readHandin(raw, id, repo) {
  let h;
  try { h = JSON.parse(raw); } catch { throw new Error('The hand-in file was not valid JSON.'); }
  const understood = text(h.understood, 2000), did = text(h.did, 3000), wrote = text(h.wrote, 3000);
  if (!understood || !did) throw new Error('The hand-in file did not say what was understood and what was changed.');
  const pr = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)$/.exec(text(h.pr_url, 300));
  if (!pr || pr[1] !== repo) throw new Error(`The hand-in file did not name a pull request on ${repo}.`);
  const path = text(h.path, 300) || '/';
  if (!/^\/(?!\/)[^\s\\]*$/.test(path)) throw new Error('The page path in the hand-in file was not a path on the site.');
  return { id, understood, did, wrote, pr_url: pr[0], number: Number(pr[2]), path };
}

// What GitHub says about the pull request must match the request. Returns what's wrong, or ''.
export function checkPull(pull, repo, id) {
  const want = `dancer/request-${id}`;
  if (!pull || !pull.head || !pull.base) return 'GitHub has no such pull request.';
  if (pull.state !== 'open') return 'The pull request is not open.';
  if (pull.base.repo?.full_name !== repo || pull.head.repo?.full_name !== repo) return `The pull request is not within ${repo}.`;
  if (pull.head.ref !== want) return `The pull request is from ${pull.head.ref}, not ${want}.`;
  if (!SHA.test(pull.head.sha || '')) return 'GitHub gave no commit for the pull request.';
  return '';
}

// The preview address wrangler printed for this alias, or null. Only an address for this request's alias counts.
export function previewFrom(output, id) {
  const m = new RegExp(`https://dancer-${id}-[a-z0-9-]+\\.[a-z0-9-]+\\.workers\\.dev`).exec(String(output));
  return m ? m[0] : null;
}

// Anything in the checkout that could run code here, point outside it, or send the key somewhere else.
export function unsafe(dir) {
  for (const name of readdirSync(dir)) {
    if (/^\.env|^\.dev\.vars/.test(name)) return `it has a settings file (${name}) that must not be in a site's repo`;
  }
  const walk = d => {
    for (const name of readdirSync(d)) {
      if (d === dir && name === '.git') continue;
      const p = join(d, name), s = lstatSync(p);
      if (s.isSymbolicLink()) return `it has a link to another file (${p.slice(dir.length + 1)}), which a preview copy can't carry`;
      if (s.isDirectory()) { const bad = walk(p); if (bad) return bad; }
    }
    return '';
  };
  return walk(dir);
}

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function api(action, body) {
  const file = join(mkdtempSync(join(tmpdir(), 'dancer-')), 'body.json');
  writeFileSync(file, JSON.stringify(body));
  // api.mjs prints the API's answer, which repeats nothing the owner wrote.
  execFileSync('node', [join(HERE, 'api.mjs'), action, file], { stdio: 'inherit' });
}

async function one({ id, repo }, env) {
  const file = join(env.HANDIN_DIR, `ready-${id}.json`);
  if (!existsSync(file)) { console.log(`Request ${id}: nothing handed in for a preview copy.`); return; }
  if (statSync(file).size > 65536) throw new Error('The hand-in file was too big.');
  const h = readHandin(readFileSync(file, 'utf8'), id, repo);

  const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${h.number}`, {
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'cloud-dancer-preview' },
  });
  if (!res.ok) throw new Error(`GitHub wouldn't show the pull request (error ${res.status}).`);
  const pull = await res.json();
  const bad = checkPull(pull, repo, id);
  if (bad) throw new Error(bad);
  const sha = pull.head.sha, main = pull.base.repo.default_branch;

  // Exactly the commit GitHub named, in a new empty folder: no hooks, no settings of the agent's.
  const dir = mkdtempSync(join(tmpdir(), `preview-${id}-`));
  git(dir, 'init', '-q');
  git(dir, 'fetch', '-q', '--depth', '1', `https://github.com/${repo}`, sha);
  git(dir, '-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD');
  if (git(dir, 'rev-parse', 'HEAD').trim() !== sha) throw new Error('The commit fetched was not the one on the pull request.');
  git(dir, 'fetch', '-q', '--depth', '1', `https://github.com/${repo}`, `refs/heads/${main}`);
  const trusted = git(dir, 'show', `FETCH_HEAD:${CONFIG}`);
  if (!existsSync(join(dir, CONFIG)) || readFileSync(join(dir, CONFIG), 'utf8') !== trusted) {
    throw new Error(`The change alters how the site is deployed (${CONFIG}). That can't go on a preview copy automatically. Ask Unremarkable.`);
  }
  const risk = unsafe(dir);
  if (risk) throw new Error(`The change can't go on a preview copy: ${risk}.`);

  // wrangler runs from its own folder with only what it needs, so nothing in the branch can stand in for it.
  let out;
  try {
    out = execFileSync(env.WRANGLER, ['versions', 'upload', '--preview-alias', `dancer-${id}`, '--config', join(dir, CONFIG)], {
      cwd: dirname(env.WRANGLER), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: 'true', CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID },
    });
  } catch (e) {
    console.error(String(e.stdout || ''), String(e.stderr || ''));
    throw new Error('The preview copy could not be uploaded. Unremarkable has the details.');
  }
  console.log(out);
  const base = previewFrom(out, id);
  if (!base) throw new Error('The preview copy was uploaded, but its address could not be read. Unremarkable has the details.');
  const preview = new URL(h.path, base);
  if (preview.origin !== base) throw new Error('The page path in the hand-in file was not a path on the site.');

  let status = 0;
  for (let i = 0; i < 6 && status !== 200; i++) {
    if (i) await new Promise(r => setTimeout(r, 10000));
    status = await fetch(preview, { redirect: 'follow' }).then(r => r.status, () => 0);
  }
  if (status !== 200) throw new Error(`The preview copy did not answer at ${preview.href} (it gave ${status || 'no answer'}).`);

  api('ready', { id, understood: h.understood, did: h.did, wrote: h.wrote || undefined, pr_url: h.pr_url, preview_url: preview.href });
  console.log(`Request ${id}: ready, on ${preview.href} (commit ${sha}).`);
}

async function main() {
  const env = process.env;
  for (const k of ['WORK', 'HANDIN_DIR', 'WRANGLER', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'GH_TOKEN']) {
    if (!env[k]) { console.error(`${k} is not set.`); process.exit(2); }
  }
  const work = JSON.parse(env.WORK).filter(w => Number.isInteger(w.id) && w.id > 0 && REPO.test(w.repo || ''));
  let failed = false;
  for (const w of work) {
    try { await one(w, env); } catch (e) {
      failed = true;
      console.error(`Request ${w.id}: ${e.message}`);
      // Tell the owner. If the request is no longer hers to mark (she already said stuck or flow), the API says so.
      try { api('stuck', { id: w.id, reason: `The change was made, but it could not be put on a preview copy. ${e.message}` }); } catch { /* already said above */ }
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
