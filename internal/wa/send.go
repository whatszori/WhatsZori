package wa

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/redact"
	"github.com/whatszori/WhatsZori/internal/store"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/voice"
)

// These are implemented elsewhere (privacy, antispam, ingest, media); interfaces here keep wa
// free of import cycles.
type (
	SendGate interface {
		BeforeSend(ctx context.Context, chat types.JID) error
	}
	Limiter interface {
		Allow(chat, text string) error
	}
	Local interface {
		Me(ctx context.Context) string
		ApplyLocalEdit(ctx context.Context, chat, msgID, text string, at int64) error
		ApplyLocalRevoke(ctx context.Context, chat string, isGroup bool, msgID string, at int64) error
		ApplyLocalReaction(ctx context.Context, chat, msgID, emoji string, at int64) error
		ApplyLocalVote(ctx context.Context, chat, pollID string, options [][]byte, at int64) error
	}
	MediaSaver interface {
		Save(data, sum []byte, mimeType, fileName string) (string, error)
	}
)

const (
	maxTextRunes = 65536
	// what WhatsApp itself accepts for photos and documents
	maxImageBytes    = 16 << 20
	maxDocumentBytes = 100 << 20
)

var (
	ErrEmpty      = errors.New("message is empty")
	ErrTooLong    = errors.New("message is too long")
	ErrNotOwn     = errors.New("you can only change your own messages")
	ErrEditWindow = errors.New("messages can only be edited for 20 minutes after sending")
	ErrNotText    = errors.New("only text messages can be edited")
)

type Sender struct {
	DB      *sql.DB
	Ready   func() (Client, error)
	Gate    SendGate
	Limiter Limiter
	Local   Local
	Media   MediaSaver
	Emit    Emitter
	Log     *slog.Logger
	Now     func() time.Time
	// Async runs the network part of a send; tests make it synchronous
	Async func(func())
}

func (s *Sender) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Sender) async(fn func()) {
	if s.Async != nil {
		s.Async(fn)
		return
	}
	go fn()
}

func (s *Sender) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

func (s *Sender) view(ctx context.Context) repo.View { return repo.View{Me: s.Local.Me(ctx)} }

// prepare runs the checks every outgoing message goes through: connected, rate limit, and the
// privacy gate's "mark read before replying".
func (s *Sender) prepare(ctx context.Context, chat, text string) (Client, types.JID, error) {
	cli, err := s.Ready()
	if err != nil {
		return nil, types.EmptyJID, err
	}
	jid, err := ForSend(chat)
	if err != nil {
		return nil, types.EmptyJID, fmt.Errorf("bad chat: %w", err)
	}
	if err := s.Limiter.Allow(chat, text); err != nil {
		return nil, types.EmptyJID, err
	}
	if err := s.Gate.BeforeSend(ctx, jid); err != nil {
		// a failed read receipt shouldn't stop the reply
		s.log().Warn("read receipts before send", "error", redact.Digits(err.Error()))
	}
	return cli, jid, nil
}

// SendText sends text, optionally as a reply and with mentions: JIDs of group members whose
// "@<user part>" is in the text (the app writes those tokens in place of the names it shows).
func (s *Sender) SendText(ctx context.Context, chat, text string, replyToPK int64, mentions ...string) (domain.Message, error) {
	text = strings.TrimRight(text, " \t\r\n")
	if strings.TrimSpace(text) == "" {
		return domain.Message{}, ErrEmpty
	}
	if utf8.RuneCountInString(text) > maxTextRunes {
		return domain.Message{}, ErrTooLong
	}
	cli, jid, err := s.prepare(ctx, chat, text)
	if err != nil {
		return domain.Message{}, err
	}
	msg := &waE2E.Message{Conversation: proto.String(text)}
	row := &repo.MessageRow{Kind: repo.KindText, Body: text}
	mentioned := mentionsIn(chat, text, mentions)
	if len(mentioned) > 0 {
		msg = &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text:        proto.String(text),
			ContextInfo: &waE2E.ContextInfo{MentionedJID: mentioned},
		}}
	}
	if replyToPK > 0 {
		q, err := repo.GetMessage(ctx, s.DB, replyToPK)
		if err != nil {
			return domain.Message{}, fmt.Errorf("reply target: %w", err)
		}
		if q.ChatJID != chat {
			return domain.Message{}, errors.New("reply target is in another chat")
		}
		ci := s.quote(ctx, cli, q)
		ci.MentionedJID = mentioned
		msg = &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text:        proto.String(text),
			ContextInfo: ci,
		}}
		row.QuotedID, row.QuotedSender = q.MsgID, q.SenderJID
	}
	return s.send(ctx, cli, jid, chat, msg, row, nil)
}

