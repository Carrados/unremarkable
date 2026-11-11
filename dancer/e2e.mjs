// An end-to-end test of the sign-in and the five tools, against the connector running on this computer.
//   npx wrangler d1 execute cloud-dancer --local -c wrangler.local.jsonc --file schema.sql
//   npx wrangler d1 execute cloud-dancer --local -c wrangler.local.jsonc --command "INSERT OR IGNORE INTO owners (email, site) VALUES ('owner@example.org', 'unremarkable.me')"
//   npx wrangler dev -c wrangler.local.jsonc --port 8787 --local > dev.log 2>&1 &
//   node e2e.mjs dev.log
// wrangler.local.jsonc (not kept in the repo) is wrangler.jsonc without the route and the email binding, with
// vars DANCER_ORIGIN http://localhost:8787, DANCER_OPEN 1, DANCER_SECRET local-secret, and DANCER_DRY_RUN 1, which
// writes the code to the log in place of sending it and never calls GitHub.
// Start from an empty local database: the test expects its request to be number 1.

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
const B = 'http://localhost:8787', LOG = process.argv[2];
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const b64 = b => b.toString('base64url');
const lastCode = email => { const m = [...readFileSync(LOG, 'utf8').matchAll(new RegExp(`code for ${email.replace('.', '\\.')}: (\\d{6})`, 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const REDIR = 'https://claude.ai/api/mcp/auth_callback';

const reg = await (await fetch(`${B}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude <script>', redirect_uris: [REDIR], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json();
ok(!!reg.client_id, 'an agent can register');

async function start() {
  const verifier = b64(randomBytes(32)), challenge = b64(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIR, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'dancer:owner', resource: `${B}/mcp` });
  const res = await fetch(`${B}/authorize?${q}`, { redirect: 'manual' });
  const html = await res.text();
  const cookie = (res.headers.getSetCookie() || []).map(c => c.split(';')[0]).join('; ');
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
  return { verifier, res, html, cookie, handle };
}
const post = (cookie, fields) => fetch(`${B}/authorize`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });

// 1. The sign-in page
let s = await start();
ok(s.res.status === 200 && /Sign in to Cloud Dancer/.test(s.html), 'the sign-in page opens');
ok(!s.html.includes('<script>') && s.html.includes('claude.ai'), 'the agent\'s name is escaped and the destination is shown');
ok(!!s.cookie && !!s.handle, 'the form is tied to the browser');
ok(/script-src|default-src 'none'/.test(s.res.headers.get('content-security-policy') || ''), 'the page allows no scripts');
ok(!/form-action/.test(s.res.headers.get('content-security-policy') || ''), 'the page does not block the return to the agent (no form-action rule)');

// 2. Someone who is not an owner: same page, no code sent
let r = await post(s.cookie, { handle: s.handle, step: 'email', email: 'stranger@example.org' });
let t = await r.text(); await wait(300);
ok(r.status === 200 && /Enter your code/.test(t) && lastCode('stranger@example.org') === null, 'a stranger sees the same page and is sent nothing');
r = await post(s.cookie, { handle: s.handle, step: 'code', code: '123456' });
ok(r.status === 400, 'a stranger cannot get in with a guess');

// 3. An owner, wrong code then right code
s = await start();
r = await post(s.cookie, { handle: s.handle, step: 'email', email: ' Owner@Example.org ' }); await r.text(); await wait(300);
const code = lastCode('owner@example.org');
ok(!!code, 'an owner is sent a code');
r = await post(s.cookie, { handle: s.handle, step: 'code', code: code === '000000' ? '111111' : '000000' });
ok(r.status === 400 && /isn&#39;t the code/.test(await r.text()), 'a wrong code is refused');
// Another browser (no cookie) cannot finish this sign-in even with the right code
r = await post('', { handle: s.handle, step: 'code', code });
ok(r.status !== 302, 'the right code in another browser does not finish the sign-in');
// start afresh, since that attempt may have used up the form
s = await start();
r = await post(s.cookie, { handle: s.handle, step: 'email', email: 'owner@example.org' }); await r.text(); await wait(300);
const code2 = lastCode('owner@example.org');
r = await post(s.cookie, { handle: s.handle, step: 'code', code: `${code2.slice(0, 3)} ${code2.slice(3)}` });
const loc = r.headers.get('location') || '';
ok(r.status === 302 && loc.startsWith(REDIR) && loc.includes('state=xyz'), 'the right code signs the owner in and returns to the agent');
r = await post(s.cookie, { handle: s.handle, step: 'code', code: code2 });
ok(r.status !== 302, 'the same page cannot be used twice');

// 4. Tokens
const authCode = new URL(loc).searchParams.get('code');
let tok = await fetch(`${B}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: authCode, redirect_uri: REDIR, client_id: reg.client_id, code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier-123' }) });
ok(tok.status >= 400, 'the sign-in cannot be finished without the agent\'s own proof (PKCE)');
s = await start();
r = await post(s.cookie, { handle: s.handle, step: 'email', email: 'owner@example.org' }); await r.text(); await wait(300);
r = await post(s.cookie, { handle: s.handle, step: 'code', code: lastCode('owner@example.org') });
tok = await (await fetch(`${B}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: new URL(r.headers.get('location')).searchParams.get('code'), redirect_uri: REDIR, client_id: reg.client_id, code_verifier: s.verifier, resource: `${B}/mcp` }) })).json();
ok(!!tok.access_token && !!tok.refresh_token, 'the agent gets its token');

// 5. The connector
let n = 0;
const rpc = async (method, params, token = tok.access_token) => {
  const res = await fetch(`${B}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) });
  return res.status === 200 ? (await res.json()).result : { status: res.status };
};
const call = async (name, args = {}) => { const x = await rpc('tools/call', { name, arguments: args }); return { text: x.content[0].text, err: x.isError }; };
ok((await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).serverInfo.name === 'cloud-dancer', 'the connector answers');
ok((await rpc('tools/list')).tools.length === 5, 'it offers five tools');
ok((await rpc('tools/list', {}, 'not-a-token')).status === 401, 'a made-up token is refused');
let c = await call('my_sites');
ok(/unremarkable\.me/.test(c.text), 'my_sites lists the owner\'s site');
c = await call('request_change', { instruction: 'On the prices page, change "from £40" to "from £45".', page: 'https://unremarkable.me/prices/' });
ok(!c.err && /request 1\b/.test(c.text) && /starting now/.test(c.text), 'a request goes into the in-tray and Cloud Dancer is started');
c = await call('request_change', { instruction: 'x', site: 'carrados.com' });
ok(c.err && /isn't one of your sites/.test(c.text), 'a site that isn\'t theirs is refused');
c = await call('request_change', { instruction: 'x', page: 'https://wwwxunremarkable.me/' });
ok(c.err, 'a page on a look-alike address is refused');
c = await call('where_it_stands', { request: 1 });
ok(/Waiting for Cloud Dancer to start/.test(c.text) && /from £45/.test(c.text), 'where_it_stands gives the request in full');
c = await call('publish', { request: 1 });
ok(c.err && /can't be published/.test(c.text), 'a request with no change ready cannot be published');
c = await call('where_it_stands', { request: 999 });
ok(c.err && /no request number 999/.test(c.text), 'a request that isn\'t theirs cannot be seen');

// 6. Cloud Dancer's own run, through /agent/ (the local run is a dry run: GitHub is not called)
const agent = async (action, body, secret = 'local-secret') => {
  const res = await fetch(`${B}/agent/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: JSON.stringify(body || {}) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
ok((await agent('next', { repo: 'Carrados/unremarkable' }, 'wrong')).status === 401, 'the in-tray refuses a run without the secret');
ok((await agent('next', { repo: 'Carrados/elsewhere' })).status === 400, 'the in-tray refuses a repo it has no site in');
let a = await agent('next', { repo: 'Carrados/unremarkable' });
ok(a.request?.id === 1 && a.request.branch === 'dancer/request-1' && a.request.paths[0] === 'src/' && !('owner' in a.request), 'the run is given the request, its fence, and not the owner\'s address');
ok((await agent('next', { repo: 'Carrados/unremarkable' })).request === null, 'a request is given to one run only');
ok((await agent('step', { id: 1, text: 'Found the price on the Prices page.' })).ok, 'the run can add a step');
a = await agent('ready', { id: 1, understood: 'u', did: 'd', pr_url: 'https://github.com/Carrados/unremarkable/pull/9', preview_url: 'https://evil.example/' });
ok(a.status === 400, 'a preview copy somewhere else is refused');
a = await agent('ready', { id: 1, understood: 'u', did: 'd', pr_url: 'https://github.com/stranger/unremarkable/pull/9', preview_url: 'https://dancer-1-unremarkable.charlijotyrer.workers.dev/prices/' });
ok(a.status === 400, 'a pull request on another repo is refused');
a = await agent('ready', { id: 1, understood: 'You want the price to say from £45.', did: 'Changed the price on the Prices page.', wrote: '', pr_url: 'https://github.com/Carrados/unremarkable/pull/9', preview_url: 'https://dancer-1-unremarkable.charlijotyrer.workers.dev/prices/' });
ok(a.ok, 'the run can hand a change in');
c = await call('where_it_stands', { request: 1 });
ok(/Ready for you to check/.test(c.text) && /Changed the price on the Prices page/.test(c.text) && /dancer-1-unremarkable\.charlijotyrer\.workers\.dev\/prices\//.test(c.text) && /Found the price/.test(c.text), 'the owner hears what changed, the steps, and the preview address');
c = await call('send_back', { request: 1, reasons: 'Say "from £45 a month".', next: 'try-again' });
ok(!c.err && /try request 1 again/.test(c.text), 'the owner can send it back with reasons');
a = await agent('next', { repo: 'Carrados/unremarkable' });
ok(a.request?.id === 1 && a.request.tries === 2 && /a month/.test(a.request.owner_reason) && /Changed the price/.test(a.request.previous.did), 'the next run gets the owner\'s reasons and what was done before');
ok((await agent('stuck', { id: 1, reason: 'The Prices page gives two prices. Which one do you mean?' })).ok, 'the run can stop and ask');
ok((await agent('step', { id: 1, text: 'x' })).status === 404, 'a request that is no longer being worked on can\'t be touched by the run');
c = await call('where_it_stands', { request: 1 });
ok(/needs you/.test(c.text) && /Which one do you mean/.test(c.text), 'the owner hears why Cloud Dancer stopped');
c = await call('send_back', { request: 1, reasons: 'The monthly one.', next: 'try-again' });
a = await agent('next', { repo: 'Carrados/unremarkable' });
ok(a.request?.id === 1 && a.request.tries === 1 && /monthly/.test(a.request.owner_reason), 'answering a question gives Cloud Dancer a fresh set of tries');
a = await agent('ready', { id: 1, understood: 'u2', did: 'd2', pr_url: 'https://github.com/Carrados/unremarkable/pull/9', preview_url: 'https://dancer-1-unremarkable.charlijotyrer.workers.dev/prices/' });
c = await call('publish', { request: 1 });
ok(!c.err && /Published/.test(c.text), 'the owner can publish a ready change');
c = await call('publish', { request: 1 });
ok(c.err, 'and it can\'t be published twice');
c = await call('request_change', { instruction: 'Change the footer.' });
c = await call('send_back', { request: 2, reasons: 'Changed my mind.', next: 'leave-it' });
ok(!c.err && /closed/.test(c.text), 'a request can be closed with reasons');
c = await call('where_it_stands');
ok(/Request 2, unremarkable\.me/.test(c.text) && /Request 1, unremarkable\.me/.test(c.text), 'where_it_stands lists the requests');
