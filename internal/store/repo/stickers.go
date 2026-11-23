package repo

import "context"

// RecentStickers returns the newest sticker messages we have a file for, one per picture
// (stickers repeat a lot).
func RecentStickers(ctx context.Context, q DBTX, limit int) ([]int64, error) {
	return scanInts(q.QueryContext(ctx, `
		SELECT MAX(m.pk) FROM messages m JOIN media md ON md.message_pk = m.pk
		WHERE m.kind = 'sticker' AND md.local_path <> '' AND m.is_deleted = 0 AND m.raw IS NOT NULL
		GROUP BY md.file_sha256
		ORDER BY MAX(m.ts) DESC LIMIT ?`, limit))
}
