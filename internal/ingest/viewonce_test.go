package ingest

import (
	"context"
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func TestViewOnce(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.policy.AutoDownload = false // view-once is fetched anyway

	video := &waE2E.Message{VideoMessage: &waE2E.VideoMessage{
		DirectPath: proto.String("/v/vo"), MediaKey: []byte{1}, Mimetype: proto.String("video/mp4"),
		FileLength: proto.Uint64(40 << 20), ViewOnce: proto.Bool(true),
	}}
	evt := &events.Message{Info: info(alice, alice, "VO1"), RawMessage: &waE2E.Message{
		ViewOnceMessageV2: &waE2E.FutureProofMessage{Message: video},
	}}
	evt.UnwrapRaw()
	e.handle(t, evt)
	// the phone-only kind: flagged on the media, no keys
	e.handle(t, &events.Message{Info: info(alice, alice, "VO2"), Message: &waE2E.Message{
		ImageMessage: &waE2E.ImageMessage{ViewOnce: proto.Bool(true), Mimetype: proto.String("image/jpeg")},
	}})

	if len(e.media.queued) != 1 {
		t.Errorf("queued: %v", e.media.queued)
	}
	v := repo.View{Me: me.String()}
	for id, unavailable := range map[string]bool{"VO1": false, "VO2": true} {
		m, err := v.Message(ctx, e.db, e.msg(t, alice, id).PK)
		if err != nil {
			t.Fatal(err)
		}
		if !m.ViewOnce || m.Media == nil || m.Media.Unavailable != unavailable {
			t.Errorf("%s: viewOnce=%v media=%+v", id, m.ViewOnce, m.Media)
		}
		if id == "VO1" && m.Kind != domain.KindVideo {
			t.Errorf("kind %q", m.Kind)
		}
	}
}
