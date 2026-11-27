package services

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/core"
	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/uploads"
	"github.com/whatszori/WhatsZori/internal/wa"
)

const callTimeout = 30 * time.Second

func call() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), callTimeout)
}

func parsePK(s string) (int64, error) {
	pk, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || pk <= 0 {
		return 0, fmt.Errorf("bad message id %q", s)
	}
	return pk, nil
}

// Auth also owns the WhatsApp lifecycle: the client starts and stops with this service.
type Auth struct{ c *core.Core }

func NewAuth(c *core.Core) *Auth { return &Auth{c: c} }

func (a *Auth) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	// not ctx: Wails cancels it right after startup returns, and the client has to outlive that
	return a.c.Start(context.Background())
}

func (a *Auth) ServiceShutdown() error {
	a.c.Stop()
	return nil
}

func (a *Auth) GetState() domain.AuthStatus { return a.c.Mgr.Status() }

func (a *Auth) GetConnState() domain.ConnState { return a.c.Mgr.Conn() }

func (a *Auth) StartQRLogin() error {
	ctx, cancel := call()
	defer cancel()
	return a.c.Mgr.StartQR(ctx)
}

func (a *Auth) PairWithPhone(phone string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	return a.c.Mgr.PairPhone(ctx, phone)
}

// Logout unlinks this device. With wipe, our local history and media go too.
func (a *Auth) Logout(wipe bool) error {
	ctx, cancel := call()
	defer cancel()
	if err := a.c.Mgr.Logout(ctx); err != nil {
		return err
	}
	if wipe {
		return a.c.Wipe(ctx)
	}
	return nil
}

type Chats struct{ c *core.Core }

func NewChats(c *core.Core) *Chats { return &Chats{c: c} }

func (s *Chats) ListChats() ([]domain.Chat, error) {
	ctx, cancel := call()
	defer cancel()
	return s.c.View(ctx).Chats(ctx, s.c.DB)
}

func (s *Chats) emitChat(ctx context.Context, jid string) {
	row, err := repo.GetChat(ctx, s.c.DB, jid)
	if err != nil {
		return
	}
	if dto, err := s.c.View(ctx).Chat(ctx, s.c.DB, row); err == nil {
		s.c.Emit.Emit(events.ChatUpdate, domain.ChatUpdateEvent{Chat: dto})
	}
}

// MarkRead is "the user is looking at this chat". The local unread count always clears; whether
// WhatsApp hears about it is up to the privacy gate.
func (s *Chats) MarkRead(jid string) error {
	ctx, cancel := call()
	defer cancel()
	return s.c.MarkChatRead(ctx, jid)
}

// SetActive is the chat open in the window ("" for none), so notifications skip it.
func (s *Chats) SetActive(jid string) {
	s.c.Notify.SetActive(jid)
}

// SetTyping is the composer telling us the user is (or stopped) typing.
func (s *Chats) SetTyping(jid string, typing bool) error {
	if _, err := s.c.Mgr.Ready(); err != nil {
		return nil
	}
	j, err := types.ParseJID(jid)
	if err != nil {
		return err
	}
	ctx, cancel := call()
	defer cancel()
	return s.c.Gate.Typing(ctx, j, typing)
}

// chat flags go to WhatsApp first (app state, so the phone matches), then into our db
func (s *Chats) patch(jid string, build func(types.JID) appstate.PatchInfo, local func(ctx context.Context) error) error {
	ctx, cancel := call()
	defer cancel()
	cli, err := s.c.Mgr.Ready()
	if err != nil {
		return err
	}
	j, err := types.ParseJID(jid)
	if err != nil {
		return err
	}
	if err := cli.SendAppState(ctx, build(j)); err != nil {
		return fmt.Errorf("WhatsApp didn't take the change: %w", err)
	}
	if err := local(ctx); err != nil {
		return err
	}
	s.emitChat(ctx, jid)
	return nil
}

func (s *Chats) SetPinned(jid string, pinned bool) error {
	return s.patch(jid, func(j types.JID) appstate.PatchInfo { return appstate.BuildPin(j, pinned) },
		func(ctx context.Context) error { return repo.SetPinned(ctx, s.c.DB, jid, pinned) })
}

