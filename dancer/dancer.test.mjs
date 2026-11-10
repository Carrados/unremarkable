// Tests for the parts of Cloud Dancer that decide what an owner may see and what Publish may merge.
// Run with: npm test (from the dancer folder). The sign-in itself is tested end to end by e2e.mjs.
// Nothing here touches the network or a real database: each is a stand-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageOn, previewUrl } from './sites.js';
import { callTool } from './mcp.js';

const SHA = 'b'.repeat(40);

// A small stand-in for the database: owners and requests in memory, answering the queries mcp.js makes.
function fakeEnv({ owners = [['lottie@example.org', 'unremarkable.me']], requests = [] } = {}) {
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
          if (/SELECT \* FROM requests WHERE id = \? AND owner = \?/.test(sql)) return requests.find(r => r.id === st.a[0] && r.owner === st.a[1]) || null;
          if (/COUNT\(\*\)/.test(sql)) return col ? 0 : { n: 0 };
          if (/INSERT INTO requests/.test(sql)) { const r = { id: requests.length + 1, owner: st.a[0], site: st.a[1], page: st.a[2], instruction: st.a[3], status: 'queued', tries: 0, created_at: '2026-11-10T19:00:00Z' }; requests.push(r); return { id: r.id }; }
          return null;
        },
        async run() {
          if (/INSERT INTO steps/.test(sql)) steps.push({ request_id: st.a[0], who: st.a[1], text: st.a[2], at: '2026-11-10T19:00:00Z' });
          const m = /UPDATE requests SET status = '(\w+)'/.exec(sql);
          if (m) { const r = requests.find(x => x.id === st.a[st.a.length - 1]); r.status = m[1]; if (/owner_reason = \?/.test(sql)) r.owner_reason = st.a[1]; }
          return {};
        },
      };
      return st;
    },
  };
  return { DB, GITHUB_TOKEN: 't', DANCER_OPEN: '0' };
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
