// Tests for what keeps Cloud Dancer inside its fence: what `ready` will accept, and what the run will push.
// Run with: npm test (from the dancer folder). Nothing here touches the network, GitHub or a real database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inFence, outsideFence } from './sites.js';
import { agentApi, checkPull } from './agent.js';
import { staged, readResult } from './run.mjs';

const SITE = 'unremarkable.me', REPO = 'Carrados/unremarkable', SHA = 'c'.repeat(40);

test('the fence: only the site\'s pages and what the build writes from them', () => {
  for (const f of ['src/prices.html', 'src/pictures/a.png', 'site/prices/index.html', 'site/llms.txt']) assert.ok(inFence(SITE, f), f);
  for (const f of ['build.mjs', 'wrangler.jsonc', 'fix/worker.js', 'dancer/DANCER.md', 'dancer/sites.js', 'phix/PHIX.md', '.github/workflows/dancer.yml',
    'README.md', 'src/../build.mjs', '/etc/passwd', 'srcx/a.html', 'site', '']) assert.equal(inFence(SITE, f), false, f);
  assert.equal(inFence('not-a-site.example', 'src/a.html'), false);
  assert.deepEqual(outsideFence(SITE, ['src/a.html', 'build.mjs', 'site/a/index.html']), ['build.mjs']);
});

const pull = (over = {}) => ({
  state: 'open', merged: false, changed_files: 2,
  head: { ref: 'dancer/request-7', sha: SHA, repo: { full_name: REPO } },
  base: { ref: 'main', repo: { full_name: REPO, default_branch: 'main' } },
  ...over,
});

test('the pull request must be this request\'s own', () => {
  assert.equal(checkPull(pull(), REPO, 7), '');
  assert.match(checkPull(pull({ head: { ref: 'dancer/request-7', sha: SHA, repo: { full_name: 'stranger/unremarkable' } } }), REPO, 7), /another repo/);
  assert.match(checkPull(pull({ head: { ref: 'phix/report-7', sha: SHA, repo: { full_name: REPO } } }), REPO, 7), /must be on dancer\/request-7/);
  assert.match(checkPull(pull(), REPO, 8), /must be on dancer\/request-8/);
  assert.match(checkPull(pull({ state: 'closed', merged: true }), REPO, 7), /already merged/);
  assert.match(checkPull(pull({ base: { ref: 'other', repo: { full_name: REPO, default_branch: 'main' } } }), REPO, 7), /not main/);
});