func (s *Chats) SetArchived(jid string, archived bool) error {
	return s.patch(jid, func(j types.JID) appstate.PatchInfo {
		var ts time.Time
		if last, err := repo.LastMessage(context.Background(), s.c.DB, jid); err == nil {
			ts = time.UnixMilli(last.TS)
		}
		return appstate.BuildArchive(j, archived, ts, nil)
	}, func(ctx context.Context) error {
		if archived {
			// archiving unpins, same as on the phone
			if err := repo.SetPinned(ctx, s.c.DB, jid, false); err != nil {
				return err
			}
		}
		return repo.SetArchived(ctx, s.c.DB, jid, archived)
	})
}

func (s *Chats) SetMuted(jid string, muted bool) error {
	return s.patch(jid, func(j types.JID) appstate.PatchInfo { return appstate.BuildMute(j, muted, 0) },
		func(ctx context.Context) error {
			until := int64(0)
			if muted {
				until = -1
			}
			return repo.SetMutedUntil(ctx, s.c.DB, jid, until)
		})
}

func (s *Chats) GetInfo(jid string) (domain.ChatInfo, error) {
	ctx, cancel := call()
	defer cancel()
	info, err := s.c.View(ctx).ChatInfo(ctx, s.c.DB, jid)
	if err != nil {
		return info, err
	}
	if info.Members == nil && !strings.HasSuffix(jid, "@g.us") {
		info.Blocked = s.isBlocked(ctx, jid)
	}
	// a 1:1 "about" we never saw: ask once, it's cheap and cached in contacts
	if info.Members == nil && info.About == "" {
		if cli, err := s.c.Mgr.Ready(); err == nil {
			if j, err := types.ParseJID(jid); err == nil {
				about, err := cli.GetAbout(ctx, j)
				switch {
				case err != nil:
					slog.Warn("couldn't read a contact's about", "error", err)
				case about != "":
					_ = repo.SetAbout(ctx, s.c.DB, jid, about, time.Now().UnixMilli())
					info.About = about
				}
			}
		}
	}
	return info, nil
}

// FilePicker asks the user for a file to send. The app wires it to the native dialog.
type FilePicker interface {
	PickFile(title string) (string, error)
}

// FilesPicker is the dialog that lets the user pick several files at once.
type FilesPicker interface {
	PickFiles(title string) ([]string, error)
}

type Messages struct {
	c       *core.Core
	picker  FilesPicker
	uploads *uploads.Store
}

func NewMessages(c *core.Core, picker FilesPicker, up *uploads.Store) *Messages {
	return &Messages{c: c, picker: picker, uploads: up}
}

// GetMessages pages backwards from beforePk ("" for the newest).
func (s *Messages) GetMessages(jid, beforePk string, limit int) (domain.MessagePage, error) {
	ctx, cancel := call()
	defer cancel()
	var before int64
	if beforePk != "" {
		var err error
		if before, err = parsePK(beforePk); err != nil {
			return domain.MessagePage{}, err
		}
	}
	rows, more, err := repo.Page(ctx, s.c.DB, jid, before, limit)
	if err != nil {
		return domain.MessagePage{}, err
	}
	msgs, err := s.c.View(ctx).Messages(ctx, s.c.DB, rows)
	if err != nil {
		return domain.MessagePage{}, err
	}
	return domain.MessagePage{Messages: msgs, HasMore: more}, nil
}

func (s *Messages) GetEditHistory(pk string) ([]domain.EditVersion, error) {
	ctx, cancel := call()
	defer cancel()
	id, err := parsePK(pk)
	if err != nil {
		return nil, err
	}
	edits, err := repo.Edits(ctx, s.c.DB, id)
	if err != nil {
		return nil, err
	}
	out := make([]domain.EditVersion, 0, len(edits))
	for _, e := range edits {
		out = append(out, domain.EditVersion{Text: e.Body, At: e.EditedAt})
	}
	if len(out) == 0 {
		// edit history was off: all we have is the current text
		if m, err := repo.GetMessage(ctx, s.c.DB, id); err == nil && m.EditCount > 0 {
			out = append(out, domain.EditVersion{Text: m.Body, At: m.EditedAt})
		}
	}
	return out, nil
}

func (s *Messages) SendText(jid, text, replyToPk string) (domain.Message, error) {
	ctx, cancel := call()
	defer cancel()
	var reply int64
	if replyToPk != "" {
		var err error
		if reply, err = parsePK(replyToPk); err != nil {
			return domain.Message{}, err
		}
	}
	return s.c.Sender.SendText(ctx, jid, text, reply)
}

