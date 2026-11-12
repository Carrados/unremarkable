// Builds the pages of each fix Phix handed in, on a machine that holds no keys at all.
//
// Some sites keep their built pages in the repo and some build them when they are published. Building runs the
// site's own build code, from Phix's branch. That is code nobody has checked yet, so it runs here, in a job
// with no secrets, and never in the job that holds the keys (phix/preview.mjs). All that leaves this job is a
// plain archive of the built pages, assets-<id>.tar, and the commit it was built from, assets-<id>.sha.
//
//   WORK         [{"id": 12, "site": "carrados.com"}], from the claim step (before the agent ran)
//   HANDIN_DIR   where Phix's hand-in files were downloaded to
//   OUT_DIR      where to leave the archives

import { execFileSync } from 'node:child_process';
import { existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWork } from './sites.mjs';

const MAX_BUNDLE = 200 * 1024 * 1024;
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

function one({ id, repo, assets, build }, env) {
  const bundle = join(env.HANDIN_DIR, `report-${id}.bundle`);
  if (!existsSync(join(env.HANDIN_DIR, `ready-${id}.json`)) || !existsSync(bundle)) { console.log(`Report ${id}: nothing handed in.`); return; }
  if (statSync(bundle).size > MAX_BUNDLE) throw new Error('the change handed in was too big');
  const branch = `phix/report-${id}`;
  const dir = mkdtempSync(join(tmpdir(), `build-${id}-`));
  run('git', ['init', '-q'], dir);
  run('git', ['fetch', '-q', `https://github.com/${repo}`, 'HEAD'], dir);
  run('git', ['fetch', '-q', bundle, `refs/heads/${branch}`], dir);
  const sha = run('git', ['rev-parse', 'FETCH_HEAD'], dir).trim();
  run('git', ['-c', 'advice.detachedHead=false', 'checkout', '-q', sha], dir);
  if (build) {
    if (existsSync(join(dir, 'package-lock.json'))) run('npm', ['ci', '--no-audit', '--no-fund'], dir);
    run('npm', ['run', build], dir);
  }
  if (!existsSync(join(dir, assets))) throw new Error(`the built pages (${assets}) were not there`);
  run('tar', ['-cf', join(env.OUT_DIR, `assets-${id}.tar`), '-C', join(dir, assets), '.'], dir);
  writeFileSync(join(env.OUT_DIR, `assets-${id}.sha`), sha);
  console.log(`Report ${id}: built from ${sha}.`);
}

const env = process.env;
for (const k of ['WORK', 'HANDIN_DIR', 'OUT_DIR']) if (!env[k]) { console.error(`${k} is not set.`); process.exit(2); }
mkdirSync(env.OUT_DIR, { recursive: true });
// A fix that can't be built leaves no archive. The preview job sees that and tells the owner.
for (const w of readWork(env.WORK)) {
  try { one(w, env); } catch (e) { console.error(`Report ${w.id}: could not be built: ${e.message}`); }
}