// quote builds the context info for a reply: the quoted stanza id, who wrote it, and the quoted
// message itself so other clients can render the preview without having it.
func (s *Sender) quote(ctx context.Context, cli Client, q repo.MessageRow) *waE2E.ContextInfo {
	participant := q.SenderJID
	if q.FromMe {
		participant = cli.OwnID().String()
	}
	ci := &waE2E.ContextInfo{StanzaID: proto.String(q.MsgID), Participant: proto.String(participant)}
	if q.Raw != nil {
		var quoted waE2E.Message
		if proto.Unmarshal(q.Raw, &quoted) == nil {
			quoted.MessageContextInfo = nil
			ci.QuotedMessage = &quoted
		}
	}
	if ci.QuotedMessage == nil && q.Body != "" {
		ci.QuotedMessage = &waE2E.Message{Conversation: proto.String(q.Body)}
	}
	return ci
}

// send stores the message as pending, returns it, and does the network part in the background:
// pending -> sent here, delivered/read later from receipts.
func (s *Sender) send(ctx context.Context, cli Client, jid types.JID, chat string, msg *waE2E.Message, row *repo.MessageRow, media *repo.MediaRow) (domain.Message, error) {
	if secs, at := repo.DisappearingOf(ctx, s.DB, chat); secs > 0 {
		withExpiration(msg, secs, at)
		row.IsEphemeral = true
	}
	raw, err := proto.Marshal(msg)
	if err != nil {
		return domain.Message{}, err
	}
	id := cli.GenerateMessageID()
	row.ChatJID, row.MsgID, row.SenderJID, row.FromMe = chat, id, s.Local.Me(ctx), true
	row.TS, row.Status, row.ReadSent, row.Raw = s.now().UnixMilli(), string(domain.StatusPending), true, raw

	err = store.InTx(ctx, s.DB, func(tx *sql.Tx) error {
		if err := repo.EnsureChat(ctx, tx, chat, jid.Server == types.GroupServer); err != nil {
			return err
		}
		if _, _, err := repo.InsertMessage(ctx, tx, row); err != nil {
			return err
		}
		if media != nil {
			media.MessagePK = row.PK
			if err := repo.UpsertMedia(ctx, tx, *media); err != nil {
				return err
			}
		}
		return repo.BumpLastTS(ctx, tx, chat, row.TS)
	})
	if err != nil {
		return domain.Message{}, err
	}
	v := s.view(ctx)
	dto, err := v.Message(ctx, s.DB, row.PK)
	if err != nil {
		return domain.Message{}, err
	}
	s.emitChat(ctx, chat)

	pk := row.PK
	s.async(func() {
		sctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		resp, err := cli.SendMessage(sctx, jid, msg, id)
		status := domain.StatusSent
		if err != nil {
			status = domain.StatusFailed
			s.log().Warn("send failed", "id", id, "error", redact.Digits(err.Error()))
			s.Emit.Emit(evToast, domain.ToastEvent{Kind: "error", Text: "Message not sent: " + sendErrorText(err)})
		}
		bg := context.Background()
		// don't step on a receipt that already moved it further
		cur, gerr := repo.GetMessage(bg, s.DB, pk)
		if gerr == nil && (cur.Status == string(domain.StatusPending) || status == domain.StatusFailed) {
			_ = repo.SetStatus(bg, s.DB, pk, string(status))
			s.Emit.Emit(evMsgStatus, domain.MsgStatusEvent{ChatJID: chat, PK: strconv.FormatInt(pk, 10), Status: status})
		}
		if err == nil && !resp.Timestamp.IsZero() {
			_ = repo.SetSentTS(bg, s.DB, pk, resp.Timestamp.UnixMilli())
		}
		s.emitChat(bg, chat)
	})
	return dto, nil
}

