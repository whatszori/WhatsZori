-- what the user allowed a plugin: {"permissions": [...], "network": [...], "key": "<signing key>"}
ALTER TABLE extensions ADD COLUMN granted TEXT NOT NULL DEFAULT '';
