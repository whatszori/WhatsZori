package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/core"
	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/store/repo"
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
	row, err := repo.GetChat(ctx, s.c.DB, jid)
	if err != nil {
		return err
	}
	if row.Unread > 0 {
		if err := repo.SetUnread(ctx, s.c.DB, jid, 0); err != nil {
			return err
		}
		s.emitChat(ctx, jid)
	}
	j, err := types.ParseJID(jid)
	if err != nil {
		return err
	}
	if cli, err := s.c.Mgr.Ready(); err == nil {
		if err := s.c.Gate.ChatOpened(ctx, j); err != nil {
			return fmt.Errorf("read receipts: %w", err)
		}
		if !row.IsGroup {
			// presence only flows for contacts we subscribed to
			_ = cli.SubscribePresence(ctx, j)
		}
	}
	return nil
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
	// a 1:1 "about" we never saw: ask once, it's cheap and cached in contacts
	if info.Members == nil && info.About == "" {
		if cli, err := s.c.Mgr.Ready(); err == nil {
			if j, err := types.ParseJID(jid); err == nil {
				if about, err := cli.GetAbout(ctx, j); err == nil && about != "" {
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

type Messages struct {
	c      *core.Core
	picker FilePicker
}

func NewMessages(c *core.Core, picker FilePicker) *Messages { return &Messages{c: c, picker: picker} }

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

func (s *Messages) Search(query string) ([]domain.SearchHit, error) {
	ctx, cancel := call()
	defer cancel()
	return s.c.View(ctx).Search(ctx, s.c.DB, query, 50)
}

var errNoPicker = errors.New("file picking isn't available")

// AttachFile opens the system file dialog and sends what the user picked. It returns nil when
// they cancelled.
func (s *Messages) AttachFile(jid string) (*domain.Message, error) {
	if _, err := s.c.Mgr.Ready(); err != nil {
		return nil, err
	}
	if s.picker == nil {
		return nil, errNoPicker
	}
	path, err := s.picker.PickFile("Send a photo or file")
	if err != nil || path == "" {
		return nil, err
	}
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if st.Size() > 100<<20 {
		return nil, errors.New("files can be at most 100 MB")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	// uploads can take a while on a slow line
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	m, err := s.c.Sender.SendFile(ctx, jid, path, data, "")
	if err != nil {
		return nil, err
	}
	return &m, nil
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
			if about, err := cli.GetAbout(ctx, j); err == nil {
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
		return err
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
