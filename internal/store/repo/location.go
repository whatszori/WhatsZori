package repo

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// Locations: a pin (LocationMessage) or a live location (LiveLocationMessage). A live one is
// sent again and again while it's shared; those updates go into the first message (its raw proto
// and loc_updated_at) instead of new bubbles.

// LiveLocationOf returns the live location in a stored raw proto.
func LiveLocationOf(raw []byte) (*waE2E.LiveLocationMessage, bool) {
	if raw == nil {
		return nil, false
	}
	var msg waE2E.Message
	if proto.Unmarshal(raw, &msg) != nil || msg.GetLiveLocationMessage() == nil {
		return nil, false
	}
	return msg.GetLiveLocationMessage(), true
}

// RecentLiveLocation finds sender's latest live location in chat sent after since.
func RecentLiveLocation(ctx context.Context, q DBTX, chat, sender string, since int64) (MessageRow, bool, error) {
	m, err := scanMessage(q.QueryRowContext(ctx, `SELECT `+msgCols+` FROM messages
		WHERE chat_jid = ? AND sender_jid = ? AND kind = ? AND ts >= ? AND is_deleted = 0
		ORDER BY ts DESC, pk DESC LIMIT 1`, chat, sender, KindLocation, since))
	if errors.Is(err, sql.ErrNoRows) {
		return m, false, nil
	}
	if err != nil {
		return m, false, err
	}
	if _, live := LiveLocationOf(m.Raw); !live {
		return m, false, nil
	}
	return m, true, nil
}

// UpdateLiveLocation stores a newer position of a live location.
func UpdateLiveLocation(ctx context.Context, q DBTX, pk int64, body string, raw []byte, at int64) error {
	_, err := q.ExecContext(ctx, `UPDATE messages SET body = ?, raw = ?, loc_updated_at = ? WHERE pk = ?`, body, raw, at, pk)
	return err
}

// locationInfo reads a location out of a stored message.
func locationInfo(m MessageRow) *domain.LocationInfo {
	if m.Raw == nil || m.Kind != KindLocation {
		return nil
	}
	var msg waE2E.Message
	if proto.Unmarshal(m.Raw, &msg) != nil {
		return nil
	}
	thumb := func(b []byte) string {
		if len(b) == 0 || len(b) > 256<<10 {
			return ""
		}
		return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(b)
	}
	if l := msg.GetLocationMessage(); l != nil {
		return &domain.LocationInfo{
			Lat: l.GetDegreesLatitude(), Lon: l.GetDegreesLongitude(),
			Name: l.GetName(), Address: l.GetAddress(), URL: l.GetURL(),
			Accuracy: int(l.GetAccuracyInMeters()), Thumb: thumb(l.GetJPEGThumbnail()),
		}
	}
	if l := msg.GetLiveLocationMessage(); l != nil {
		updated := m.LocUpdatedAt
		if updated == 0 {
			updated = m.TS
		}
		return &domain.LocationInfo{
			Lat: l.GetDegreesLatitude(), Lon: l.GetDegreesLongitude(),
			Live: true, Accuracy: int(l.GetAccuracyInMeters()), Speed: float64(l.GetSpeedInMps()),
			Heading: int(l.GetDegreesClockwiseFromMagneticNorth()), Sequence: l.GetSequenceNumber(),
			UpdatedAt: updated, Thumb: thumb(l.GetJPEGThumbnail()),
		}
	}
	return nil
}