func (s *Messages) Edit(pk, text string) error {
	ctx, cancel := call()
	defer cancel()
	id, err := parsePK(pk)
	if err != nil {
		return err
	}
	return s.c.Sender.Edit(ctx, id, text)
}

func (s *Messages) Revoke(pk string) error {
	ctx, cancel := call()
	defer cancel()
	id, err := parsePK(pk)
	if err != nil {
		return err
	}
	return s.c.Sender.Revoke(ctx, id)
}

func (s *Messages) React(pk, emoji string) ([]domain.Reaction, error) {
	ctx, cancel := call()
	defer cancel()
	id, err := parsePK(pk)
	if err != nil {
		return nil, err
	}
	return s.c.Sender.React(ctx, id, emoji)
}

// Search finds messages everywhere, or only in jid when it's set. In one chat it returns more,
// since the in-chat search steps through all of them.
func (s *Messages) Search(query, jid string) ([]domain.SearchHit, error) {
	ctx, cancel := call()
	defer cancel()
	limit := 50
	if jid != "" {
		limit = 200
	}
	return s.c.View(ctx).Search(ctx, s.c.DB, query, jid, limit)
}

var errNoPicker = errors.New("file picking isn't available")

// PickAttachments opens the system file dialog. The picked files wait in the preview until
// SendAttachment or DropAttachment; nil when the user cancelled. Files the store refuses (too big,
// empty) come back as an error only when none of the picked files is usable.
func (s *Messages) PickAttachments() ([]uploads.Item, error) {
	if s.picker == nil || s.uploads == nil {
		return nil, errNoPicker
	}
	paths, err := s.picker.PickFiles("Send photos or files")
	if err != nil || len(paths) == 0 {
		return nil, err
	}
	var items []uploads.Item
	var first error
	for _, p := range paths {
		it, err := s.uploads.AddPath(p)
		if err != nil {
			if first == nil {
				first = err
			}
			continue
		}
		items = append(items, it)
	}
	if len(items) == 0 {
		return nil, first
	}
	return items, nil
}

// SendAttachment sends a file from the preview. asFile sends a photo as a document, uncompressed
// and with its name.
func (s *Messages) SendAttachment(jid, token, caption string, asFile bool) (domain.Message, error) {
	if _, err := s.c.Mgr.Ready(); err != nil {
		return domain.Message{}, err
	}
	if s.uploads == nil {
		return domain.Message{}, errNoPicker
	}
	it, data, err := s.uploads.Read(token)
	if err != nil {
		return domain.Message{}, err
	}
	// uploads can take a while on a slow line
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	m, err := s.c.Sender.SendFile(ctx, jid, it.Name, data, strings.TrimSpace(caption), asFile)
	if err != nil {
		return domain.Message{}, err
	}
	s.uploads.Drop(token)
	return m, nil
}

// DropAttachment forgets a file the user removed from the preview (or replaced by an edit).
func (s *Messages) DropAttachment(token string) {
	if s.uploads != nil {
		s.uploads.Drop(token)
	}
}

// SendVoice sends a voice note: data is the WebM/Opus recording, base64-encoded; waveform has
// 0..100 per bar (WhatsApp uses 64).
func (s *Messages) SendVoice(jid, data string, waveform []int) (domain.Message, error) {
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return domain.Message{}, errors.New("bad recording data")
	}
	if len(raw) > 16<<20 {
		return domain.Message{}, errors.New("the recording is too long")
	}
	wave := make([]byte, 0, len(waveform))
	for _, v := range waveform[:min(len(waveform), 64)] {
		wave = append(wave, byte(min(max(v, 0), 100)))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	return s.c.Sender.SendVoice(ctx, jid, raw, wave)
}

type Profile struct{ c *core.Core }

func NewProfile(c *core.Core) *Profile { return &Profile{c: c} }

