// The door between Cloud Dancer and GitHub.
//
// Cloud Dancer (dancer/, a Worker of its own) holds no keys. When it needs GitHub, to wake Flo, to look at
// a pull request she handed in, to merge it or to close it, it asks this Worker through a service binding
// (`SITE` in dancer/wrangler.jsonc). A service binding is reachable only by other Workers on the account
// that are bound to it, never from the web. This Worker already holds the token (GITHUB_TOKEN) for Phix.
//
// The door only lets through what Cloud Dancer needs, on the site repos, and nothing else.

import { WorkerEntrypoint } from 'cloudflare:workers';
import { allowed } from './door-rules.js';

export class Dancer extends WorkerEntrypoint {
  // Returns { status, body } (body as text), so nothing from GitHub's own object crosses the binding.
  async github(method, path, body) {
    if (!allowed(method, path, body)) return { status: 403, body: JSON.stringify({ message: 'Cloud Dancer may not do that.' }) };
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'cloud-dancer',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.text() };
  }
}
