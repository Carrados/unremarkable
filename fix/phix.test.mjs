// Tests for the checks that keep "a person decides what goes live" true whatever Phix is told.
// Run with: node --test fix/phix.test.mjs
// Nothing here touches the network, the database or GitHub: each is a stand-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageUrl } from './common.js';
import { checkPull, previewUrl, phixApi, ownerPage } from './phix.js';

const SHA = 'a'.repeat(40);
const pull = (over = {}) => ({
  state: 'open', merged: false,
  head: { ref: 'phix/report-12', sha: SHA, repo: { full_name: 'Carrados/tka' } },
  base: { ref: 'main', repo: { full_name: 'Carrados/tka', default_branch: 'main' } },
  ...over,
});

test('the reported page must be on a site Unremarkable built', () => {
  assert.ok(pageUrl('https://carrados.com/reports/'));
  assert.ok(pageUrl('https://www.carrados.com/reports/'));
  assert.ok(pageUrl('https://tka.unremarkable.me/'));
  assert.equal(pageUrl('https://evil.example/'), null);
  // A look-alike domain: "www" then any one character used to be stripped as if it were "www."
  assert.equal(pageUrl('https://wwwxcarrados.com/'), null);
  assert.equal(pageUrl('https://wwwaunremarkable.me/'), null);
  assert.equal(pageUrl('https://carrados.com.evil.example/'), null);
  assert.equal(pageUrl('javascript:alert(1)'), null);
});

test('a preview copy must be on the account\'s own workers.dev address', () => {
  assert.ok(previewUrl('https://phix-12-tka.charlijotyrer.workers.dev/membership/'));
  assert.equal(previewUrl('https://evil.example/'), null);
  assert.equal(previewUrl('https://charlijotyrer.workers.dev.evil.example/'), null);
  assert.equal(previewUrl('https://evilcharlijotyrer.workers.dev/'), null);
  assert.equal(previewUrl('http://phix-12-tka.charlijotyrer.workers.dev/'), null);
  assert.equal(previewUrl('https://someone@phix-12-tka.charlijotyrer.workers.dev/'), null);
  assert.equal(previewUrl(''), null);
});

