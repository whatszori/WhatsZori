-- statuses opened in WhatsZori (with or without telling the poster); the rest show as new
CREATE TABLE status_seen (
    message_pk INTEGER PRIMARY KEY REFERENCES messages (pk) ON DELETE CASCADE,
    seen_at    INTEGER NOT NULL
);
