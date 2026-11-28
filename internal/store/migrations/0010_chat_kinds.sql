-- disappearing messages: the chat's timer (seconds, 0 = off) and when it was set (ms), so an
-- older setting arriving late doesn't win
ALTER TABLE chats ADD COLUMN disappearing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN disappearing_at INTEGER NOT NULL DEFAULT 0;

-- communities: a community is a parent group; its groups point at it
ALTER TABLE chats ADD COLUMN is_community INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN parent_jid TEXT NOT NULL DEFAULT '';
-- the community's announcements group
ALTER TABLE chats ADD COLUMN is_announce INTEGER NOT NULL DEFAULT 0;

-- channels (jid ends in @newsletter): followers, the verified tick, our role (subscriber, admin...)
ALTER TABLE chats ADD COLUMN followers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN channel_role TEXT NOT NULL DEFAULT '';

-- a channel post's server id (reactions and views go by it) and its view count
ALTER TABLE messages ADD COLUMN server_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
-- a channel post's reactions: JSON {"emoji": count}; whose they are isn't shared
ALTER TABLE messages ADD COLUMN reaction_counts TEXT NOT NULL DEFAULT '';

-- messages to send later; sent ones are removed
CREATE TABLE scheduled (
    id         INTEGER PRIMARY KEY,
    chat_jid   TEXT    NOT NULL REFERENCES chats (jid) ON DELETE CASCADE ON UPDATE CASCADE,
    body       TEXT    NOT NULL,
    -- JSON list of mentioned JIDs
    mentions   TEXT    NOT NULL DEFAULT '[]',
    reply_to   INTEGER NOT NULL DEFAULT 0,
    -- ms
    send_at    INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    -- why the last try failed; it's tried again
    error      TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX scheduled_send_at ON scheduled (send_at);
