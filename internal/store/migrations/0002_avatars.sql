-- profile pictures, one row per JID and size; the image itself is a file in <config>/avatars
CREATE TABLE avatars (
    jid        TEXT    NOT NULL,
    -- preview (~96 px) or full
    variant    TEXT    NOT NULL,
    -- WhatsApp's picture id, sent back so the server can answer "unchanged"
    picture_id TEXT    NOT NULL DEFAULT '',
    -- relative to <config>/avatars; empty when there's no picture
    local_path TEXT    NOT NULL DEFAULT '',
    -- set, none (no picture), hidden (their privacy settings)
    state      TEXT    NOT NULL DEFAULT 'none',
    checked_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (jid, variant)
);
