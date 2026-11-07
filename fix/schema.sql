-- Bug reports from the "Fix something on this page" form.
-- Nothing here identifies the reporter: no name, no email, no IP address.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  site TEXT NOT NULL,            -- host of the reported page, e.g. unremarkable.me
  page TEXT NOT NULL,            -- full address of the reported page
  what_happened TEXT NOT NULL,
  expected TEXT,
  reading TEXT,                  -- how they were reading the page (one of the form's choices)
  setup TEXT,                    -- anything more about their setup, in their words
  user_agent TEXT,               -- browser and device, from the request
  -- What happened next, filled in as the report is worked on.
  status TEXT NOT NULL DEFAULT 'open',  -- open | fixed | wont-fix | duplicate | spam
  understood TEXT,               -- what we understood the problem to be
  did TEXT,                      -- what we did about it
  fix_ref TEXT,                  -- commit or pull request that fixed it
  test_ref TEXT,                 -- the test added so it can't come back
  confirmed_by TEXT,             -- reporter | owner
  confirmed_at TEXT,
  rule TEXT                      -- a rule for the builder this report taught, if any
);
CREATE INDEX IF NOT EXISTS reports_status ON reports (status, created_at);
CREATE INDEX IF NOT EXISTS reports_site ON reports (site, created_at);
