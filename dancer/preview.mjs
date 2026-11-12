// Takes Cloud Dancer's finished work, pushes it, puts it on a preview copy and hands it in. No model runs here.
//
// Cloud Dancer (the agent) works in one job of .github/workflows/dancer.yml. She holds no key that can change
// anything: no Cloudflare key, and no GitHub token that can push or merge. When a fabric change is done she
// leaves two files in dancer-out/: her branch as a git bundle (request-<id>.bundle) and a hand-in file
// (ready-<id>.json). This script runs afterwards in a job of its own, on a fresh machine, and is the only
// thing that holds the keys. For each hand-in it:
//
//   1. reads her branch out of the bundle, and refuses it if it touches the site's own machinery
//      (workflows, the agents' rules and code, how the site is deployed) or could move a key
//   2. pushes it to dancer/request-<id>, and to no other branch, and opens the pull request
//   3. uploads that commit as a preview copy (wrangler versions upload --preview-alias dancer-<id>)
//   4. checks the preview answers, then calls `ready`, which emails the owner the preview address
//
// Everything Cloud Dancer wrote (the hand-in, the bundle) is treated as data. Nothing from her branch is run:
// wrangler comes from a folder of its own, and the branch's wrangler.jsonc must be the same as main's.
// If any step fails, the request is marked stuck with the reason, so the owner hears and nothing is left hanging.
//
//   WORK                   [{"id": 12, "repo": "Carrados/unremarkable"}], from the claim step (before the agent ran)
//   HANDIN_DIR             where the hand-in files were downloaded to
//   WRANGLER               the path of the wrangler program to use
//   PUSH_TOKEN             pushes the branch and opens the pull request (PHIX_GITHUB_TOKEN)
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, lstatSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const CONFIG = 'wrangler.jsonc';
const MAX_BUNDLE = 100 * 1024 * 1024;
// What a fabric change may never touch: it would change what the agents are, or what their keys reach.
// The owner approves what they see on the preview, and none of this shows there. That includes anything that
// changes how Claude behaves in later runs on this repo, wherever it sits: settings and hooks (.claude/), MCP
// servers (.mcp.json) and rule files (CLAUDE.md, CLAUDE.local.md, AGENTS.md). A hook would run commands in
// every later agent run, past its list of allowed tools.
const MACHINERY = [
  /^\.github\//, /^dancer\//, /^flo\//, /^phix\//, /^fix\//, /^wrangler\.jsonc$/,
  /(^|\/)\.claude\//, /(^|\/)\.mcp\.json$/i, /(^|\/)(CLAUDE|CLAUDE\.local|AGENTS)\.md$/i,
];

const text = (v, n) => String(v ?? '').trim().slice(0, n);

// The hand-in, as plain checked values. Throws with words for the owner when it can't be used.
export function readHandin(raw, id) {
  let h;
  try { h = JSON.parse(raw); } catch { throw new Error('The hand-in file was not valid JSON.'); }
  const understood = text(h.understood, 2000), did = text(h.did, 3000), wrote = text(h.wrote, 3000);
  if (!understood || !did) throw new Error('The hand-in file did not say what was understood and what was changed.');
  const title = text(h.title, 120).replace(/\s+/g, ' ') || 'a change to the site';
  const path = text(h.path, 300) || '/';
  if (!/^\/(?!\/)[^\s\\]*$/.test(path)) throw new Error('The page path in the hand-in file was not a path on the site.');
  return { id, understood, did, wrote, title, path };
}

// The first changed file that is part of the site's machinery, or ''. `files` are paths from the repo's root.
export function machinery(files) {
  return files.find(f => MACHINERY.some(m => m.test(f))) || '';
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
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'cloud-dancer-preview', 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`GitHub refused (${method} ${path.replace(/\?.*$/, '')}: error ${res.status}).`);
  return res.json();
}

function api(action, body) {
  const file = join(mkdtempSync(join(tmpdir(), 'dancer-')), 'body.json');
  writeFileSync(file, JSON.stringify(body));
  // api.mjs prints the API's answer, which repeats nothing the owner wrote.
  execFileSync('node', [join(HERE, 'api.mjs'), action, file], { stdio: 'inherit' });
}

