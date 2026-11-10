// Signing in to Cloud Dancer: the page an owner meets once, when they add the connector to their agent.
//
// There is no account and no password. The owner gives the email address their site is registered to,
// Cloud Dancer sends that address a six-figure code, and the code proves it is them. After that their
// agent holds the proof, and they don't meet this page again unless they remove the connector.
//
// The page is on Cloud Dancer's own address, never on the owner's site. While it is open it sets one
// short-lived cookie (from the OAuth library) that ties the form to the browser that opened it, so a
// link sent by someone else can't be finished for them. No site Unremarkable makes sets a cookie.

import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';

export const SCOPE = 'dancer:owner';
const CODE_MINUTES = 10;
const MAX_WRONG = 5;      // wrong codes before the code stops working
const MAX_SENDS = 3;      // codes sent for one sign-in
const MAX_PER_HOUR = 6;   // codes sent to one address in an hour

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const SECURITY = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

const STYLE = `:root{color-scheme:light dark;--ink:#1c1a1f;--paper:#fbf8f4;--accent:#9b1b4f;--line:#8a8490}
@media (prefers-color-scheme:dark){:root{--ink:#f6eff2;--paper:#17141a;--accent:#ff9cc0;--line:#8f8894}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:1.125rem/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:34rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}h1{font-size:1.9rem;line-height:1.2;margin:0 0 1rem}
.brand{font-weight:800;letter-spacing:.01em;margin:0 0 2rem;color:var(--accent)}label{display:block;font-weight:700;margin:1.5rem 0 .25rem}
.hint{margin:0 0 .5rem}input[type=email],input[type=text]{width:100%;font:inherit;padding:.7rem .8rem;border:2px solid var(--line);border-radius:.4rem;background:transparent;color:inherit}
button{font:inherit;font-weight:700;padding:.75rem 1.4rem;border-radius:.4rem;border:2px solid var(--accent);background:var(--accent);color:var(--paper);margin:1.5rem .75rem 0 0;cursor:pointer}
button.quiet{background:transparent;color:var(--accent)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.error{border-left:.4rem solid var(--accent);padding:.25rem 1rem;margin:1.5rem 0}.error h2{font-size:1.15rem;margin:.5rem 0 0}`;

function page(title, body, status = 200, headers = new Headers()) {
  // Headers passed in carry the sign-in cookie; the security headers are always ours.
  const h = new Headers(headers);
  for (const [k, v] of Object.entries(SECURITY)) h.set(k, v);
  return new Response(`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}: Cloud Dancer</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="brand">Cloud Dancer</p>
${body}
</main>
</body>
</html>`, { status, headers: h });
}

const problem = text => text ? `<div class="error" role="alert"><h2>There's a problem</h2><p>${esc(text)}</p></div>\n` : '';

// Who is asking, in words. A registered client's name is its own claim, so the page says where access will be sent.
function whoAsks(d) {
  const name = esc(d.clientName);
  const from = d.clientDomain ? `, published by <strong>${esc(d.clientDomain)}</strong>,` : '';
  const local = d.redirectIsLoopback ? '\n<p><strong>That is an app on this computer.</strong> Go on only if you have just started adding Cloud Dancer from it.</p>' : '';
  return `<p><strong>${name}</strong>${from} is asking to send Cloud Dancer your instructions and to publish changes to your site when you say so. Access will go to <strong>${esc(d.redirectHost)}</strong>.</p>${local}`;
}

function emailPage(d, handle, headers, v = {}) {
  return page(v.error ? 'Error: Sign in' : 'Sign in', `<h1>Sign in to Cloud Dancer</h1>
${problem(v.error)}${whoAsks(d)}
<p>There's no password. Give the email address your site is registered to, and we'll send it a code.</p>
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${esc(handle)}">
<input type="hidden" name="step" value="email">
<label for="email">Your email address</label>
<input type="email" id="email" name="email" value="${esc(v.email)}" required maxlength="320" autocomplete="email" autofocus>
<p><button type="submit">Send me a code</button></p>
</form>`, v.error ? 400 : 200, headers);
}

function codePage(handle, email, v = {}) {
  return page(v.error ? 'Error: Enter your code' : 'Enter your code', `<h1>Enter your code</h1>
${problem(v.error)}<p>If ${esc(email)} is the address a site is registered to, a six-figure code is on its way to it. It works for ${CODE_MINUTES} minutes.</p>
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${esc(handle)}">
<input type="hidden" name="step" value="code">
<label for="code">The code from the email</label>
<p class="hint" id="code-hint">Six figures. Spaces don't matter.</p>
<input type="text" id="code" name="code" required maxlength="12" inputmode="numeric" autocomplete="one-time-code" aria-describedby="code-hint" autofocus>
<p><button type="submit" name="decision" value="allow">Sign in and allow</button></p>
</form>
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${esc(handle)}">
<input type="hidden" name="step" value="email">
<input type="hidden" name="email" value="${esc(email)}">
<p><button type="submit" class="quiet">Send a new code</button></p>
</form>
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${esc(handle)}">
<input type="hidden" name="step" value="deny">
<p><button type="submit" class="quiet">Cancel</button></p>
</form>`, v.error ? 400 : 200);
}

const startAgain = (text, status = 400) => page('Start again', `<h1>Start again</h1>\n<p>${esc(text)}</p>\n<p>Go back to your agent and add Cloud Dancer again. That opens a fresh page.</p>`, status);

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

