// Takes Phix's finished fixes, pushes them, puts them on preview copies and hands them in. No model runs here.
//
// Phix (the agent) works in one job of .github/workflows/phix.yml. She holds no key that can change anything:
// no Cloudflare key, and no GitHub token that can push or merge. When a fix is done she leaves two files in
// phix-out/: her branch as a git bundle (report-<id>.bundle) and a hand-in file (ready-<id>.json). A second
// job with no keys builds the pages (phix/build.mjs). This script runs last, in a job of its own on a fresh
// machine, and is the only thing that holds the keys. For each hand-in it:
//
//   1. reads her branch out of the bundle, and refuses it if it touches a site's machinery
//      (workflows, the agents' rules and code, Worker code, how a site is deployed or built from npm)
//   2. pushes it to phix/report-<id> in the site's own repo, and to no other branch, and opens the pull request
//   3. uploads a preview copy: the Worker's code and settings exactly as they are on main, with the built
//      pages from her branch (wrangler versions upload --preview-alias phix-<id>)
//   4. checks the preview answers, then calls `ready`, which emails the owner the link to publish or reject
//
// Everything Phix wrote is treated as data. Nothing from her branch is run here, and no code from her branch
// goes on the preview Worker, which runs with the site's own secrets. Which repo and which Worker comes from
// the page that was reported (phix/sites.mjs), never from Phix.
// If any step fails, the report is marked stuck with the reason, so the owner hears and nothing is left hanging.
//
//   WORK                   [{"id": 12, "site": "carrados.com"}], from the claim step (before the agent ran)
//   HANDIN_DIR             where Phix's hand-in files were downloaded to
//   ASSETS_DIR             where the built pages from the build job were downloaded to
//   WRANGLER               the path of the wrangler program to use
//   PUSH_TOKEN             pushes the branch and opens the pull request (PHIX_GITHUB_TOKEN)
//   PHIX_SECRET            Phix's key to her API, for `ready` and `stuck`
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { unsafe } from '../dancer/preview.mjs';
import { machinery, readWork } from './sites.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHA = /^[0-9a-f]{40}$/;
const MAX_BUNDLE = 200 * 1024 * 1024, MAX_ASSETS = 500 * 1024 * 1024;

const text = (v, n) => String(v ?? '').trim().slice(0, n);

// The hand-in, as plain checked values. Throws with words for the owner when it can't be used.
export function readHandin(raw, id) {
  let h;
  try { h = JSON.parse(raw); } catch { throw new Error('The hand-in file was not valid JSON.'); }
  const understood = text(h.understood, 2000), did = text(h.did, 2000);
  if (!understood || !did) throw new Error('The hand-in file did not say what was understood and what was changed.');
  const title = text(h.title, 120).replace(/\s+/g, ' ') || 'a fix';
  const path = text(h.path, 300) || '/';
  if (!/^\/(?!\/)[^\s\\]*$/.test(path)) throw new Error('The page path in the hand-in file was not a path on the site.');
  return { id, understood, did, title, path, test_ref: text(h.test_ref, 300) || undefined };
}

// The preview address wrangler printed for this report's alias, or null.
export function previewFrom(output, id) {
  const m = new RegExp(`https://phix-${id}-[a-z0-9-]+\\.[a-z0-9-]+\\.workers\\.dev`).exec(String(output));
  return m ? m[0] : null;
}

// An archive of built pages may hold plain files and folders, inside itself, and nothing else.
// `listing` is what `tar -tvf` printed. Returns what's wrong, or ''.
export function badArchive(listing) {
  for (const line of String(listing).split('\n').filter(Boolean)) {
    if (!/^[-d]/.test(line)) return 'it holds something that is not a plain file or folder';
    const name = line.split(/\s+/).slice(5).join(' ');
    if (name.startsWith('/') || name.split('/').includes('..')) return 'it holds a file outside its own folder';
  }
  return '';
}

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// A push with the token, handed to git through its environment so it is never on a command line or in a log.
function push(dir, repo, sha, branch, token) {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  execFileSync('git', ['-C', dir, 'push', '-q', `https://github.com/${repo}`, `${sha}:refs/heads/${branch}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}` },
  });
}

async function gh(token, method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'phix-preview', 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`GitHub refused (${method} ${path.replace(/\?.*$/, '')}: error ${res.status}).`);
  return res.json();
}

function api(action, body) {
  const file = join(mkdtempSync(join(tmpdir(), 'phix-')), 'body.json');
  writeFileSync(file, JSON.stringify(body));
  execFileSync('node', [join(HERE, 'api.mjs'), action, file], { stdio: 'inherit' });
}

