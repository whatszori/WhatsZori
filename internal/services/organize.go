package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Chat actions beyond the basics: favourites, lists, clear/delete, block, leave, kick, and the
// membership history. Favourites, lists and clearing are local to WhatsZori.

func (s *Chats) SetFavorite(jid string, on bool) error {
	ctx, cancel := call()
	defer cancel()
	if err := repo.SetFavorite(ctx, s.c.DB, jid, on); err != nil {
		return err
	}
	s.emitChat(ctx, jid)
	return nil
}

// Open makes sure there's a chat row for jid (a group member we never wrote to) and returns it.
func (s *Chats) Open(jid string) (domain.Chat, error) {
	ctx, cancel := call()
	defer cancel()
	j, err := types.ParseJID(jid)
	if err != nil || j.User == "" {
		return domain.Chat{}, fmt.Errorf("bad chat %q", jid)
	}
	if err := repo.EnsureChat(ctx, s.c.DB, jid, j.Server == types.GroupServer); err != nil {
		return domain.Chat{}, err
	}
	row, err := repo.GetChat(ctx, s.c.DB, jid)
	if err != nil {
		return domain.Chat{}, err
	}
	return s.c.View(ctx).Chat(ctx, s.c.DB, row)
}

// Clear deletes the chat's messages on this computer only; the phone and other people keep them.
func (s *Chats) Clear(jid string) error {
	ctx, cancel := call()
	defer cancel()
	files, err := repo.ClearChat(ctx, s.c.DB, jid)
	if err != nil {
		return err
	}
	s.c.RemoveFiles(ctx, files)
	s.c.Emit.Emit(events.ChatCleared, domain.ChatRemovedEvent{JID: jid})
	s.emitChat(ctx, jid)
	return nil
}

// Delete removes the chat on all your devices (like "Delete chat" on the phone) and here.
func (s *Chats) Delete(jid string) error {
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
	var ts time.Time
	var key *waCommon.MessageKey
	if last, err := repo.LastMessage(ctx, s.c.DB, jid); err == nil {
		ts = time.UnixMilli(last.TS)
		fromMe := last.FromMe
		key = &waCommon.MessageKey{ID: &last.MsgID, RemoteJID: &jid, FromMe: &fromMe}
		if j.Server == types.GroupServer && !last.FromMe {
			key.Participant = &last.SenderJID
		}
	}
	if err := cli.SendAppState(ctx, appstate.BuildDeleteChat(j, ts, key, true)); err != nil {
		return fmt.Errorf("WhatsApp didn't take the change: %w", err)
	}
	files, err := repo.DeleteChat(ctx, s.c.DB, jid)
	if err != nil {
		return err
	}
	s.c.RemoveFiles(ctx, files)
	s.c.Emit.Emit(events.ChatRemoved, domain.ChatRemovedEvent{JID: jid})
	return nil
}

// blocked caches the block list for a minute; the info panel asks on every open.
var blocked struct {
	sync.Mutex
	at   time.Time
	jids map[string]bool
}

func (s *Chats) isBlocked(ctx context.Context, jid string) bool {
	blocked.Lock()
	defer blocked.Unlock()
	if time.Since(blocked.at) > time.Minute {
		cli, err := s.c.Mgr.Ready()
		if err != nil {
			return blocked.jids[jid]
		}
		list, err := cli.Blocked(ctx)
		if err != nil {
			return blocked.jids[jid]
		}
		blocked.jids = map[string]bool{}
		for _, j := range list {
			blocked.jids[s.c.JIDs.Key(ctx, j)] = true
		}
		blocked.at = time.Now()
	}
	return blocked.jids[jid]
}

func (s *Chats) SetBlocked(jid string, block bool) error {
	ctx, cancel := call()
	defer cancel()
	cli, err := s.c.Mgr.Ready()
	if err != nil {
		return err
	}
	j, err := types.ParseJID(jid)
	if err != nil || j.Server == types.GroupServer {
		return errors.New("only people can be blocked")
	}
	if err := cli.SetBlocked(ctx, j, block); err != nil {
		return fmt.Errorf("WhatsApp didn't take the change: %w", err)
	}
	blocked.Lock()
	blocked.at = time.Time{}
	blocked.Unlock()
	return nil
}

// SetDisappearing sets the chat's disappearing messages timer: 0 (off), 86400, 604800 or 7776000
// seconds. It applies to everyone in the chat; WhatsZori keeps its own copy regardless.
func (s *Chats) SetDisappearing(jid string, seconds int) error {
	ctx, cancel := call()
	defer cancel()
	return s.c.Sender.SetDisappearing(ctx, jid, seconds)
}

// Leave leaves a group. The chat and its history stay, like on the phone.
func (s *Chats) Leave(jid string) error {
	ctx, cancel := call()
	defer cancel()
	cli, err := s.c.Mgr.Ready()
	if err != nil {
		return err
	}
	j, err := types.ParseJID(jid)
	if err != nil || j.Server != types.GroupServer {
		return errors.New("not a group")
	}
	if err := cli.LeaveGroup(ctx, j); err != nil {
		return fmt.Errorf("couldn't leave: %w", err)
	}
	me := s.c.In.Me(ctx)
	_ = repo.RemoveParticipants(ctx, s.c.DB, jid, []string{me})
	_ = repo.SyncMemberCount(ctx, s.c.DB, jid)
	_ = repo.AddGroupEvent(ctx, s.c.DB, jid, repo.GroupEvent{TS: time.Now().UnixMilli(), Kind: repo.GroupLeave, Actor: me, Target: me})
	s.emitChat(ctx, jid)
	return nil
}