func sendErrorText(err error) string {
	switch {
	case errors.Is(err, whatsmeow.ErrRecipientNotOnWhatsApp):
		return "this number isn't on WhatsApp"
	case errors.Is(err, whatsmeow.ErrNoPermissionInGroup):
		return "only admins can send messages in this group"
	case errors.Is(err, context.DeadlineExceeded):
		return "WhatsApp didn't answer in time"
	}
	return "WhatsApp returned an error"
}

const (
	evMsgStatus  = "msg:status"
	evChatUpdate = "chat:update"
)

func (s *Sender) emitChat(ctx context.Context, chat string) {
	c, err := repo.GetChat(ctx, s.DB, chat)
	if err != nil {
		return
	}
	if dto, err := s.view(ctx).Chat(ctx, s.DB, c); err == nil {
		s.Emit.Emit(evChatUpdate, domain.ChatUpdateEvent{Chat: dto})
	}
}

func (s *Sender) own(ctx context.Context, pk int64) (repo.MessageRow, types.JID, error) {
	m, err := repo.GetMessage(ctx, s.DB, pk)
	if err != nil {
		return m, types.EmptyJID, err
	}
	if !m.FromMe {
		return m, types.EmptyJID, ErrNotOwn
	}
	jid, err := ForSend(m.ChatJID)
	return m, jid, err
}

// Edit sends a new version of one of our text messages, built with whatsmeow's edit builder.
func (s *Sender) Edit(ctx context.Context, pk int64, text string) error {
	text = strings.TrimRight(text, " \t\r\n")
	if strings.TrimSpace(text) == "" {
		return ErrEmpty
	}
	m, jid, err := s.own(ctx, pk)
	if err != nil {
		return err
	}
	if m.Kind != repo.KindText || m.IsDeleted {
		return ErrNotText
	}
	if s.now().Sub(time.UnixMilli(m.TS)) > whatsmeow.EditWindow {
		return ErrEditWindow
	}
	if text == m.Body {
		return nil
	}
	cli, err := s.Ready()
	if err != nil {
		return err
	}
	if _, err := cli.SendMessage(ctx, jid, cli.BuildEdit(jid, m.MsgID, &waE2E.Message{Conversation: proto.String(text)}), ""); err != nil {
		return fmt.Errorf("edit not sent: %s", sendErrorText(err))
	}
	return s.Local.ApplyLocalEdit(ctx, m.ChatJID, m.MsgID, text, s.now().UnixMilli())
}

// Revoke deletes one of our messages for everyone. Locally it's kept (marked deleted) like any
// other revoke, if "keep deleted messages" is on.
func (s *Sender) Revoke(ctx context.Context, pk int64) error {
	m, jid, err := s.own(ctx, pk)
	if err != nil {
		return err
	}
	if m.IsDeleted {
		return nil
	}
	cli, err := s.Ready()
	if err != nil {
		return err
	}
	if _, err := cli.SendMessage(ctx, jid, cli.BuildRevoke(jid, types.EmptyJID, m.MsgID), ""); err != nil {
		return fmt.Errorf("delete not sent: %s", sendErrorText(err))
	}
	return s.Local.ApplyLocalRevoke(ctx, m.ChatJID, jid.Server == types.GroupServer, m.MsgID, s.now().UnixMilli())
}

