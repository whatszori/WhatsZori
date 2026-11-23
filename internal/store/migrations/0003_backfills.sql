-- one-time data fixes done in Go (they need to decode the raw protobuf), by name
CREATE TABLE backfills (
    name    TEXT PRIMARY KEY,
    done_at INTEGER NOT NULL
);
