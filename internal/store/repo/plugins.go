package repo

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Plugin enable state lives in the extensions table, kind "plugin". A plugin found on disk with
// no row there is off: nothing runs until the user turns it on.

func PluginsEnabled(ctx context.Context, q DBTX) (map[string]bool, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, enabled FROM extensions WHERE kind = 'plugin'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		var on bool
		if err := rows.Scan(&id, &on); err != nil {
			return nil, err
		}
		out[id] = on
	}
	return out, rows.Err()
}

func SetPluginEnabled(ctx context.Context, q DBTX, id, version string, on bool) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO extensions (id, kind, version, enabled, installed_at) VALUES (?, 'plugin', ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, version = excluded.version`,
		id, version, b2i(on), time.Now().UnixMilli())
	return err
}

func PluginSettings(ctx context.Context, q DBTX, id string) (map[string]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT key, value FROM plugin_settings WHERE plugin_id = ?`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func SetPluginSetting(ctx context.Context, q DBTX, id, key, value string) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)
		ON CONFLICT (plugin_id, key) DO UPDATE SET value = excluded.value`, id, key, value)
	return err
}

func DeletePluginSetting(ctx context.Context, q DBTX, id, key string) error {
	_, err := q.ExecContext(ctx, `DELETE FROM plugin_settings WHERE plugin_id = ? AND key = ?`, id, key)
	return err
}

// PluginGet returns ok=false when the key isn't there.
func PluginGet(ctx context.Context, q DBTX, id, key string) (value []byte, ok bool, err error) {
	err = q.QueryRowContext(ctx, `SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?`, id, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	return value, err == nil, err
}

func PluginSet(ctx context.Context, q DBTX, id, key string, value []byte) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO plugin_storage (plugin_id, key, value) VALUES (?, ?, ?)
		ON CONFLICT (plugin_id, key) DO UPDATE SET value = excluded.value`, id, key, value)
	return err
}

func PluginDelete(ctx context.Context, q DBTX, id, key string) error {
	_, err := q.ExecContext(ctx, `DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?`, id, key)
	return err
}

func PluginKeys(ctx context.Context, q DBTX, id string) ([]string, error) {
	keys, err := scanStrings(q.QueryContext(ctx, `SELECT key FROM plugin_storage WHERE plugin_id = ? ORDER BY key`, id))
	if keys == nil {
		keys = []string{}
	}
	return keys, err
}
