// Phix's way into her API, so the secret never appears in a command.
//
//   node phix/api.mjs claim
//   node phix/api.mjs step  '{"id": 12, "text": "..."}'
//   node phix/api.mjs ready '{"id": 12, "understood": "...", ...}'
//   node phix/api.mjs stuck '{"id": 12, "reason": "..."}'
//
// The body can also be a path to a JSON file, which is easier for long text:
//   node phix/api.mjs ready ready-12.json
//
// Prints the API's JSON answer. Exits with 1 if the API refused, so a failure is never silent.

import { readFileSync, existsSync } from 'node:fs';

const [action, arg] = process.argv.slice(2);
const ACTIONS = ['claim', 'step', 'ready', 'stuck'];
if (!ACTIONS.includes(action)) {
  console.error(`Usage: node phix/api.mjs <${ACTIONS.join('|')}> [JSON or path to a JSON file]`);
  process.exit(2);
}
const secret = process.env.PHIX_SECRET;
if (!secret) {
  console.error('PHIX_SECRET is not set.');
  process.exit(2);
}

let body = '{}';
if (arg) body = existsSync(arg) ? readFileSync(arg, 'utf8') : arg;
try { JSON.parse(body); } catch (e) {
  console.error(`That isn't valid JSON: ${e.message}`);
  process.exit(2);
}

const base = process.env.PHIX_API || 'https://unremarkable.me/phix/api';
const res = await fetch(`${base}/${action}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
  body,
});
const text = await res.text();
console.log(text);
if (!res.ok) {
  console.error(`The API answered ${res.status}.`);
  process.exitCode = 1;
}
