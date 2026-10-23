-- The admin Worker's state (src/core/d1-state.ts): changesets, fetched pages and their receipts, API
-- keys and the audit log, as JSON values by key. `ver` changes on every write, so update() can swap a
-- value only if nobody wrote it since it was read. `expires` is milliseconds since the epoch; expired
-- rows are invisible to reads and swept a few at a time.
CREATE TABLE IF NOT EXISTS state (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  ver INTEGER NOT NULL DEFAULT 0,
  expires INTEGER
);

CREATE INDEX IF NOT EXISTS state_expires ON state (expires);
