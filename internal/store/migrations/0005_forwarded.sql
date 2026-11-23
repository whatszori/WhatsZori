-- WhatsApp's forwarding score: 0 = not forwarded, 1+ = how many hops; 5+ is "forwarded many times"
ALTER TABLE messages ADD COLUMN forward_score INTEGER NOT NULL DEFAULT 0;