// React sets our reaction. The same emoji again removes it, like tapping it twice on the phone.
func (s *Sender) React(ctx context.Context, pk int64, emoji string) ([]domain.Reaction, error) {
	m, err := repo.GetMessage(ctx, s.DB, pk)
	if err != nil {
		return nil, err
	}
	jid, err := ForSend(m.ChatJID)
	if err != nil {
		return nil, err
	}
	me := s.Local.Me(ctx)
	if cur, err := repo.MyReaction(ctx, s.DB, m.ChatJID, m.MsgID, me); err == nil && cur == emoji {
		emoji = ""
	}
	cli, err := s.Ready()
	if err != nil {
		return nil, err
	}
	sender := types.EmptyJID
	if !m.FromMe {
		if sender, err = types.ParseJID(m.SenderJID); err != nil {
			return nil, err
		}
	}
	if _, err := cli.SendMessage(ctx, jid, cli.BuildReaction(jid, sender, m.MsgID, emoji), ""); err != nil {
		return nil, fmt.Errorf("reaction not sent: %s", sendErrorText(err))
	}
	if err := s.Local.ApplyLocalReaction(ctx, m.ChatJID, m.MsgID, emoji, s.now().UnixMilli()); err != nil {
		return nil, err
	}
	dto, err := s.view(ctx).Message(ctx, s.DB, pk)
	if err != nil {
		return nil, err
	}
	return dto.Reactions, nil
}

// SendFile sends a photo (jpeg/png) or, for anything else, a document.
func (s *Sender) SendFile(ctx context.Context, chat, name string, data []byte, caption string, asDocument bool) (domain.Message, error) {
	if len(data) == 0 {
		return domain.Message{}, ErrEmpty
	}
	mimeType := http.DetectContentType(data)
	isImage := !asDocument && (mimeType == "image/jpeg" || mimeType == "image/png")
	if isImage && len(data) > maxImageBytes {
		isImage = false // too big for a photo, send it as a file instead
	}
	if len(data) > maxDocumentBytes {
		return domain.Message{}, fmt.Errorf("files can be at most %d MB", maxDocumentBytes>>20)
	}
	if !isImage {
		if byExt := docMime(name); byExt != "" {
			mimeType = byExt
		}
	}
	cli, jid, err := s.prepare(ctx, chat, caption)
	if err != nil {
		return domain.Message{}, err
	}
	mt := whatsmeow.MediaDocument
	if isImage {
		mt = whatsmeow.MediaImage
	}
	up, err := cli.Upload(ctx, data, mt)
	if err != nil {
		return domain.Message{}, fmt.Errorf("upload failed: %s", sendErrorText(err))
	}
	media := &repo.MediaRow{Mime: mimeType, Size: int64(len(data)), MediaKey: up.MediaKey, DirectPath: up.DirectPath,
		FileSHA256: up.FileSHA256, FileEncSHA256: up.FileEncSHA256, State: repo.MediaRemote}
	if rel, err := s.Media.Save(data, up.FileSHA256, mimeType, name); err == nil {
		media.LocalPath, media.State = rel, repo.MediaLocal
	}
	row := &repo.MessageRow{Body: caption}
	var msg *waE2E.Message
	if isImage {
		var w, h int
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
			w, h = cfg.Width, cfg.Height
		}
		media.MediaType, media.Width, media.Height = "image", w, h
		row.Kind = repo.KindImage
		msg = &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
			URL: proto.String(up.URL), DirectPath: proto.String(up.DirectPath), MediaKey: up.MediaKey,
			Mimetype: proto.String(mimeType), FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256,
			FileLength: proto.Uint64(up.FileLength), Width: proto.Uint32(uint32(w)), Height: proto.Uint32(uint32(h)),
		}}
		if caption != "" {
			msg.ImageMessage.Caption = proto.String(caption)
		}
	} else {
		base := filepath.Base(name)
		media.MediaType, media.FileName = "document", base
		row.Kind = repo.KindDocument
		msg = &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
			URL: proto.String(up.URL), DirectPath: proto.String(up.DirectPath), MediaKey: up.MediaKey,
			Mimetype: proto.String(mimeType), FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256,
			FileLength: proto.Uint64(up.FileLength), FileName: proto.String(base), Title: proto.String(base),
		}}
		if caption != "" {
			msg.DocumentMessage.Caption = proto.String(caption)
		}
	}
	return s.send(ctx, cli, jid, chat, msg, row, media)
}