test('the pull request must be the report\'s own', () => {
  assert.equal(checkPull(pull(), 'Carrados/tka', 12), '');
  assert.match(checkPull(pull({ head: { ref: 'phix/report-12', sha: SHA, repo: { full_name: 'stranger/tka' } } }), 'Carrados/tka', 12), /another repo/);
  assert.match(checkPull(pull({ head: { ref: 'phix/report-12', sha: SHA, repo: null } }), 'Carrados/tka', 12), /another repo/);
  assert.match(checkPull(pull({ head: { ref: 'something-else', sha: SHA, repo: { full_name: 'Carrados/tka' } } }), 'Carrados/tka', 12), /must be on phix\/report-12/);
  assert.match(checkPull(pull(), 'Carrados/tka', 13), /must be on phix\/report-13/);
  assert.match(checkPull(pull({ state: 'closed' }), 'Carrados/tka', 12), /closed/);
  assert.match(checkPull(pull({ state: 'closed', merged: true }), 'Carrados/tka', 12), /already merged/);
  assert.match(checkPull(pull({ base: { ref: 'other', repo: { full_name: 'Carrados/tka', default_branch: 'main' } } }), 'Carrados/tka', 12), /must go into main/);
  assert.match(checkPull(pull(), 'Carrados/charli-jo', 12), /isn't on Carrados\/charli-jo/);
  assert.match(checkPull({}, 'Carrados/tka', 12), /no pull request/);
});

// ---- Stand-ins for the database, GitHub and the page templates ----

function fakeEnv(report, link) {
  const ran = [];
  const DB = {
    ran,
    prepare(sql) {
      const stmt = {
        args: [],
        bind(...a) { stmt.args = a; return stmt; },
        async first() {
          if (/FROM reports WHERE id/.test(sql)) return report;
          if (/FROM owner_links WHERE hash/.test(sql)) return link;
          return null;
        },
        async run() { ran.push({ sql, args: stmt.args }); return {}; },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
  };
  return {
    DB, PHIX_SECRET: 'test-secret', GITHUB_TOKEN: 'test-token',
    ASSETS: { fetch: async () => new Response('<title>Fix</title>{{OWNER}}') },
  };
}

// Answers GitHub calls from a table of "METHOD path" => [status, body], and records them.
function fakeGitHub(t, answers) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const key = `${init.method} ${String(url).replace('https://api.github.com', '')}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null });
    const [status, body] = answers[key] || [404, { message: 'Not Found' }];
    return new Response(JSON.stringify(body), { status });
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}

const quiet = t => { const { log, error } = console; console.log = console.error = () => {}; t.after(() => { console.log = log; console.error = error; }); };

const ready = (env, body) => phixApi(new Request('https://unremarkable.me/phix/api/ready', {
  method: 'POST', headers: { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env);

const handIn = {
  id: 12, understood: 'The menu button had no name.', did: 'Gave it one.', branch: 'phix/report-12',
  pr_url: 'https://github.com/Carrados/tka/pull/7', preview_url: 'https://phix-12-tka.charlijotyrer.workers.dev/',
};
const working = { id: 12, phix: 'working', page: 'https://tka.unremarkable.me/', what_happened: 'The menu button says nothing.' };

test('ready keeps the commit GitHub reports, and the branch GitHub reports', async t => {
  quiet(t);
  const env = fakeEnv(working);
  fakeGitHub(t, { 'GET /repos/Carrados/tka/pulls/7': [200, pull()] });
  const res = await ready(env, { ...handIn, branch: 'whatever-phix-said' });
  assert.equal(res.status, 200);
  const update = env.DB.ran.find(q => /UPDATE reports SET phix = 'owner'/.test(q.sql));
  assert.ok(update, 'the report moved on to the owner');
  assert.ok(update.args.includes(SHA), 'the commit is kept');
  assert.ok(update.args.includes('phix/report-12'), 'the branch is the one GitHub names');
  assert.ok(!update.args.includes('whatever-phix-said'));
});

test('ready refuses a pull request from a fork, another branch, or a preview somewhere else', async t => {
  quiet(t);
  for (const [answer, body, why] of [
    [pull({ head: { ref: 'phix/report-12', sha: SHA, repo: { full_name: 'stranger/tka' } } }), handIn, /another repo/],
    [pull({ head: { ref: 'main-takeover', sha: SHA, repo: { full_name: 'Carrados/tka' } } }), handIn, /must be on phix\/report-12/],
    [pull(), { ...handIn, preview_url: 'https://evil.example/' }, /preview_url must be/],
    [pull(), { ...handIn, pr_url: 'https://github.com/stranger/tka/pull/7' }, /pr_url must be a pull request on one of/],
  ]) {
    const env = fakeEnv(working);
    fakeGitHub(t, { 'GET /repos/Carrados/tka/pulls/7': [200, answer] });
    const res = await ready(env, body);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, why);
    assert.equal(env.DB.ran.length, 0, 'nothing was saved and the owner was not told');
  }
});

test('ready refuses when GitHub has no such pull request', async t => {
  quiet(t);
  const env = fakeEnv(working);
  fakeGitHub(t, {});
  const res = await ready(env, handIn);
  assert.equal(res.status, 400);
  assert.equal(env.DB.ran.length, 0);
});

const KEY = 'A'.repeat(22);
const publish = env => ownerPage(new Request(`https://unremarkable.me/fix/owner/${KEY}/`, {
  method: 'POST', body: new URLSearchParams({ decision: 'publish' }),
}), env, KEY);
const waiting = { ...working, phix: 'owner', pr_url: handIn.pr_url, preview_url: handIn.preview_url, understood: 'x', did: 'y', fix_ref: SHA };
const link = { hash: 'h', report_id: 12, expires_at: '2999-01-01T00:00:00Z', used_at: null };

