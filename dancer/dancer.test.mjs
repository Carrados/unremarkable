// Tests for the parts of Cloud Dancer that decide what an owner may see and what Publish may merge.
// Run with: npm test (from the dancer folder). The sign-in itself is tested end to end by e2e.mjs.
// Nothing here touches the network or a real database: each is a stand-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageOn, previewUrl } from './sites.js';
import { callTool } from './mcp.js';

const SHA = 'b'.repeat(40);

// A small stand-in for the database: owners and requests in memory, answering the queries mcp.js makes.
function fakeEnv({ owners = [['lottie@example.org', 'unremarkable.me']], requests = [], open = '0' } = {}) {
  const steps = [];
  const DB = {
    requests, steps,
    prepare(sql) {
      const st = {
        a: [],
        bind(...a) { st.a = a; return st; },
        async all() {
          if (/FROM owners/.test(sql)) return { results: owners.filter(o => o[0] === st.a[0]).map(o => ({ site: o[1] })) };
          if (/FROM steps/.test(sql)) return { results: steps.filter(s => s.request_id === st.a[0]) };
          if (/FROM requests/.test(sql)) return { results: requests.filter(r => r.owner === st.a[0]) };
          return { results: [] };
        },
        async first(col) {
          if (/SELECT \* FROM requests WHERE id = \?$/.test(sql)) return requests.find(r => r.id === st.a[0]) || null;
          if (/SELECT \* FROM requests WHERE id = \? AND owner = \?/.test(sql)) return requests.find(r => r.id === st.a[0] && r.owner === st.a[1]) || null;
          if (/COUNT\(\*\)/.test(sql)) return col ? 0 : { n: 0 };
          if (/INSERT INTO requests/.test(sql)) { const r = { id: requests.length + 1, owner: st.a[0], site: st.a[1], page: st.a[2], instruction: st.a[3], status: 'queued', tries: 0, created_at: '2026-11-10T19:00:00Z' }; requests.push(r); return { id: r.id }; }
          return null;
        },
        async run() {
          if (/INSERT INTO steps/.test(sql)) steps.push({ request_id: st.a[0], who: st.a[1], text: st.a[2], at: '2026-11-10T19:00:00Z' });
          // An update of one request by id: set each column the SQL names, from a literal or the next bound value.
          const u = /^UPDATE requests SET (.+) WHERE id = \?$/s.exec(sql.trim());
          if (u) {
            const r = requests.find(x => x.id === st.a[st.a.length - 1]);
            let i = 0;
            for (const [, col, val] of u[1].matchAll(/(\w+) = (\?|'[^']*'|CASE .*? END|tries \+ 1)/g)) {
              if (val === '?') r[col] = st.a[i++];
              else if (val.startsWith("'")) r[col] = val.slice(1, -1);
              else if (val.startsWith('CASE')) r[col] = ['stuck', 'fabric'].includes(r.status) ? 0 : r.tries;
              else r[col] = r.tries + 1;
            }
          }
          return {};
        },
      };
      return st;
    },
  };
  return { DB, GITHUB_TOKEN: 't', DANCER_OPEN: open };
}

function fakeGitHub(t, answers) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const key = `${init.method} ${String(url).replace('https://api.github.com', '')}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null });
    const [status, body] = answers[key] || [404, {}];
    return new Response(JSON.stringify(body), { status });
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}
const quiet = t => { const e = console.error; console.error = () => {}; t.after(() => { console.error = e; }); };

const ready = (over = {}) => ({
  id: 1, owner: 'lottie@example.org', site: 'unremarkable.me', instruction: 'Change the price.', status: 'ready', tries: 1,
  created_at: '2026-11-10T19:00:00Z', understood: 'u', did: 'd', preview_url: 'https://dancer-1-unremarkable-preview.charlijotyrer.workers.dev/',
  pr_url: 'https://github.com/Carrados/unremarkable/pull/50', commit_sha: SHA, ...over,
});
const ME = 'lottie@example.org';

test('a page must be on the owner\'s own site', () => {
  assert.ok(pageOn('unremarkable.me', 'https://unremarkable.me/prices/'));
  assert.ok(pageOn('unremarkable.me', 'https://www.unremarkable.me/prices/'));
  assert.equal(pageOn('unremarkable.me', 'https://wwwxunremarkable.me/'), null);
  assert.equal(pageOn('unremarkable.me', 'https://carrados.com/'), null);
  assert.equal(pageOn('unremarkable.me', 'http://unremarkable.me/'), null);
  assert.equal(pageOn('unremarkable.me', 'https://unremarkable.me.evil.example/'), null);
});

test('a preview copy must be on the account\'s own workers.dev address', () => {
  assert.ok(previewUrl('https://dancer-1-unremarkable-preview.charlijotyrer.workers.dev/prices/'));
  assert.equal(previewUrl('https://evil.example/'), null);
  assert.equal(previewUrl('https://evilcharlijotyrer.workers.dev/'), null);
});

test('someone signed in with no site in their name can do nothing', async () => {
  const env = fakeEnv({ owners: [] });
  await assert.rejects(callTool('my_sites', {}, env, ME), /no site is in your name/);
  await assert.rejects(callTool('request_change', { instruction: 'x' }, env, ME), /no site is in your name/);
});

test('one owner cannot see, publish or send back another owner\'s request', async t => {
  const env = fakeEnv({ owners: [[ME, 'unremarkable.me'], ['other@example.org', 'unremarkable.me']], requests: [ready({ owner: 'other@example.org' })] });
  const calls = fakeGitHub(t, {});
  for (const [tool, args] of [['where_it_stands', { request: 1 }], ['publish', { request: 1 }], ['send_back', { request: 1, reasons: 'no', next: 'leave-it' }]]) {
    await assert.rejects(callTool(tool, args, env, ME), /no request number 1/);
  }
  assert.equal(calls.length, 0);
  assert.equal(env.DB.requests[0].status, 'ready');
});

test('an owner whose site was taken away can no longer reach its requests', async () => {
  const env = fakeEnv({ owners: [[ME, 'some-other-site.example']], requests: [ready()] });
  await assert.rejects(callTool('publish', { request: 1 }, env, ME));
});

test('publish merges the commit that was handed in, and no other', async t => {
  const env = fakeEnv({ requests: [ready()] });
  const calls = fakeGitHub(t, { 'PUT /repos/Carrados/unremarkable/pulls/50/merge': [200, { merged: true }] });
  const said = await callTool('publish', { request: 1 }, env, ME);
  assert.match(said, /Published/);
  assert.equal(calls[0].body.sha, SHA);
  assert.equal(env.DB.requests[0].status, 'published');
});

test('publish puts nothing live if the branch changed after the hand-in', async t => {
  quiet(t);
  const env = fakeEnv({ requests: [ready()] });
  fakeGitHub(t, { 'PUT /repos/Carrados/unremarkable/pulls/50/merge': [409, { message: 'Head branch was modified.' }] });
  await assert.rejects(callTool('publish', { request: 1 }, env, ME), /altered after Cloud Dancer handed it in/);
  assert.equal(env.DB.requests[0].status, 'ready');
});

test('publish refuses a request with no commit, or a pull request on another repo', async t => {
  const calls = fakeGitHub(t, {});
  await assert.rejects(callTool('publish', { request: 1 }, fakeEnv({ requests: [ready({ commit_sha: null })] }), ME), /no change that can be published/);
  await assert.rejects(callTool('publish', { request: 1 }, fakeEnv({ requests: [ready({ pr_url: 'https://github.com/stranger/unremarkable/pull/50' })] }), ME), /no change that can be published/);
  await assert.rejects(callTool('publish', { request: 1 }, fakeEnv({ requests: [ready({ status: 'working' })] }), ME), /can't be published/);
  assert.equal(calls.length, 0);
});

test('send back: try again keeps the reasons, leave it closes the pull request', async t => {
  let env = fakeEnv({ requests: [ready()] });
  let calls = fakeGitHub(t, { 'PATCH /repos/Carrados/unremarkable/pulls/50': [200, {}] });
  assert.match(await callTool('send_back', { request: 1, reasons: 'Too formal.', next: 'try-again' }, env, ME), /try request 1 again/);
  assert.equal(env.DB.requests[0].status, 'retry');
  assert.equal(env.DB.requests[0].owner_reason, 'Too formal.');
  assert.equal(calls.length, 0);
  env = fakeEnv({ requests: [ready()] });
  assert.match(await callTool('send_back', { request: 1, reasons: 'Not now.', next: 'leave-it' }, env, ME), /closed/);
  assert.equal(env.DB.requests[0].status, 'left');
  assert.deepEqual(calls[0].body, { state: 'closed' });
  await assert.rejects(callTool('send_back', { request: 1, reasons: '', next: 'try-again' }, fakeEnv({ requests: [ready()] }), ME), /reasons/);
});

// ---- Flo ---------------------------------------------------------------------------------------

import { checkClaims, checkPull, liveOn, act, FLO_WORKFLOW, AUDIENCE } from './flo.js';

test('only a token from Flo\'s own workflow on main, meant for Cloud Dancer, gets in', () => {
  const good = { iss: 'https://token.actions.githubusercontent.com', aud: AUDIENCE, exp: 2e9, repository: 'Carrados/unremarkable', job_workflow_ref: FLO_WORKFLOW };
  assert.equal(checkClaims(good, 1.8e9), '');
  assert.match(checkClaims({ ...good, aud: 'sts.amazonaws.com' }, 1.8e9), /someone else/);
  assert.match(checkClaims({ ...good, exp: 1 }, 1.8e9), /out of date/);
  assert.match(checkClaims({ ...good, repository: 'stranger/unremarkable' }, 1.8e9), /another repository/);
  assert.match(checkClaims({ ...good, job_workflow_ref: 'Carrados/unremarkable/.github/workflows/phix.yml@refs/heads/main' }, 1.8e9), /another workflow/);
  assert.match(checkClaims({ ...good, job_workflow_ref: FLO_WORKFLOW.replace('main', 'claude/x') }, 1.8e9), /not from main/);
  assert.match(checkClaims({ ...good, iss: 'https://evil.example' }, 1.8e9), /not a GitHub/);
});

const pull = (over = {}) => ({ state: 'open', head: { ref: 'flo/request-1', sha: SHA, repo: { full_name: 'Carrados/unremarkable' } }, base: { ref: 'main', repo: { full_name: 'Carrados/unremarkable', default_branch: 'main' } }, ...over });

test('Flo can only hand in her own branch for that request, in the site\'s own repo', () => {
  assert.equal(checkPull(pull(), 'Carrados/unremarkable', 1), '');
  assert.match(checkPull(pull({ head: { ref: 'flo/request-2', sha: SHA, repo: { full_name: 'Carrados/unremarkable' } } }), 'Carrados/unremarkable', 1), /flo\/request-1/);
  assert.match(checkPull(pull({ head: { ref: 'flo/request-1', sha: SHA, repo: { full_name: 'fork/unremarkable' } } }), 'Carrados/unremarkable', 1), /another repo/);
  assert.match(checkPull(pull({ state: 'closed' }), 'Carrados/unremarkable', 1), /closed/);
  assert.equal(liveOn('unremarkable.me', 'https://unremarkable.me/news/hello/')?.pathname, '/news/hello/');
  assert.equal(liveOn('unremarkable.me', 'https://evil.example/news/'), null);
});

test('posted merges exactly the commit GitHub showed, and the request is done', async t => {
  const env = fakeEnv({ requests: [ready({ status: 'working', kind: 'flow', pr_url: null, commit_sha: null })] });
  const calls = fakeGitHub(t, {
    'GET /repos/Carrados/unremarkable/pulls/7': [200, pull()],
    'PUT /repos/Carrados/unremarkable/pulls/7/merge': [200, { merged: true }],
  });
  const res = await act('posted', { id: 1, understood: 'A news item.', did: 'Added it.', pr_url: 'https://github.com/Carrados/unremarkable/pull/7', live_url: 'https://unremarkable.me/news/hello/' }, env);
  assert.equal(res.status, 200);
  assert.equal(calls[1].body.sha, SHA);
  assert.equal(env.DB.requests[0].status, 'published');
});

test('posted puts nothing live from another request\'s branch, or for a request that isn\'t hers', async t => {
  let env = fakeEnv({ requests: [ready({ status: 'working', kind: 'flow' })] });
  const calls = fakeGitHub(t, { 'GET /repos/Carrados/unremarkable/pulls/7': [200, pull({ head: { ref: 'flo/request-9', sha: SHA, repo: { full_name: 'Carrados/unremarkable' } } })] });
  const res = await act('posted', { id: 1, understood: 'u', did: 'd', pr_url: 'https://github.com/Carrados/unremarkable/pull/7', live_url: 'https://unremarkable.me/x/' }, env);
  assert.equal(res.status, 400);
  assert.ok(!calls.some(c => c.key.startsWith('PUT')));
  env = fakeEnv({ requests: [ready({ status: 'queued' })] });
  assert.equal((await act('posted', { id: 1 }, env)).status, 409);
});

test('fabric that reaches Flo goes back to Cloud Dancer, and the site is left alone', async t => {
  const calls = fakeGitHub(t, { 'POST /repos/Carrados/unremarkable/dispatches': [204, {}] });
  const env = fakeEnv({ requests: [ready({ status: 'working', kind: 'flow' })] });
  const res = await act('fabric', { id: 1, reason: 'A new News section is design work.' }, env);
  assert.equal(res.status, 200);
  assert.equal(env.DB.requests[0].status, 'queued');
  assert.equal(env.DB.requests[0].kind, 'fabric');
  assert.deepEqual(calls.map(c => [c.key, c.body.event_type]), [['POST /repos/Carrados/unremarkable/dispatches', 'dancer-wake']]);
});

test('Flo can only work on flow', async t => {
  fakeGitHub(t, {});
  for (const kind of [null, 'fabric']) {
    const env = fakeEnv({ requests: [ready({ status: 'working', kind })] });
    assert.equal((await act('fabric', { id: 1, reason: 'x' }, env)).status, 409);
    assert.equal((await act('step', { id: 1, text: 'x' }, env)).status, 409);
  }
});

// ---- Cloud Dancer: sorting, and fabric on a preview ---------------------------------------------

import { dancerAct } from './fabric.js';
import { DANCER_WORKFLOW } from './flo.js';

test('only Cloud Dancer\'s own workflow gets into her API, and Flo\'s can\'t', () => {
  const good = { iss: 'https://token.actions.githubusercontent.com', aud: AUDIENCE, exp: 2e9, repository: 'Carrados/unremarkable', job_workflow_ref: DANCER_WORKFLOW };
  assert.equal(checkClaims(good, 1.8e9, DANCER_WORKFLOW), '');
  assert.match(checkClaims({ ...good, job_workflow_ref: FLO_WORKFLOW }, 1.8e9, DANCER_WORKFLOW), /another workflow/);
  assert.match(checkClaims(good, 1.8e9), /another workflow/);
});

test('a new request wakes Cloud Dancer, not Flo', async t => {
  const calls = fakeGitHub(t, { 'POST /repos/Carrados/unremarkable/dispatches': [204, {}] });
  const env = fakeEnv({ open: '1' });
  const said = await callTool('request_change', { instruction: 'Add a page.' }, env, ME);
  assert.match(said, /Cloud Dancer has it: request 1/);
  assert.deepEqual(calls.map(c => c.body.event_type), ['dancer-wake']);
  assert.match(await callTool('where_it_stands', { request: 1 }, env, ME), /Waiting for Cloud Dancer to sort it/);
});

test('flow is handed to Flo and Flo is woken; Cloud Dancer changes nothing', async t => {
  const calls = fakeGitHub(t, { 'POST /repos/Carrados/unremarkable/dispatches': [204, {}] });
  const env = fakeEnv({ requests: [ready({ status: 'working', kind: null, tries: 1 })] });
  const res = await dancerAct('flow', { id: 1, reason: 'A news item.' }, env);
  assert.equal(res.status, 200);
  assert.equal(env.DB.requests[0].status, 'flow');
  assert.equal(env.DB.requests[0].kind, 'flow');
  assert.deepEqual(calls.map(c => c.body.event_type), ['flo-wake']);
  assert.match(await callTool('where_it_stands', { request: 1 }, env, ME), /handed it to Flo/);
  // Once it is Flo's, Cloud Dancer can't touch it.
  env.DB.requests[0].status = 'working';
  assert.equal((await dancerAct('ready', { id: 1 }, env)).status, 409);
});

test('fabric Flo sent back can\'t be passed to Flo again', async t => {
  fakeGitHub(t, {});
  const env = fakeEnv({ requests: [ready({ status: 'working', kind: 'fabric' })] });
  assert.equal((await dancerAct('flow', { id: 1, reason: 'x' }, env)).status, 409);
});

const dpull = (over = {}) => pull({ head: { ref: 'dancer/request-1', sha: SHA, repo: { full_name: 'Carrados/unremarkable' } }, ...over });
const handIn = (over = {}) => ({ id: 1, understood: 'A new page.', did: 'Added /what-is-accessibility/.', pr_url: 'https://github.com/Carrados/unremarkable/pull/9', preview_url: 'https://dancer-1-unremarkable.charlijotyrer.workers.dev/what-is-accessibility/', ...over });

test('fabric is ready on a preview: the owner can publish exactly that commit, and nothing was merged before', async t => {
  const calls = fakeGitHub(t, {
    'GET /repos/Carrados/unremarkable/pulls/9': [200, dpull()],
    'PUT /repos/Carrados/unremarkable/pulls/9/merge': [200, { merged: true }],
  });
  const sent = [];
  const env = { ...fakeEnv({ requests: [ready({ status: 'working', kind: null, pr_url: null, commit_sha: null, preview_url: null })] }), OWNER_MAIL: { send: async m => sent.push(m) } };
  const res = await dancerAct('ready', handIn(), env);
  assert.equal(res.status, 200);
  const r = env.DB.requests[0];
  assert.equal(r.status, 'ready');
  assert.equal(r.kind, 'fabric');
  assert.equal(r.commit_sha, SHA);
  assert.ok(!calls.some(c => c.key.startsWith('PUT')), 'Cloud Dancer merges nothing herself');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /https:\/\/dancer-1-unremarkable\.charlijotyrer\.workers\.dev\/what-is-accessibility\//);
  assert.match(sent[0].text, /publish request 1/);
  const said = await callTool('where_it_stands', { request: 1 }, env, ME);
  assert.match(said, /preview copy/);
  assert.match(await callTool('publish', { request: 1 }, env, ME), /Published/);
  assert.equal(calls.at(-1).body.sha, SHA);
});

test('fabric is refused from another branch, off the preview address, or on another repo', async t => {
  quiet(t);
  fakeGitHub(t, { 'GET /repos/Carrados/unremarkable/pulls/9': [200, pull()] });
  const env = () => fakeEnv({ requests: [ready({ status: 'working', kind: null })] });
  assert.match(await (await dancerAct('ready', handIn(), env())).text(), /dancer\/request-1/);
  assert.equal((await dancerAct('ready', handIn({ preview_url: 'https://unremarkable.me/x/' }), env())).status, 400);
  assert.equal((await dancerAct('ready', handIn({ pr_url: 'https://github.com/stranger/unremarkable/pull/9' }), env())).status, 400);
});

test('sending back goes to whoever has it: flow to Flo, fabric to Cloud Dancer', async t => {
  const calls = fakeGitHub(t, { 'POST /repos/Carrados/unremarkable/dispatches': [204, {}] });
  let env = fakeEnv({ open: '1', requests: [ready({ kind: 'fabric' })] });
  assert.match(await callTool('send_back', { request: 1, reasons: 'Shorter.', next: 'try-again' }, env, ME), /Cloud Dancer will try/);
  env = fakeEnv({ open: '1', requests: [ready({ status: 'stuck', kind: 'flow' })] });
  assert.match(await callTool('send_back', { request: 1, reasons: 'Use today.', next: 'try-again' }, env, ME), /Flo will try/);
  assert.deepEqual(calls.map(c => c.body.event_type), ['dancer-wake', 'flo-wake']);
});

// ---- The preview job: what Cloud Dancer hands in is data, and nothing from her branch is run --------

import { readHandin, checkPull as checkPreviewPull, previewFrom, unsafe } from './preview.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a hand-in must name a pull request on the request\'s own repo, and a path on the site', () => {
  const good = { id: 7, understood: 'u', did: 'd', pr_url: 'https://github.com/Carrados/unremarkable/pull/9', path: '/prices/' };
  const h = readHandin(JSON.stringify(good), 7, 'Carrados/unremarkable');
  assert.equal(h.number, 9);
  assert.equal(h.path, '/prices/');
  assert.equal(readHandin(JSON.stringify({ ...good, path: undefined }), 7, 'Carrados/unremarkable').path, '/');
  assert.throws(() => readHandin('not json', 7, 'Carrados/unremarkable'));
  assert.throws(() => readHandin(JSON.stringify({ ...good, did: '' }), 7, 'Carrados/unremarkable'));
  assert.throws(() => readHandin(JSON.stringify({ ...good, pr_url: 'https://github.com/someone/else/pull/9' }), 7, 'Carrados/unremarkable'));
  assert.throws(() => readHandin(JSON.stringify({ ...good, path: '//evil.example/' }), 7, 'Carrados/unremarkable'));
  assert.throws(() => readHandin(JSON.stringify({ ...good, path: 'https://evil.example/' }), 7, 'Carrados/unremarkable'));
});

test('the preview job only takes an open pull request from that request\'s own branch, in the site\'s repo', () => {
  const repo = { full_name: 'Carrados/unremarkable', default_branch: 'main' };
  const pull = { state: 'open', base: { ref: 'main', repo }, head: { ref: 'dancer/request-7', sha: 'a'.repeat(40), repo } };
  assert.equal(checkPreviewPull(pull, 'Carrados/unremarkable', 7), '');
  assert.ok(checkPreviewPull(pull, 'Carrados/unremarkable', 8));
  assert.ok(checkPreviewPull({ ...pull, state: 'closed' }, 'Carrados/unremarkable', 7));
  assert.ok(checkPreviewPull({ ...pull, head: { ...pull.head, repo: { full_name: 'someone/fork' } } }, 'Carrados/unremarkable', 7));
  assert.ok(checkPreviewPull({ ...pull, head: { ...pull.head, sha: 'main' } }, 'Carrados/unremarkable', 7));
});

test('only the address wrangler printed for this request\'s alias counts as its preview', () => {
  const out = 'Uploaded unremarkable\nVersion Preview URL: https://1a2b3c4d-unremarkable.charlijotyrer.workers.dev\nVersion Preview Alias URL: https://dancer-7-unremarkable.charlijotyrer.workers.dev\n';
  assert.equal(previewFrom(out, 7), 'https://dancer-7-unremarkable.charlijotyrer.workers.dev');
  assert.equal(previewFrom(out, 70), null);
  assert.equal(previewFrom('no address here', 7), null);
});

test('a branch with a link to another file, or a settings file, is not uploaded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unsafe-'));
  mkdirSync(join(dir, 'site'));
  writeFileSync(join(dir, 'site', 'index.html'), '<h1>Hello</h1>');
  assert.equal(unsafe(dir), '');
  symlinkSync('/etc/passwd', join(dir, 'site', 'leak.txt'));
  assert.match(unsafe(dir), /link to another file/);
  const dir2 = mkdtempSync(join(tmpdir(), 'unsafe-'));
  writeFileSync(join(dir2, '.env'), 'CLOUDFLARE_API_BASE_URL=https://evil.example');
  assert.match(unsafe(dir2), /settings file/);
});
