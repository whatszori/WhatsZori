-- the latest vote of each person on a poll; options are the SHA-256 hashes WhatsApp sends, hex,
-- comma-separated (empty = vote taken back). Keyed by WA ids: votes can come before the poll.
CREATE TABLE poll_votes (
    chat_jid  TEXT    NOT NULL,
    poll_id   TEXT    NOT NULL,
    voter_jid TEXT    NOT NULL,
    options   TEXT    NOT NULL DEFAULT '',
    ts        INTEGER NOT NULL,
    PRIMARY KEY (chat_jid, poll_id, voter_jid)
);