async function one({ id, repo }, env) {
  const file = join(env.HANDIN_DIR, `ready-${id}.json`), bundle = join(env.HANDIN_DIR, `request-${id}.bundle`);
  if (!existsSync(file)) { console.log(`Request ${id}: nothing handed in for a preview copy.`); return; }
  if (statSync(file).size > 65536) throw new Error('The hand-in file was too big.');
  const h = readHandin(readFileSync(file, 'utf8'), id);
  if (!existsSync(bundle)) throw new Error('The change itself was not handed in (no bundle file).');
  if (statSync(bundle).size > MAX_BUNDLE) throw new Error('The change handed in was too big.');
  const branch = `dancer/request-${id}`, token = env.PUSH_TOKEN;
  const main = (await gh(token, 'GET', `/repos/${repo}`)).default_branch;

  // Main from GitHub and her branch from the bundle, in a new empty folder: no hooks, no settings of the agent's.
  const dir = mkdtempSync(join(tmpdir(), `preview-${id}-`));
  git(dir, 'init', '-q');
  git(dir, 'fetch', '-q', `https://github.com/${repo}`, `refs/heads/${main}`);
  const mainSha = git(dir, 'rev-parse', 'FETCH_HEAD').trim();
  try { git(dir, '-c', 'fetch.fsckObjects=true', 'fetch', '-q', bundle, `refs/heads/${branch}`); }
  catch { throw new Error(`The bundle handed in did not hold the branch ${branch}.`); }
  const sha = git(dir, 'rev-parse', 'FETCH_HEAD').trim();
  if (!SHA.test(sha) || sha === mainSha) throw new Error('The change handed in had nothing in it.');
  let from;
  try { from = git(dir, 'merge-base', mainSha, sha).trim(); } catch { throw new Error(`The change handed in was not made from ${main}.`); }
  const touched = machinery(git(dir, 'diff', '--name-only', '-z', '--no-renames', from, sha).split('\0').filter(Boolean));
  if (touched) throw new Error(`The change touches the site's own machinery (${touched}), which Cloud Dancer may not change. Ask Unremarkable.`);

  git(dir, '-c', 'advice.detachedHead=false', 'checkout', '-q', sha);
  const trusted = git(dir, 'show', `${mainSha}:${CONFIG}`);
  if (!existsSync(join(dir, CONFIG)) || readFileSync(join(dir, CONFIG), 'utf8') !== trusted) {
    throw new Error(`The change alters how the site is deployed (${CONFIG}). That can't go on a preview copy automatically. Ask Unremarkable.`);
  }
  const risk = unsafe(dir);
  if (risk) throw new Error(`The change can't go on a preview copy: ${risk}.`);

  // Her branch, to its own name and nowhere else. Never forced: a retry adds to what is there.
  try { push(dir, repo, sha, branch, token); }
  catch (e) { console.error(String(e.stderr || '')); throw new Error('GitHub would not take the branch. Unremarkable has the details.'); }
  const owner = repo.split('/')[0];
  const open = await gh(token, 'GET', `/repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`);
  const made = open[0] || await gh(token, 'POST', `/repos/${repo}/pulls`, {
    title: `Cloud Dancer: ${h.title} (request ${id})`, head: branch, base: main,
    body: `What I understood: ${h.understood}\n\nWhat I changed: ${h.did}`,
  });
  const pull = await gh(token, 'GET', `/repos/${repo}/pulls/${made.number}`);
  const bad = checkPull(pull, repo, id);
  if (bad) throw new Error(bad);
  if (pull.head.sha !== sha) throw new Error('The pull request is not at the commit that was handed in.');
  const pr_url = `https://github.com/${repo}/pull/${pull.number}`;

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

  api('ready', { id, understood: h.understood, did: h.did, wrote: h.wrote || undefined, pr_url, preview_url: preview.href });
  console.log(`Request ${id}: ready, on ${preview.href} (commit ${sha}).`);
}

async function main() {
  const env = process.env;
  for (const k of ['WORK', 'HANDIN_DIR', 'WRANGLER', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'PUSH_TOKEN']) {
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