// Stand-ins: one request being worked on, and GitHub answering from a table.
function fakeEnv() {
  const ran = [];
  const r = { id: 7, owner: 'lottie@example.org', site: SITE, instruction: 'x', status: 'working', tries: 1 };
  return {
    ran, DANCER_SECRET: 's3cret', GITHUB_TOKEN: 't', DANCER_OPEN: '1',
    DB: { prepare(sql) { const st = { a: [], bind(...a) { st.a = a; return st; },
      async first(col) { if (/SELECT \* FROM requests WHERE id = \? AND status = 'working'/.test(sql)) return st.a[0] === 7 ? r : null; if (/COUNT/.test(sql)) return col ? 0 : { n: 0 }; return null; },
      async run() { ran.push({ sql, a: st.a }); return {}; } }; return st; } },
  };
}
function fakeGitHub(t, answers) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const key = `${init.method} ${String(url).replace('https://api.github.com', '')}`;
    const [status, body] = answers[key] || [404, {}];
    return new Response(JSON.stringify(body), { status });
  };
  t.after(() => { globalThis.fetch = real; });
}
const quiet = t => { const { log, error } = console; console.log = console.error = () => {}; t.after(() => { console.log = log; console.error = error; }); };
const post = (env, action, body, secret = 's3cret') => agentApi(new Request(`https://dancer.unremarkable.me/agent/${action}`, {
  method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env);
const handIn = { id: 7, understood: 'u', did: 'd', pr_url: `https://github.com/${REPO}/pull/50`, preview_url: 'https://dancer-7-unremarkable.charlijotyrer.workers.dev/' };

test('the in-tray is closed to anyone without the secret', async () => {
  for (const secret of ['', 'wrong', 's3cre', 's3crets']) assert.equal((await post(fakeEnv(), 'get', { id: 7 }, secret)).status, 401);
  const env = fakeEnv(); delete env.DANCER_SECRET;
  assert.equal((await post(env, 'get', { id: 7 }, '')).status, 401);
  assert.equal((await post(fakeEnv(), 'get', { id: 7 })).status, 200);
});

test('ready keeps the commit GitHub reports when every file is inside the fence', async t => {
  quiet(t);
  const env = fakeEnv();
  fakeGitHub(t, {
    [`GET /repos/${REPO}/pulls/50`]: [200, pull()],
    [`GET /repos/${REPO}/pulls/50/files?per_page=100&page=1`]: [200, [{ filename: 'src/prices.html' }, { filename: 'site/prices/index.html' }]],
  });
  const res = await post(env, 'ready', handIn);
  assert.equal(res.status, 200);
  const update = env.ran.find(q => /status = 'ready'/.test(q.sql));
  assert.ok(update.a.includes(SHA) && update.a.includes('dancer/request-7'));
});

test('ready refuses a change that touches the machinery, however it got there', async t => {
  quiet(t);
  for (const files of [
    [{ filename: 'src/prices.html' }, { filename: 'build.mjs' }],
    [{ filename: 'dancer/DANCER.md' }],
    [{ filename: '.github/workflows/dancer.yml' }],
    [{ filename: 'src/new.html', previous_filename: 'wrangler.jsonc' }],
  ]) {
    const env = fakeEnv();
    fakeGitHub(t, { [`GET /repos/${REPO}/pulls/50`]: [200, pull({ changed_files: files.length })], [`GET /repos/${REPO}/pulls/50/files?per_page=100&page=1`]: [200, files] });
    const res = await post(env, 'ready', handIn);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /may not change/);
    assert.equal(env.ran.length, 0, 'nothing was saved and the owner was not told');
  }
});

test('ready refuses a fork, another branch, or a preview somewhere else', async t => {
  quiet(t);
  for (const [answer, body, why] of [
    [pull({ head: { ref: 'dancer/request-7', sha: SHA, repo: { full_name: 'stranger/unremarkable' } } }), handIn, /another repo/],
    [pull({ head: { ref: 'main-takeover', sha: SHA, repo: { full_name: REPO } } }), handIn, /must be on dancer\/request-7/],
    [pull(), { ...handIn, preview_url: 'https://evil.example/' }, /preview_url must be/],
    [pull(), { ...handIn, pr_url: 'https://github.com/Carrados/tka/pull/50' }, /pr_url must be a pull request on/],
  ]) {
    const env = fakeEnv();
    fakeGitHub(t, { [`GET /repos/${REPO}/pulls/50`]: [200, answer] });
    const res = await post(env, 'ready', body);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, why);
    assert.equal(env.ran.length, 0);
  }
});

test('the run reads what the model says it did, and takes nothing vague', () => {
  assert.deepEqual(readResult('{"outcome":"ready","understood":"u","did":"d"}'), { outcome: 'ready', understood: 'u', did: 'd', wrote: '' });
  assert.deepEqual(readResult('{"outcome":"stuck","reason":"why"}'), { outcome: 'stuck', reason: 'why' });
  for (const bad of ['', 'not json', '{}', '{"outcome":"ready"}', '{"outcome":"ready","understood":"u"}', '{"outcome":"stuck"}', '{"outcome":"done","understood":"u","did":"d"}', '{"outcome":"ready","understood":{"a":1},"did":"d"}']) {
    assert.throws(() => readResult(bad), bad);
  }
});

test('the run sees every file a patch touches, and anything that isn\'t an ordinary file', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dancer-'));
  const here = process.cwd();
  t.after(() => { process.chdir(here); rmSync(dir, { recursive: true, force: true }); });
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@example.org'); g('config', 'user.name', 't');
  mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src/a.html'), '<p>a</p>\n'); writeFileSync(join(dir, 'build.mjs'), '// build\n');
  g('add', '-A'); g('commit', '-q', '-m', 'start');
  // A patch that edits a page, moves the build script into src/, and adds a link pointing out of the repo.
  writeFileSync(join(dir, 'src/a.html'), '<p>b</p>\n');
  g('mv', 'build.mjs', 'src/build.mjs');
  symlinkSync('/etc/passwd', join(dir, 'src/link.html'));
  g('add', '-A');
  process.chdir(dir);
  const s = staged();
  assert.deepEqual(s.files.sort(), ['build.mjs', 'src/a.html', 'src/build.mjs', 'src/link.html']);
  assert.deepEqual(s.odd, ['src/link.html']);
  assert.deepEqual(outsideFence(SITE, s.files), ['build.mjs'], 'moving the build script is seen as changing it');
});