async function one({ id, repo, config, assets }, env) {
  const file = join(env.HANDIN_DIR, `ready-${id}.json`), bundle = join(env.HANDIN_DIR, `report-${id}.bundle`);
  if (!existsSync(file)) { console.log(`Report ${id}: nothing handed in for a preview copy.`); return; }
  if (statSync(file).size > 65536) throw new Error('The hand-in file was too big.');
  const h = readHandin(readFileSync(file, 'utf8'), id);
  if (!existsSync(bundle)) throw new Error('The fix itself was not handed in (no bundle file).');
  if (statSync(bundle).size > MAX_BUNDLE) throw new Error('The fix handed in was too big.');
  const branch = `phix/report-${id}`, token = env.PUSH_TOKEN;
  const main = (await gh(token, 'GET', `/repos/${repo}`)).default_branch;

  // Main from GitHub and her branch from the bundle, in a new empty folder: no hooks, no settings of the agent's.
  const dir = mkdtempSync(join(tmpdir(), `preview-${id}-`));
  git(dir, 'init', '-q');
  git(dir, 'fetch', '-q', `https://github.com/${repo}`, `refs/heads/${main}`);
  const mainSha = git(dir, 'rev-parse', 'FETCH_HEAD').trim();
  try { git(dir, '-c', 'fetch.fsckObjects=true', 'fetch', '-q', bundle, `refs/heads/${branch}`); }
  catch { throw new Error(`The bundle handed in did not hold the branch ${branch}.`); }
  const sha = git(dir, 'rev-parse', 'FETCH_HEAD').trim();
  if (!SHA.test(sha) || sha === mainSha) throw new Error('The fix handed in had nothing in it.');
  let from;
  try { from = git(dir, 'merge-base', mainSha, sha).trim(); } catch { throw new Error(`The fix handed in was not made from ${main}.`); }
  const touched = machinery(git(dir, 'diff', '--name-only', '-z', '--no-renames', from, sha).split('\0').filter(Boolean));
  if (touched) throw new Error(`The fix touches the site's own machinery (${touched}), which Phix may not change. It needs Unremarkable.`);

  // The pages the build job made from that same commit.
  const tar = join(env.ASSETS_DIR, `assets-${id}.tar`), built = join(env.ASSETS_DIR, `assets-${id}.sha`);
  if (!existsSync(tar) || !existsSync(built)) throw new Error('The site could not be built with this fix. Unremarkable has the details.');
  if (readFileSync(built, 'utf8').trim() !== sha) throw new Error('The pages were not built from the commit that was handed in.');
  if (statSync(tar).size > MAX_ASSETS) throw new Error('The built pages were too big.');
  const wrong = badArchive(execFileSync('tar', ['-tvf', tar], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
  if (wrong) throw new Error(`The built pages can't go on a preview copy: ${wrong}.`);

  // The Worker as it is on main, with only its folder of pages swapped for the built ones.
  git(dir, '-c', 'advice.detachedHead=false', 'checkout', '-q', mainSha);
  if (!existsSync(join(dir, config))) throw new Error(`The site's settings file (${config}) is missing from ${main}.`);
  const pages = join(dir, assets);
  rmSync(pages, { recursive: true, force: true });
  mkdirSync(pages, { recursive: true });
  execFileSync('tar', ['-xf', tar, '-C', pages, '--no-same-owner', '--no-same-permissions'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const risk = unsafe(pages);
  if (risk) throw new Error(`The built pages can't go on a preview copy: ${risk}.`);

  // Her branch, to its own name and nowhere else. Never forced: a retry adds to what is there.
  try { push(dir, repo, sha, branch, token); }
  catch (e) { console.error(String(e.stderr || '')); throw new Error('GitHub would not take the branch. Unremarkable has the details.'); }
  const owner = repo.split('/')[0];
  const open = await gh(token, 'GET', `/repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`);
  const pull = open[0] || await gh(token, 'POST', `/repos/${repo}/pulls`, {
    title: `Phix: ${h.title} (report ${id})`, head: branch, base: main,
    body: `What I understood: ${h.understood}\n\nWhat I changed: ${h.did}`,
  });
  const pr_url = `https://github.com/${repo}/pull/${pull.number}`;

  // wrangler runs from its own folder with only what it needs.
  let out;
  try {
    out = execFileSync(env.WRANGLER, ['versions', 'upload', '--preview-alias', `phix-${id}`, '--config', join(dir, config)], {
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

  api('ready', { id, understood: h.understood, did: h.did, branch, pr_url, preview_url: preview.href, test_ref: h.test_ref });
  console.log(`Report ${id}: ready, on ${preview.href} (commit ${sha}).`);
}

async function main() {
  const env = process.env;
  for (const k of ['WORK', 'HANDIN_DIR', 'ASSETS_DIR', 'WRANGLER', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'PUSH_TOKEN', 'PHIX_SECRET']) {
    if (!env[k]) { console.error(`${k} is not set.`); process.exit(2); }
  }
  let failed = false;
  for (const w of readWork(env.WORK)) {
    try { await one(w, env); } catch (e) {
      failed = true;
      console.error(`Report ${w.id}: ${e.message}`);
      // Tell the owner. If the report is no longer hers to mark (she already said stuck), the API says so.
      try { api('stuck', { id: w.id, reason: `A fix was made, but it could not be put on a preview copy. ${e.message}` }); } catch { /* already said above */ }
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
