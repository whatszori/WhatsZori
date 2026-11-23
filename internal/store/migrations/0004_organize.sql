-- favourites and custom chat lists live only in WhatsZori (not synced with the phone)
ALTER TABLE chats ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;

CREATE TABLE chat_lists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE chat_list_members (
    list_id  INTEGER NOT NULL REFERENCES chat_lists (id) ON DELETE CASCADE,
    chat_jid TEXT    NOT NULL REFERENCES chats (jid) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (list_id, chat_jid)
);

-- who joined, left, was added, removed, promoted or demoted, as far as we saw it
CREATE TABLE group_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid  TEXT    NOT NULL,
    ts         INTEGER NOT NULL,
    -- add, remove, leave, join, promote, demote, create
    kind       TEXT    NOT NULL,
    actor_jid  TEXT    NOT NULL DEFAULT '',
    target_jid TEXT    NOT NULL DEFAULT '',
    UNIQUE (group_jid, ts, kind, actor_jid, target_jid)
);

CREATE INDEX group_events_group_ts ON group_events (group_jid, ts DESC);
