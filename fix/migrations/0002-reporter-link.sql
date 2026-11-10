-- Fix loop 2.0: no email, a private link instead (10 November 2026).
-- Every new report gets a random key; /fix/r/<key>/ shows the reporter their report and where it stands.
-- Run once against the live database, before the Worker that uses it goes live:
--   npx wrangler d1 execute unremarkable-fix --remote --file fix/migrations/0002-reporter-link.sql
ALTER TABLE reports ADD COLUMN token TEXT;
ALTER TABLE reports ADD COLUMN fixed_at TEXT;
ALTER TABLE reports ADD COLUMN reporter_notes TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS reports_token ON reports (token);