export const cleanEmail = raw => {
  const e = String(raw || '').trim().toLowerCase().slice(0, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
};

const dry = env => env.DANCER_DRY_RUN === '1';

async function sendCode(env, email, code, d) {
  const text = [
    `Your code for Cloud Dancer is ${code.slice(0, 3)} ${code.slice(3)}.`,
    '',
    `It works for ${CODE_MINUTES} minutes. Type it into the page that asked for it.`,
    '',
    `${d.clientName} asked for it, to send Cloud Dancer your instructions for your site.`,
    'If you didn\'t just add Cloud Dancer to your agent, ignore this email: nothing happens without the code.',
    'Nobody from Unremarkable will ever ask you for this code. Don\'t give it to anyone who does.',
    '',
    'Cloud Dancer',
    'The publishing agent at Unremarkable',
  ].join('\n');
  if (dry(env) || !env.OWNER_MAIL) {
    if (!dry(env)) console.error('Cloud Dancer: no email binding, so the code was not sent');
    else console.log(`[dry run] code for ${email}: ${code}`);
    return;
  }
  try {
    await env.OWNER_MAIL.send({ to: email, from: env.DANCER_FROM || 'dancer@unremarkable.me', subject: `${code.slice(0, 3)} ${code.slice(3)} is your Cloud Dancer code`, text });
  } catch (e) {
    console.error('Cloud Dancer: the code email failed', e?.message || e);
  }
}

// The state of one sign-in between its steps, kept for ten minutes under a hash of the form's handle.
const stateKey = async handle => `signin:${await sha256(handle)}`;
const hourKey = async email => `signin-hour:${await sha256(email)}:${Math.floor(Date.now() / 3600000)}`;

async function isOwner(env, email) {
  return !!(await env.DB.prepare('SELECT 1 AS yes FROM owners WHERE email = ? LIMIT 1').bind(email).first());
}

export async function authorize(request, env) {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      const req = await oauth.parseAuthRequest(request);
      const d = await oauth.describeConsent(req);
      const consent = await oauth.beginConsent(req);
      // What the later steps need to say who is asking, without trusting the form for it.
      await env.OAUTH_KV.put(await stateKey(consent.handle), JSON.stringify({ d: { clientName: d.clientName, clientDomain: d.clientDomain, redirectHost: d.redirectHost, redirectIsLoopback: d.redirectIsLoopback }, sends: 0 }), { expirationTtl: CODE_MINUTES * 60 + 60 });
      return emailPage(d, consent.handle, consent.headers);
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });

    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
      if (!success) return page('Too fast', '<h1>Too fast</h1>\n<p>Too many tries in a minute. Wait a moment, then go back and try again.</p>', 429);
    }

    const form = await request.formData();
    const handle = String(form.get('handle') || '').slice(0, 500);
    const step = String(form.get('step') || '');
    const key = await stateKey(handle);
    const state = handle ? await env.OAUTH_KV.get(key, 'json') : null;
    if (!state) return startAgain('This page has run out of time, or has already been used.');

    if (step === 'deny') {
      await env.OAUTH_KV.delete(key);
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }

    if (step === 'email') {
      const email = cleanEmail(form.get('email'));
      if (!email) return emailPage(state.d, handle, undefined, { email: String(form.get('email') || ''), error: 'Give an email address, like name@example.org.' });
      if (state.sends >= MAX_SENDS) return codePage(handle, email, { error: 'That\'s as many codes as one sign-in can have. Use the newest one, or cancel and start again.' });
      const hk = await hourKey(email);
      const sentThisHour = Number(await env.OAUTH_KV.get(hk)) || 0;
      const next = { ...state, sends: state.sends + 1, email, wrong: 0, hash: null };
      // An address that isn't an owner's gets the same page and no email, so the page never says who is an owner.
      if (sentThisHour < MAX_PER_HOUR && await isOwner(env, email)) {
        const code = newCode();
        next.hash = await sha256(`${handle}:${code}`);
        await env.OAUTH_KV.put(hk, String(sentThisHour + 1), { expirationTtl: 3700 });
        await sendCode(env, email, code, state.d);
      }
      await env.OAUTH_KV.put(key, JSON.stringify(next), { expirationTtl: CODE_MINUTES * 60 });
      return codePage(handle, email);
    }

    if (step === 'code') {
      if (!state.email) return startAgain('Give your email address first.');
      const code = String(form.get('code') || '').replace(/\D/g, '');
      const wrong = (state.wrong || 0) + 1;
      const right = !!state.hash && wrong <= MAX_WRONG && code.length === 6 && same(await sha256(`${handle}:${code}`), state.hash);
      if (!right) {
        if (wrong >= MAX_WRONG) {
          await env.OAUTH_KV.put(key, JSON.stringify({ ...state, wrong, hash: null }), { expirationTtl: CODE_MINUTES * 60 });
          return codePage(handle, state.email, { error: 'That code has stopped working after too many tries. Send a new code.' });
        }
        await env.OAUTH_KV.put(key, JSON.stringify({ ...state, wrong }), { expirationTtl: CODE_MINUTES * 60 });
        return codePage(handle, state.email, { error: 'That isn\'t the code. Check the newest email from Cloud Dancer and try again.' });
      }
      // The code is right, and still only an owner's address gets in.
      if (!(await isOwner(env, state.email))) return startAgain('That address no longer has a site in its name.', 403);
      await env.OAUTH_KV.delete(key);
      const approved = await oauth.approveConsent(request, handle, { scope: [SCOPE] });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: (await sha256(state.email)).slice(0, 32),
        metadata: {},
        scope: [SCOPE],
        props: { email: state.email },
      });
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }

    return startAgain('That page wasn\'t understood.');
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return startAgain(error.description || 'The request to sign in wasn\'t valid.');
    if (error instanceof CimdFetchError) return startAgain('The app asking to connect couldn\'t be checked.');
    throw error;
  }
}
