// Tests for the checks that keep Phix's keys away from anything a stranger's report could reach.
// Run with: node --test phix/preview.test.mjs
// Nothing here touches the network, GitHub or Cloudflare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteOf, machinery, readWork } from './sites.mjs';
import { readHandin, previewFrom, badArchive } from './preview.mjs';

test('where a fix goes comes from the reported page, and only for sites Unremarkable built', () => {
  assert.equal(siteOf('unremarkable.me').repo, 'Carrados/unremarkable');
  assert.equal(siteOf('www.carrados.com').config, 'wrangler.carrados.jsonc');
  assert.equal(siteOf('blind-ant.com').build, 'build:blind-ant');
  assert.equal(siteOf('evil.example'), null);
  assert.deepEqual(readWork('[{"id":3,"site":"tka.unremarkable.me"},{"id":4,"site":"evil.example"},{"id":"5","site":"charli.info"}]').map(w => [w.id, w.repo]), [[3, 'Carrados/tka']]);
  assert.deepEqual(readWork('not json'), []);
});

test('a fix may not touch workflows, the agents\' files, Worker code or how a site is deployed', () => {
  assert.equal(machinery(['src/prices.html', 'site/prices/index.html', 'build.mjs', 'engine/build.mjs', 'site/fix/index.html']), '');
  assert.equal(machinery(['site/index.html', '.github/workflows/phix.yml']), '.github/workflows/phix.yml');
  assert.equal(machinery(['phix/PHIX.md']), 'phix/PHIX.md');
  assert.equal(machinery(['fix/worker.js']), 'fix/worker.js');
  assert.equal(machinery(['carrados/worker.js']), 'carrados/worker.js');
  assert.equal(machinery(['charli/mcp/indexer.js']), 'charli/mcp/indexer.js');
  assert.equal(machinery(['wrangler.zic.jsonc']), 'wrangler.zic.jsonc');
  assert.equal(machinery(['package-lock.json']), 'package-lock.json');
  assert.equal(machinery(['AGENTS.md']), 'AGENTS.md');
  for (const f of ['.mcp.json', 'site/.mcp.json', 'dist/carrados/.claude/settings.json', 'carrados/CLAUDE.md', 'CLAUDE.local.md', 'src/agents.md']) {
    assert.equal(machinery(['site/index.html', f]), f, f);
  }
});

test('a hand-in must say what was understood and changed, and give a path on the site', () => {
  const good = { id: 7, understood: 'u', did: 'd', title: 'a missing\nlabel', path: '/prices/', test_ref: 'build.mjs' };
  const h = readHandin(JSON.stringify(good), 7);
  assert.equal(h.title, 'a missing label');
  assert.equal(h.path, '/prices/');
  assert.equal(readHandin(JSON.stringify({ ...good, path: undefined }), 7).path, '/');
  assert.throws(() => readHandin('not json', 7));
  assert.throws(() => readHandin(JSON.stringify({ ...good, understood: '' }), 7));
  assert.throws(() => readHandin(JSON.stringify({ ...good, path: '//evil.example/' }), 7));
});

test('only the address wrangler printed for this report\'s alias counts as its preview', () => {
  const out = 'Version Preview URL: https://1a2b3c4d-carrados.charlijotyrer.workers.dev\nVersion Preview Alias URL: https://phix-7-carrados.charlijotyrer.workers.dev\n';
  assert.equal(previewFrom(out, 7), 'https://phix-7-carrados.charlijotyrer.workers.dev');
  assert.equal(previewFrom(out, 70), null);
});

test('built pages may hold plain files and folders, inside themselves, and nothing else', () => {
  const ok = 'drwxr-xr-x root/root 0 2026-11-12 14:00 ./\n-rw-r--r-- root/root 12 2026-11-12 14:00 ./index.html\n-rw-r--r-- root/root 12 2026-11-12 14:00 ./a page/index.html\n';
  assert.equal(badArchive(ok), '');
  assert.match(badArchive(ok + 'lrwxrwxrwx root/root 0 2026-11-12 14:00 ./leak -> /proc/self/environ\n'), /not a plain file/);
  assert.match(badArchive(ok + 'hrw-r--r-- root/root 0 2026-11-12 14:00 ./x link to ./index.html\n'), /not a plain file/);
  assert.match(badArchive('-rw-r--r-- root/root 12 2026-11-12 14:00 ../../etc/x\n'), /outside its own folder/);
  assert.match(badArchive('-rw-r--r-- root/root 12 2026-11-12 14:00 /etc/x\n'), /outside its own folder/);
});
