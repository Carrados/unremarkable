// Cloud Dancer's way into her own API (dancer/fabric.js). She proves who she is with this GitHub Actions run's
// own identity token (OIDC), so there is no secret to keep, print or leak. Only a run of .github/workflows/dancer.yml on
// main in Carrados/unremarkable is accepted (dancer/flo.js, checkClaims with DANCER_WORKFLOW).
//
//   node dancer/api.mjs claim
//   node dancer/api.mjs step  '{"id": 12, "text": "..."}'
//   node dancer/api.mjs flow  '{"id": 12, "reason": "..."}'
//   node dancer/api.mjs ready ready-12.json
//   node dancer/api.mjs stuck '{"id": 12, "reason": "..."}'
//
// Prints the API's JSON answer. Exits with 1 if the API refused, so a failure is never silent.

import { readFileSync, existsSync } from 'node:fs';

const AUDIENCE = 'https://dancer.unremarkable.me';
const ACTIONS = ['claim', 'step', 'flow', 'ready', 'stuck'];
const [action, arg] = process.argv.slice(2);
if (!ACTIONS.includes(action)) {
  console.error(`Usage: node dancer/api.mjs <${ACTIONS.join('|')}> [JSON or path to a JSON file]`);
  process.exit(2);
}

let body = '{}';
if (arg) body = existsSync(arg) ? readFileSync(arg, 'utf8') : arg;
try { JSON.parse(body); } catch (e) {
  console.error(`That isn't valid JSON: ${e.message}`);
  process.exit(2);
}

const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer } = process.env;
if (!url || !bearer) {
  console.error('No GitHub identity here: this only works inside a run of the Cloud Dancer workflow (it needs "id-token: write").');
  process.exit(2);
}
const minted = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, { headers: { Authorization: `bearer ${bearer}` } });
if (!minted.ok) {
  console.error(`GitHub wouldn't give this run an identity token (error ${minted.status}).`);
  process.exit(1);
}
const { value: token } = await minted.json();

const base = process.env.DANCER_API || `${AUDIENCE}/dancer/api`;
const res = await fetch(`${base}/${action}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body,
});
console.log(await res.text());
if (!res.ok) {
  console.error(`The API answered ${res.status}.`);
  process.exitCode = 1;
}
