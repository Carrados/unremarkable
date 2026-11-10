-- Bug reports from the "Fix something on this page" form.
-- The whole current schema, for a new database. The live one is brought up to date by fix/migrations/.
-- Nothing here identifies the reporter: no name, no email, no IP address.
-- Instead, each report has a random key, and the reporter's own page is /fix/r/<key>/.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE,             -- the random key in the reporter's link; never shown anywhere else
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  site TEXT NOT NULL,            -- host of the reported page, e.g. unremarkable.me
  page TEXT NOT NULL,            -- full address of the reported page
  what_happened TEXT NOT NULL,
  expected TEXT,
  reading TEXT,                  -- how they were reading the page: the form's choices, comma-separated
  setup TEXT,                    -- anything more about their setup, in their words
  user_agent TEXT,               -- browser and device, from the request
  -- What happened next, filled in as the report is worked on.
  status TEXT NOT NULL DEFAULT 'open',  -- open | fixed | wont-fix | duplicate | spam
  fixed_at TEXT,                 -- when the fix went live; set it with status = 'fixed'. The reporter is asked
                                 -- whether it works, and after 30 days with no answer the report counts as closed
  understood TEXT,               -- what we understood the problem to be
  did TEXT,                      -- what we did about it
  fix_ref TEXT,                  -- commit or pull request that fixed it
  test_ref TEXT,                 -- the test added so it can't come back
  confirmed_by TEXT,             -- reporter | owner
  confirmed_at TEXT,
  reporter_notes TEXT,           -- what the reporter added from their page, e.g. "it still didn't work"
  rule TEXT,                     -- a rule for the builder this report taught, if any
  -- Phix (said "fix"), the agent that works on reports: see fix/phix.js and fix/migrations/0003-phix.sql.
  phix TEXT NOT NULL DEFAULT 'queued',  -- queued | working | owner | retry | stuck | done
  phix_at TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  branch TEXT,
  pr_url TEXT,
  preview_url TEXT,
  owner_reason TEXT
);
CREATE INDEX IF NOT EXISTS reports_status ON reports (status, created_at);
CREATE INDEX IF NOT EXISTS reports_site ON reports (site, created_at);
CREATE INDEX IF NOT EXISTS reports_phix ON reports (phix, created_at);

-- What happened to a report, step by step, in words for the person who reported it.
-- Shown on their page at /fix/r/<key>/. Nothing private goes here.
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports (id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  who TEXT NOT NULL,                 -- phix | owner | reporter
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS steps_report ON steps (report_id, id);

-- The owner's links, one per fix sent for approval. Only a hash of the key is kept,
-- so the database alone can't be used to publish anything. A link decides once, then expires.
CREATE TABLE IF NOT EXISTS owner_links (
  hash TEXT PRIMARY KEY,             -- SHA-256 of the key in the link, hex
  report_id INTEGER NOT NULL REFERENCES reports (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  decision TEXT                      -- published | retry | left
);
