-- Flo: what kind of change a request turned out to be, and where a flow change is live.
--   npx wrangler d1 execute cloud-dancer --remote --file migrations/0001-flo.sql   (from the dancer folder)
ALTER TABLE requests ADD COLUMN kind TEXT;
ALTER TABLE requests ADD COLUMN live_url TEXT;
