-- Cloud Dancer's database: who owns which site, and what they have asked for.
-- The whole schema, for a new database. Later changes go in dancer/migrations/.
--   npx wrangler d1 execute cloud-dancer --remote --file schema.sql   (from the dancer folder)

-- A site's owners, by the email address they sign in with. One row for each owner of each site.
-- This is the only place an owner's address is kept: never in the repo.
CREATE TABLE IF NOT EXISTS owners (
  email TEXT NOT NULL,           -- lower case
  site TEXT NOT NULL,            -- the site's host, e.g. unremarkable.me: a key of SITES in dancer/sites.js
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (email, site)
);

-- What an owner has asked Cloud Dancer to change.
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  owner TEXT NOT NULL,           -- the email of the owner who asked
  site TEXT NOT NULL,
  page TEXT,                     -- the address of the page it is about, if they named one
  instruction TEXT NOT NULL,     -- what they asked for, in their words
  -- Where it stands:
  --   queued     waiting for Cloud Dancer to sort it (or, kind = 'fabric', for her to do the fabric)
  --   working    Cloud Dancer has it now, or Flo when kind = 'flow'
  --   flow       Cloud Dancer sorted it as flow and handed it to Flo, who hasn't started yet
  --   ready      a fabric change is made and on a preview copy; waiting for the owner to publish or send back
  --   retry      the owner sent it back with reasons: Flo tries again if kind = 'flow', otherwise Cloud Dancer
  --   stuck      Cloud Dancer couldn't do it by itself; why is in `understood`
  --   fabric     (before 12 November 2026 only) Flo left it as design work; send it back to have Cloud Dancer do it
  --   published  live: Flo posted it (flow), or the owner published it
  --   left       the owner decided to leave the site as it is
  status TEXT NOT NULL DEFAULT 'queued',
  status_at TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  understood TEXT,               -- what Cloud Dancer understood the owner to want (or why it stopped)
  did TEXT,                      -- what it changed
  wrote TEXT,                    -- anything Cloud Dancer wrote itself, such as a picture's description, for the owner to check
  branch TEXT,
  pr_url TEXT,
  preview_url TEXT,
  commit_sha TEXT,               -- the commit that was handed in: Publish merges this and nothing pushed after it
  owner_reason TEXT,             -- why the owner last sent it back
  kind TEXT,                     -- flow | fabric, once Cloud Dancer has sorted it (null until then)
  live_url TEXT                  -- where a flow change is live
);
CREATE INDEX IF NOT EXISTS requests_owner ON requests (owner, id);
CREATE INDEX IF NOT EXISTS requests_status ON requests (status, id);

-- What happened to a request, step by step, in plain words for the owner.
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests (id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  who TEXT NOT NULL,             -- dancer | flo | owner
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS steps_request ON steps (request_id, id);
