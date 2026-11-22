-- Times are unix milliseconds. JIDs are canonical (see internal/wa/jid.go): phone-number JIDs
-- when the LID mapping is known, LIDs otherwise, groups as-is, never with a device suffix.

CREATE TABLE chats (
    jid          TEXT PRIMARY KEY,
    name         TEXT    NOT NULL DEFAULT '',
    is_group     INTEGER NOT NULL DEFAULT 0,
    pinned       INTEGER NOT NULL DEFAULT 0,
    archived     INTEGER NOT NULL DEFAULT 0,
    -- 0 = not muted, -1 = forever, otherwise mute end
    muted_until  INTEGER NOT NULL DEFAULT 0,
    unread       INTEGER NOT NULL DEFAULT 0,
    last_ts      INTEGER NOT NULL DEFAULT 0,
    description  TEXT    NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL DEFAULT 0,
    created_by   TEXT    NOT NULL DEFAULT '',
    member_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX chats_last_ts ON chats (last_ts DESC);

CREATE TABLE contacts (
    jid           TEXT PRIMARY KEY,
    lid           TEXT    NOT NULL DEFAULT '',
    push_name     TEXT    NOT NULL DEFAULT '',
    full_name     TEXT    NOT NULL DEFAULT '',
    first_name    TEXT    NOT NULL DEFAULT '',
    business_name TEXT    NOT NULL DEFAULT '',
    about         TEXT    NOT NULL DEFAULT '',
    updated_at    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX contacts_lid ON contacts (lid) WHERE lid <> '';

CREATE TABLE group_participants (
    group_jid      TEXT    NOT NULL REFERENCES chats (jid) ON DELETE CASCADE ON UPDATE CASCADE,
    member_jid     TEXT    NOT NULL,
    is_admin       INTEGER NOT NULL DEFAULT 0,
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_jid, member_jid)
);

CREATE TABLE messages (
    pk             INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_jid       TEXT    NOT NULL REFERENCES chats (jid) ON DELETE CASCADE ON UPDATE CASCADE,
    msg_id         TEXT    NOT NULL,
    sender_jid     TEXT    NOT NULL,
    from_me        INTEGER NOT NULL DEFAULT 0,
    push_name      TEXT    NOT NULL DEFAULT '',
    ts             INTEGER NOT NULL,
    -- text, extended, image, video, audio, voice, document, sticker, location, contact, poll, unknown
    kind           TEXT    NOT NULL,
    body           TEXT    NOT NULL DEFAULT '',
    quoted_id      TEXT    NOT NULL DEFAULT '',
    quoted_sender  TEXT    NOT NULL DEFAULT '',
    -- outgoing only: pending, sent, delivered, read, failed
    status         TEXT    NOT NULL DEFAULT '',
    -- incoming only: we (or another of our devices) already sent a read receipt
    read_sent      INTEGER NOT NULL DEFAULT 0,
    is_deleted     INTEGER NOT NULL DEFAULT 0,
    deleted_at     INTEGER NOT NULL DEFAULT 0,
    deleted_by     TEXT    NOT NULL DEFAULT '',
    -- sender | admin
    delete_kind    TEXT    NOT NULL DEFAULT '',
    -- the revoke arrived first; stays 1 even after the original fills the row in
    is_placeholder INTEGER NOT NULL DEFAULT 0,
    edit_count     INTEGER NOT NULL DEFAULT 0,
    edited_at      INTEGER NOT NULL DEFAULT 0,
    is_ephemeral   INTEGER NOT NULL DEFAULT 0,
    is_view_once   INTEGER NOT NULL DEFAULT 0,
    -- the unwrapped waE2E.Message; NULL when we never had the content or it was purged
    raw            BLOB,
    UNIQUE (chat_jid, msg_id)
);

CREATE INDEX messages_chat_ts ON messages (chat_jid, ts, pk);
CREATE INDEX messages_unread ON messages (chat_jid, from_me, read_sent) WHERE from_me = 0 AND read_sent = 0;

-- version 0 is the original text, saved on the first edit
CREATE TABLE message_edits (
    message_pk INTEGER NOT NULL REFERENCES messages (pk) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    body       TEXT    NOT NULL,
    edited_at  INTEGER NOT NULL,
    PRIMARY KEY (message_pk, version)
);

CREATE TABLE media (
    message_pk      INTEGER PRIMARY KEY REFERENCES messages (pk) ON DELETE CASCADE,
    -- whatsmeow MediaType: image, video, audio, document (stickers are image)
    media_type      TEXT    NOT NULL,
    mime            TEXT    NOT NULL DEFAULT '',
    file_name       TEXT    NOT NULL DEFAULT '',
    size            INTEGER NOT NULL DEFAULT 0,
    width           INTEGER NOT NULL DEFAULT 0,
    height          INTEGER NOT NULL DEFAULT 0,
    duration        INTEGER NOT NULL DEFAULT 0,
    waveform        BLOB,
    media_key       BLOB,
    direct_path     TEXT    NOT NULL DEFAULT '',
    file_sha256     BLOB,
    file_enc_sha256 BLOB,
    thumbnail       BLOB,
    -- relative to <config>/media, forward slashes
    local_path      TEXT    NOT NULL DEFAULT '',
    -- remote, local, expired, failed
    state           TEXT    NOT NULL DEFAULT 'remote'
);

-- keyed by WA ids, not pk: reactions and receipts can arrive before the message they point at
CREATE TABLE reactions (
    chat_jid   TEXT    NOT NULL,
    msg_id     TEXT    NOT NULL,
    sender_jid TEXT    NOT NULL,
    emoji      TEXT    NOT NULL,
    ts         INTEGER NOT NULL,
    PRIMARY KEY (chat_jid, msg_id, sender_jid)
);

CREATE TABLE receipts (
    chat_jid        TEXT    NOT NULL,
    msg_id          TEXT    NOT NULL,
    participant_jid TEXT    NOT NULL,
    -- delivered, read, played
    type            TEXT    NOT NULL,
    ts              INTEGER NOT NULL,
    PRIMARY KEY (chat_jid, msg_id, participant_jid, type)
);

CREATE VIRTUAL TABLE messages_fts USING fts5 (
    body,
    content = 'messages',
    content_rowid = 'pk',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, body) VALUES (new.pk, new.body);
END;

CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', old.pk, old.body);
END;

CREATE TRIGGER messages_fts_au AFTER UPDATE OF body ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', old.pk, old.body);
    INSERT INTO messages_fts (rowid, body) VALUES (new.pk, new.body);
END;

CREATE TABLE extensions (
    id           TEXT PRIMARY KEY,
    -- plugin | theme
    kind         TEXT    NOT NULL,
    version      TEXT    NOT NULL DEFAULT '',
    enabled      INTEGER NOT NULL DEFAULT 0,
    installed_at INTEGER NOT NULL DEFAULT 0,
    manifest     TEXT    NOT NULL DEFAULT '{}'
);

CREATE TABLE plugin_settings (
    plugin_id TEXT NOT NULL,
    key       TEXT NOT NULL,
    value     TEXT NOT NULL,
    PRIMARY KEY (plugin_id, key)
);

CREATE TABLE plugin_storage (
    plugin_id TEXT NOT NULL,
    key       TEXT NOT NULL,
    value     BLOB,
    PRIMARY KEY (plugin_id, key)
);
