package wa

import (
	"context"
	"errors"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/sticker"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

var ErrNotSticker = errors.New("not a sticker")

// SendSticker uploads a ready 512×512 WebP and sends it as a sticker.
func (s *Sender) SendSticker(ctx context.Context, chat string, webp []byte) (domain.Message, error) {
	if len(webp) == 0 || len(webp) > sticker.MaxBytes {
		return domain.Message{}, ErrNotSticker
	}
	cli, jid, err := s.prepare(ctx, chat, "")
	if err != nil {
		return domain.Message{}, err
	}
	up, err := cli.Upload(ctx, webp, whatsmeow.MediaImage)
	if err != nil {
		return domain.Message{}, errors.New("upload failed: " + sendErrorText(err))
	}
	media := &repo.MediaRow{MediaType: "image", Mime: "image/webp", Size: int64(len(webp)), Width: sticker.Size, Height: sticker.Size,
		MediaKey: up.MediaKey, DirectPath: up.DirectPath, FileSHA256: up.FileSHA256, FileEncSHA256: up.FileEncSHA256, State: repo.MediaRemote}
	if s.Media != nil {
		if rel, err := s.Media.Save(webp, up.FileSHA256, "image/webp", ""); err == nil {
			media.LocalPath, media.State = rel, repo.MediaLocal
		}
	}
	msg := &waE2E.Message{StickerMessage: &waE2E.StickerMessage{
		URL: proto.String(up.URL), DirectPath: proto.String(up.DirectPath), MediaKey: up.MediaKey,
		Mimetype: proto.String("image/webp"), FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256,
		FileLength: proto.Uint64(up.FileLength), Width: proto.Uint32(sticker.Size), Height: proto.Uint32(sticker.Size),
	}}
	return s.send(ctx, cli, jid, chat, msg, &repo.MessageRow{Kind: repo.KindSticker}, media)
}

// ResendSticker sends a sticker we already have in some chat again, pointing at the same file on
// WhatsApp's servers like the phone does from its recent stickers. Not marked as forwarded.
func (s *Sender) ResendSticker(ctx context.Context, pk int64, chat string) (domain.Message, error) {
	src, err := repo.GetMessage(ctx, s.DB, pk)
	if err != nil {
		return domain.Message{}, err
	}
	var orig waE2E.Message
	if src.Kind != repo.KindSticker || src.Raw == nil || proto.Unmarshal(src.Raw, &orig) != nil || orig.StickerMessage == nil {
		return domain.Message{}, ErrNotSticker
	}
	st := proto.Clone(orig.StickerMessage).(*waE2E.StickerMessage)
	st.ContextInfo = nil
	cli, jid, err := s.prepare(ctx, chat, "")
	if err != nil {
		return domain.Message{}, err
	}
	var media *repo.MediaRow
	if m, err := repo.GetMedia(ctx, s.DB, pk); err == nil {
		media = &m
	}
	return s.send(ctx, cli, jid, chat, &waE2E.Message{StickerMessage: st}, &repo.MessageRow{Kind: repo.KindSticker}, media)
}
