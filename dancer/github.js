// The Worker's few calls to GitHub: start Cloud Dancer's run, look at a pull request, merge it, close it.
// GITHUB_TOKEN is a Worker secret: a fine-grained token on the site repos, Contents and Pull requests, read and write.

export const dry = env => env.DANCER_DRY_RUN === '1';
export const open = env => env.DANCER_OPEN === '1';

export async function github(env, method, path, body) {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cloud-dancer',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Start Cloud Dancer's run in the site's repo (.github/workflows/dancer.yml). True if GitHub took it.
// A run takes one request; when it hands in, the Worker wakes the next.
export async function wake(env, repo) {
  if (!open(env)) return false;
  if (dry(env)) { console.log(`[dry run] wake ${repo}`); return true; }
  if (!env.GITHUB_TOKEN) { console.error('Cloud Dancer: no GITHUB_TOKEN, so the run was not started'); return false; }
  try {
    const res = await github(env, 'POST', `/repos/${repo}/dispatches`, { event_type: 'dancer-wake' });
    if (!res.ok) console.error('Cloud Dancer: GitHub would not start the run', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error('Cloud Dancer: could not reach GitHub to start the run', e?.message || e);
    return false;
  }
}
