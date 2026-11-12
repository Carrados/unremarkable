// What the door (fix/door.js) lets Cloud Dancer do on GitHub. Kept apart so the tests can run it in Node.

import { REPOS } from './phix.js';

// What may pass, as [method, pattern]. `{repo}` must be one of REPOS.
const ALLOWED = [
  ['GET', /^\/repos\/([^/]+\/[^/]+)\/pulls\/\d+$/],          // look at a pull request
  ['PUT', /^\/repos\/([^/]+\/[^/]+)\/pulls\/\d+\/merge$/],   // merge it (publishing)
  ['PATCH', /^\/repos\/([^/]+\/[^/]+)\/pulls\/\d+$/],        // close it
];

export function allowed(method, path, body) {
  if (method === 'POST' && path === `/repos/${REPOS[0]}/dispatches`) return body && body.event_type === 'flo-wake';
  for (const [m, re] of ALLOWED) {
    const hit = re.exec(path);
    if (m === method && hit && REPOS.includes(hit[1])) {
      if (method === 'PATCH') return body && Object.keys(body).length === 1 && body.state === 'closed';
      return true;
    }
  }
  return false;
}
