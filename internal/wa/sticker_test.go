package wa_test

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/sticker"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

func TestSendAndResendSticker(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.s.Media = saver{}
	var pic bytes.Buffer
	png.Encode(&pic, image.NewNRGBA(image.Rect(0, 0, 40, 40)))
	webp, err := sticker.Prepare(pic.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	m, err := e.s.SendSticker(ctx, alice.String(), webp)
	if err != nil {
		t.Fatal(err)
	}
	if m.Kind != domain.KindSticker || m.Media == nil || m.Media.Width != 512 {
		t.Fatalf("sticker message: %+v %+v", m, m.Media)
	}
	st := e.cli.sent[0].msg.GetStickerMessage()
	if st.GetMimetype() != "image/webp" || st.GetDirectPath() != "/v/x" || len(e.cli.uploaded) != 1 {
		t.Errorf("stanza: %v", st)
	}

	// someone's sticker, sent on to bob without uploading anything
	bob := types.NewJID("491700000002", types.DefaultUserServer)
	err = e.in.Handle(&events.Message{
		Info: types.MessageInfo{MessageSource: types.MessageSource{Chat: alice, Sender: alice}, ID: "ST", Timestamp: time.Now()},
		Message: &waE2E.Message{StickerMessage: &waE2E.StickerMessage{
			DirectPath: proto.String("/v/theirs"), MediaKey: []byte{9}, Mimetype: proto.String("image/webp"),
			ContextInfo: &waE2E.ContextInfo{StanzaID: proto.String("Q")},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	row, _ := repo.GetMessageByID(ctx, e.db, alice.String(), "ST")
	if _, err := e.s.ResendSticker(ctx, row.PK, bob.String()); err != nil {
		t.Fatal(err)
	}
	again := e.cli.sent[1].msg.GetStickerMessage()
	if again.GetDirectPath() != "/v/theirs" || again.GetContextInfo() != nil || len(e.cli.uploaded) != 1 {
		t.Errorf("resent: %v (uploads %d)", again, len(e.cli.uploaded))
	}
}