func (p *Profile) Get() (domain.Profile, error) {
	ctx, cancel := call()
	defer cancel()
	st := p.c.Mgr.Status()
	if st.Me == nil {
		return domain.Profile{}, wa.ErrNotLoggedIn
	}
	out := domain.Profile{Name: st.Me.Name, Phone: st.Me.Phone}
	me := p.c.In.Me(ctx)
	if ct, err := repo.GetContact(ctx, p.c.DB, me); err == nil {
		out.About = ct.About
	}
	if cli, err := p.c.Mgr.Ready(); err == nil {
		if j, err := types.ParseJID(me); err == nil {
			// an empty answer doesn't wipe what we know: WhatsApp's newer "text status" (what
			// SetAbout writes) doesn't always come back through this query
			about, err := cli.GetAbout(ctx, j)
			switch {
			case err != nil:
				slog.Warn("couldn't read your about", "error", err)
			case about != "":
				out.About = about
				_ = repo.SetAbout(ctx, p.c.DB, me, about, time.Now().UnixMilli())
			}
		}
	}
	return out, nil
}

func (p *Profile) SetName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("name can't be empty")
	}
	if len([]rune(name)) > 25 {
		name = string([]rune(name)[:25])
	}
	cli, err := p.c.Mgr.Ready()
	if err != nil {
		return err
	}
	ctx, cancel := call()
	defer cancel()
	return cli.SetPushName(ctx, name)
}

func (p *Profile) SetAbout(about string) error {
	about = strings.TrimSpace(about)
	if len([]rune(about)) > 139 {
		about = string([]rune(about)[:139])
	}
	cli, err := p.c.Mgr.Ready()
	if err != nil {
		return err
	}
	ctx, cancel := call()
	defer cancel()
	if err := cli.SetAbout(ctx, about); err != nil {
		slog.Warn("couldn't change your about", "error", err)
		return fmt.Errorf("WhatsApp didn't accept the new about: %w", err)
	}
	return repo.SetAbout(ctx, p.c.DB, p.c.In.Me(ctx), about, time.Now().UnixMilli())
}

type Privacy struct{ c *core.Core }

func NewPrivacy(c *core.Core) *Privacy { return &Privacy{c: c} }

func (p *Privacy) GetGhost() domain.GhostSettings { return p.c.Gate.Ghost() }

func (p *Privacy) SetGhost(g domain.GhostSettings) error {
	ctx, cancel := call()
	defer cancel()
	return p.c.SetGhost(ctx, g)
}

type Contacts struct{ c *core.Core }

func NewContacts(c *core.Core) *Contacts { return &Contacts{c: c} }

func (s *Contacts) List() ([]domain.Contact, error) {
	ctx, cancel := call()
	defer cancel()
	rows, err := repo.ListContacts(ctx, s.c.DB)
	if err != nil {
		return nil, err
	}
	v := s.c.View(ctx)
	out := make([]domain.Contact, 0, len(rows))
	for _, r := range rows {
		if r.JID == v.Me {
			continue
		}
		out = append(out, domain.Contact{JID: r.JID, Name: v.Name(r, r.JID), Phone: repo.PhoneOf(r.JID)})
	}
	return out, nil
}

// PhoneDigits turns what the user typed ("+7 (912) 345-67-89", "00 49 151...") into the digits of
// an international number, or "" when it can't be one.
func PhoneDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '(' || r == ')' || r == '.' || r == '+' || r == '/':
		default:
			return ""
		}
	}
	d := strings.TrimPrefix(b.String(), "00")
	if len(d) < 7 || len(d) > 15 || d[0] == '0' {
		return ""
	}
	return d
}

// Lookup finds the WhatsApp account behind a phone number, for starting a chat with someone who
// isn't in the chat list yet. It's one query to WhatsApp, nothing is sent to the person.
func (s *Contacts) Lookup(phone string) (domain.Contact, error) {
	ctx, cancel := call()
	defer cancel()
	d := PhoneDigits(phone)
	if d == "" {
		return domain.Contact{}, errors.New("enter the number with its country code, like +49 151 2345678")
	}
	cli, err := s.c.Mgr.Ready()
	if err != nil {
		return domain.Contact{}, err
	}
	res, err := cli.IsOnWhatsApp(ctx, []string{"+" + d})
	if err != nil {
		return domain.Contact{}, fmt.Errorf("couldn't check the number: %w", err)
	}
	if len(res) == 0 || !res[0].IsIn {
		return domain.Contact{}, fmt.Errorf("+%s isn't on WhatsApp", d)
	}
	jid := res[0].JID.ToNonAD().String()
	rows, err := repo.ContactsFor(ctx, s.c.DB, []string{jid})
	if err != nil {
		return domain.Contact{}, err
	}
	return domain.Contact{JID: jid, Name: s.c.View(ctx).Name(rows[jid], jid), Phone: repo.PhoneOf(jid)}, nil
}