// RemoveMember kicks someone out of a group. Only admins can; WhatsApp refuses otherwise.
func (s *Chats) RemoveMember(group, member string) error {
	ctx, cancel := call()
	defer cancel()
	cli, err := s.c.Mgr.Ready()
	if err != nil {
		return err
	}
	g, err1 := types.ParseJID(group)
	m, err2 := types.ParseJID(member)
	if err1 != nil || err2 != nil || g.Server != types.GroupServer {
		return errors.New("bad group or member")
	}
	if err := cli.RemoveParticipants(ctx, g, []types.JID{m}); err != nil {
		return fmt.Errorf("couldn't remove: %w", err)
	}
	_ = repo.RemoveParticipants(ctx, s.c.DB, group, []string{member})
	_ = repo.SyncMemberCount(ctx, s.c.DB, group)
	_ = repo.AddGroupEvent(ctx, s.c.DB, group, repo.GroupEvent{TS: time.Now().UnixMilli(), Kind: repo.GroupRemove, Actor: s.c.In.Me(ctx), Target: member})
	s.emitChat(ctx, group)
	return nil
}

func (s *Chats) GroupEvents(jid string) ([]domain.GroupEvent, error) {
	ctx, cancel := call()
	defer cancel()
	evs, err := repo.GroupEvents(ctx, s.c.DB, jid, 1000)
	if err != nil {
		return nil, err
	}
	jids := map[string]bool{}
	for _, e := range evs {
		jids[e.Actor], jids[e.Target] = true, true
	}
	list := make([]string, 0, len(jids))
	for j := range jids {
		if j != "" {
			list = append(list, j)
		}
	}
	contacts, err := repo.ContactsFor(ctx, s.c.DB, list)
	if err != nil {
		return nil, err
	}
	v := s.c.View(ctx)
	name := func(j string) string {
		if j == "" {
			return ""
		}
		return v.Name(contacts[j], j)
	}
	out := make([]domain.GroupEvent, 0, len(evs))
	for _, e := range evs {
		out = append(out, domain.GroupEvent{At: e.TS, Kind: e.Kind, ActorJID: e.Actor, ActorName: name(e.Actor),
			TargetJID: e.Target, TargetName: name(e.Target)})
	}
	return out, nil
}

// Lists

func listDTO(l repo.ChatList) domain.ChatList {
	return domain.ChatList{ID: l.ID, Name: l.Name, Position: l.Position}
}

func (s *Chats) Lists() ([]domain.ChatList, error) {
	ctx, cancel := call()
	defer cancel()
	ls, err := repo.Lists(ctx, s.c.DB)
	if err != nil {
		return nil, err
	}
	out := make([]domain.ChatList, len(ls))
	for i, l := range ls {
		out[i] = listDTO(l)
	}
	return out, nil
}

func (s *Chats) CreateList(name string) (domain.ChatList, error) {
	ctx, cancel := call()
	defer cancel()
	l, err := repo.CreateList(ctx, s.c.DB, name, time.Now().UnixMilli())
	if err != nil {
		return domain.ChatList{}, err
	}
	return listDTO(l), nil
}

func (s *Chats) RenameList(id int64, name string) error {
	ctx, cancel := call()
	defer cancel()
	return repo.RenameList(ctx, s.c.DB, id, name)
}

func (s *Chats) DeleteList(id int64) error {
	ctx, cancel := call()
	defer cancel()
	return repo.DeleteList(ctx, s.c.DB, id)
}

func (s *Chats) SetInList(id int64, jid string, in bool) error {
	ctx, cancel := call()
	defer cancel()
	if err := repo.SetInList(ctx, s.c.DB, id, jid, in); err != nil {
		if strings.Contains(err.Error(), "FOREIGN KEY") {
			return errors.New("that list or chat doesn't exist anymore")
		}
		return err
	}
	s.emitChat(ctx, jid)
	return nil
}

// ListShared pages a chat's media ("media"), documents ("docs") or messages with links ("links").
func (s *Messages) ListShared(jid, kind, beforePk string, limit int) (domain.MessagePage, error) {
	ctx, cancel := call()
	defer cancel()
	var before int64
	if beforePk != "" {
		var err error
		if before, err = parsePK(beforePk); err != nil {
			return domain.MessagePage{}, err
		}
	}
	rows, more, err := repo.SharedPage(ctx, s.c.DB, jid, kind, before, limit)
	if err != nil {
		return domain.MessagePage{}, err
	}
	msgs, err := s.c.View(ctx).Messages(ctx, s.c.DB, rows)
	if err != nil {
		return domain.MessagePage{}, err
	}
	return domain.MessagePage{Messages: msgs, HasMore: more}, nil
}