// SendVoice sends a voice note recorded in the webview (WebM/Opus). WhatsApp wants Ogg/Opus with
// the PTT flag; the audio is rewrapped, not re-encoded. waveform is 0..100 per bar.
func (s *Sender) SendVoice(ctx context.Context, chat string, webm []byte, waveform []byte) (domain.Message, error) {
	ogg, secs, err := voice.ToOgg(webm)
	if err != nil {
		return domain.Message{}, fmt.Errorf("couldn't prepare the recording: %w", err)
	}
	if secs < 0.5 {
		return domain.Message{}, errors.New("the recording is too short")
	}
	cli, jid, err := s.prepare(ctx, chat, "")
	if err != nil {
		return domain.Message{}, err
	}
	up, err := cli.Upload(ctx, ogg, whatsmeow.MediaAudio)
	if err != nil {
		return domain.Message{}, fmt.Errorf("upload failed: %s", sendErrorText(err))
	}
	const mime = "audio/ogg; codecs=opus"
	seconds := max(1, int(secs+0.5))
	media := &repo.MediaRow{MediaType: "audio", Mime: mime, Size: int64(len(ogg)), Duration: seconds,
		Waveform: waveform, MediaKey: up.MediaKey, DirectPath: up.DirectPath, FileSHA256: up.FileSHA256,
		FileEncSHA256: up.FileEncSHA256, State: repo.MediaRemote}
	if rel, err := s.Media.Save(ogg, up.FileSHA256, mime, ""); err == nil {
		media.LocalPath, media.State = rel, repo.MediaLocal
	}
	msg := &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
		URL: proto.String(up.URL), DirectPath: proto.String(up.DirectPath), MediaKey: up.MediaKey,
		Mimetype: proto.String(mime), FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256,
		FileLength: proto.Uint64(up.FileLength), Seconds: proto.Uint32(uint32(seconds)), PTT: proto.Bool(true),
		Waveform: waveform,
	}}
	return s.send(ctx, cli, jid, chat, msg, &repo.MessageRow{Kind: repo.KindVoice}, media)
}

var docMimes = map[string]string{
	".pdf": "application/pdf", ".txt": "text/plain", ".zip": "application/zip",
	".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".mp3": "audio/mpeg", ".mp4": "video/mp4", ".ogg": "audio/ogg", ".csv": "text/csv", ".json": "application/json",
}

func docMime(name string) string { return docMimes[strings.ToLower(filepath.Ext(name))] }

// mentionsIn keeps the mentions that make sense: in a group, a valid person JID, whose token is
// in the text, each once. Anything else is dropped rather than sent as a broken mention.
func mentionsIn(chat, text string, jids []string) []string {
	if !strings.HasSuffix(chat, "@g.us") || len(jids) == 0 {
		return nil
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(jids))
	for _, j := range jids {
		pj, err := types.ParseJID(j)
		if err != nil || pj.User == "" || (pj.Server != types.DefaultUserServer && pj.Server != types.HiddenUserServer) {
			continue
		}
		j = pj.ToNonAD().String()
		if seen[j] || !strings.Contains(text, "@"+pj.User) {
			continue
		}
		seen[j] = true
		out = append(out, j)
	}
	return out
}