// Forward sends copies of the messages (oldest first) to up to five chats. It stops at the first
// error, so the anti-spam limits end a forward that grew too big; sent says how many went out.
func (s *Messages) Forward(pks, jids []string) (sent int, err error) {
	if len(jids) == 0 || len(pks) == 0 {
		return 0, nil
	}
	if len(jids) > wa.MaxForwardChats {
		return 0, fmt.Errorf("you can forward to at most %d chats at once", wa.MaxForwardChats)
	}
	ids, err := parsePKs(pks)
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	rows, err := repo.MessagesByPKs(ctx, s.c.DB, ids)
	if err != nil {
		return 0, err
	}
	for _, jid := range jids {
		for _, r := range rows {
			if _, err := s.c.Sender.Forward(ctx, r.PK, jid); err != nil {
				return sent, err
			}
			sent++
		}
	}
	return sent, nil
}

// DeleteLocal is "Delete for me": the messages go from this computer, WhatsApp isn't told.
func (s *Messages) DeleteLocal(jid string, pks []string) error {
	ids, err := parsePKs(pks)
	if err != nil {
		return err
	}
	ctx, cancel := call()
	defer cancel()
	files, err := repo.DeleteMessages(ctx, s.c.DB, jid, ids)
	if err != nil {
		return err
	}
	s.c.RemoveFiles(ctx, files)
	s.c.Emit.Emit(events.MsgRemoved, domain.MsgRemovedEvent{ChatJID: jid, PKs: pks})
	if row, err := repo.GetChat(ctx, s.c.DB, jid); err == nil {
		if dto, err := s.c.View(ctx).Chat(ctx, s.c.DB, row); err == nil {
			s.c.Emit.Emit(events.ChatUpdate, domain.ChatUpdateEvent{Chat: dto})
		}
	}
	return nil
}

func parsePKs(pks []string) ([]int64, error) {
	out := make([]int64, 0, len(pks))
	for _, p := range pks {
		id, err := parsePK(p)
		if err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}

// Vote sets our choice on a poll; no options takes the vote back.
func (s *Messages) Vote(pk string, options []string) error {
	id, err := parsePK(pk)
	if err != nil {
		return err
	}
	ctx, cancel := call()
	defer cancel()
	return s.c.Sender.Vote(ctx, id, options)
}

// Changes is the "Deleted & edited" feed. kind: "deleted", "edited" or "" for both; pass the last
// item's at and pk to get the next page.
func (s *Messages) Changes(kind string, beforeAt int64, beforePk string, limit int) (domain.ChangePage, error) {
	var pk int64
	if beforePk != "" {
		var err error
		if pk, err = parsePK(beforePk); err != nil {
			return domain.ChangePage{}, err
		}
	}
	ctx, cancel := call()
	defer cancel()
	return s.c.View(ctx).Changes(ctx, s.c.DB, kind, beforeAt, pk, limit)
}

var errNotStatus = errors.New("not a status update")

var played = struct {
	sync.Mutex
	pks map[int64]bool
}{pks: map[int64]bool{}}

// Played is the user starting an incoming voice note or video note: the "played" receipt, if the
// ghost settings allow it. Once per message per run.
func (s *Messages) Played(pk string) error {
	id, err := parsePK(pk)
	if err != nil {
		return err
	}
	played.Lock()
	again := played.pks[id]
	played.pks[id] = true
	played.Unlock()
	if again {
		return nil
	}
	ctx, cancel := call()
	defer cancel()
	m, err := repo.GetMessage(ctx, s.c.DB, id)
	if err != nil || m.FromMe || m.ChatJID == repo.StatusChat {
		return err
	}
	if m.Kind != repo.KindVoice && m.Kind != repo.KindAudio && m.Kind != repo.KindRound {
		return nil
	}
	chat, err := types.ParseJID(m.ChatJID)
	if err != nil {
		return err
	}
	sender, _ := types.ParseJID(m.SenderJID)
	return s.c.Gate.Played(ctx, chat, sender, m.MsgID, time.UnixMilli(m.TS))
}
