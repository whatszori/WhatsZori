-- when a live location last moved (ms); 0 for everything else
ALTER TABLE messages ADD COLUMN loc_updated_at INTEGER NOT NULL DEFAULT 0;
