-- Phix (said "fix"), the agent that works on reports (10 November 2026).
-- Run once against the live database, after 0002 and before the Worker that uses it goes live:
--   npx wrangler d1 execute unremarkable-fix --remote --file fix/migrations/0003-phix.sql

-- Where each report is with Phix:
--   queued   waiting for Phix's next wake-up (06:00 and midday, UK time)
--   working  Phix has it now
--   owner    a fix is ready on a preview copy; waiting for the owner to publish or reject it
--   retry    the owner rejected the fix, or the reporter said it still doesn't work: Phix tries again
--   stuck    Phix couldn't fix it by itself; the owner has been told
--   done     published, left as it is, or closed
ALTER TABLE reports ADD COLUMN phix TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE reports ADD COLUMN phix_at TEXT;        -- when phix last changed
ALTER TABLE reports ADD COLUMN tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN branch TEXT;         -- the branch Phix made the fix on
ALTER TABLE reports ADD COLUMN pr_url TEXT;         -- the pull request Publish merges
ALTER TABLE reports ADD COLUMN preview_url TEXT;    -- the preview copy of the page with the fix
ALTER TABLE reports ADD COLUMN owner_reason TEXT;   -- why the owner last rejected a fix, for Phix
-- Reports already dealt with are not Phix's work.
UPDATE reports SET phix = 'done' WHERE status <> 'open';
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