test('Publish merges the commit that was handed in, and no other', async t => {
  quiet(t);
  const env = fakeEnv(waiting, link);
  const calls = fakeGitHub(t, { 'PUT /repos/Carrados/tka/pulls/7/merge': [200, { merged: true }] });
  const res = await publish(env);
  assert.equal(res.status, 200);
  assert.equal(calls[0].body.sha, SHA);
  assert.ok(env.DB.ran.some(q => /status = 'fixed'/.test(q.sql)));
});

test('Publish puts nothing live if the branch changed after the hand-in', async t => {
  quiet(t);
  const env = fakeEnv(waiting, link);
  fakeGitHub(t, { 'PUT /repos/Carrados/tka/pulls/7/merge': [409, { message: 'Head branch was modified. Review and try the merge again.' }] });
  const res = await publish(env);
  assert.equal(res.status, 409);
  assert.match(await res.text(), /altered after Phix handed it in/);
  assert.equal(env.DB.ran.length, 0, 'the report is not marked fixed and the link is not used up');
});

test('a fix handed in before this check existed still publishes', async t => {
  quiet(t);
  const env = fakeEnv({ ...waiting, fix_ref: null }, link);
  const calls = fakeGitHub(t, { 'PUT /repos/Carrados/tka/pulls/7/merge': [200, { merged: true }] });
  const res = await publish(env);
  assert.equal(res.status, 200);
  assert.equal('sha' in calls[0].body, false);
});

import { allowed } from './door-rules.js';

test('the door lets Cloud Dancer wake her own run or Flo\'s, and look at, merge and close pull requests on the site repos, and nothing else', () => {
  assert.equal(allowed('POST', '/repos/Carrados/unremarkable/dispatches', { event_type: 'flo-wake' }), true);
  assert.equal(allowed('POST', '/repos/Carrados/unremarkable/dispatches', { event_type: 'dancer-wake' }), true);
  assert.equal(allowed('POST', '/repos/Carrados/unremarkable/dispatches', { event_type: 'phix-wake' }), false);
  assert.equal(allowed('POST', '/repos/Carrados/tka/dispatches', { event_type: 'dancer-wake' }), false);
  assert.equal(allowed('POST', '/repos/Carrados/unremarkable/dispatches'), false);
  assert.equal(allowed('GET', '/repos/Carrados/unremarkable/pulls/5'), true);
  assert.equal(allowed('PUT', '/repos/Carrados/tka/pulls/5/merge', { sha: 'x' }), true);
  assert.equal(allowed('PATCH', '/repos/Carrados/unremarkable/pulls/5', { state: 'closed' }), true);
  assert.equal(allowed('PATCH', '/repos/Carrados/unremarkable/pulls/5', { state: 'closed', base: 'x' }), false);
  assert.equal(allowed('PUT', '/repos/stranger/unremarkable/pulls/5/merge', {}), false);
  assert.equal(allowed('DELETE', '/repos/Carrados/unremarkable/git/refs/heads/main'), false);
  assert.equal(allowed('PUT', '/repos/Carrados/unremarkable/contents/site/index.html', {}), false);
});

test('reports are deleted 12 months after they are sent, with their steps and owner links', async () => {
  const { forgetOldReports, KEEP_DAYS, DAY } = await import('./common.js');
  const calls = [];
  const env = { DB: {
    prepare: (sql) => ({ bind: (...args) => ({ sql, args }) }),
    batch: async (stmts) => { calls.push(...stmts); return [{}, {}, { meta: { changes: 2 } }]; },
  } };
  const at = Date.parse('2026-11-13T12:00:00Z');
  assert.equal(KEEP_DAYS, 365);
  assert.equal(await forgetOldReports(env, at), 2);
  assert.deepEqual(calls.map(c => c.sql.split(' ')[2]), ['steps', 'owner_links', 'reports']);
  const before = new Date(at - KEEP_DAYS * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');
  assert.equal(before, '2025-11-13T12:00:00Z');
  for (const c of calls) assert.deepEqual(c.args, [before]);
});
