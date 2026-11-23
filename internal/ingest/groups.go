package ingest

import (
	"context"
	"database/sql"

	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// Membership history comes from two places: live GroupInfo notifications, and the system
// messages ("X added Y") that history sync carries as stub messages. Older changes than that
// aren't anywhere we can get them.

var stubKinds = map[waWeb.WebMessageInfo_StubType]string{
	waWeb.WebMessageInfo_GROUP_CREATE:                        repo.GroupCreate,
	waWeb.WebMessageInfo_GROUP_PARTICIPANT_ADD:               repo.GroupAdd,
	waWeb.WebMessageInfo_GROUP_PARTICIPANT_REMOVE:            repo.GroupRemove,
	waWeb.WebMessageInfo_GROUP_PARTICIPANT_PROMOTE:           repo.GroupPromote,
	waWeb.WebMessageInfo_GROUP_PARTICIPANT_DEMOTE:            repo.GroupDemote,
	waWeb.WebMessageInfo_GROUP_PARTICIPANT_INVITE:            repo.GroupJoin,
	waWeb.WebMessageInfo_GROUP_PARTICIPANT_LEAVE:             repo.GroupLeave,
	waWeb.WebMessageInfo_GROUP_PARTICIPANT_ACCEPT:            repo.GroupJoin,
	waWeb.WebMessageInfo_GROUP_PARTICIPANT_LINKED_GROUP_JOIN: repo.GroupJoin,
}

func (in *Ingester) key(ctx context.Context, s string) string {
	if s == "" {
		return ""
	}
	j, err := types.ParseJID(s)
	if err != nil {
		return ""
	}
	return in.jids.Key(ctx, j)
}

// historyStub records a membership system message from history sync. It reports whether web was
// one, so the caller can skip it.
func (in *Ingester) historyStub(ctx context.Context, tx *sql.Tx, group string, web *waWeb.WebMessageInfo) (bool, error) {
	kind, ok := stubKinds[web.GetMessageStubType()]
	if !ok {
		return false, nil
	}
	ts := int64(web.GetMessageTimestamp()) * 1000
	actor := in.key(ctx, firstNonEmpty(web.GetParticipant(), web.GetKey().GetParticipant()))
	if web.GetKey().GetFromMe() {
		actor = in.Me(ctx)
	}
	if kind == repo.GroupCreate {
		// the parameter is the group name, not a person
		return true, repo.AddGroupEvent(ctx, tx, group, repo.GroupEvent{TS: ts, Kind: kind, Actor: actor})
	}
	targets := web.GetMessageStubParameters()
	if len(targets) == 0 {
		targets = []string{actor}
	}
	for _, t := range targets {
		target := in.key(ctx, t)
		if target == "" {
			continue
		}
		k := kind
		if k == repo.GroupAdd && (actor == "" || actor == target) {
			k = repo.GroupJoin
		}
		if err := repo.AddGroupEvent(ctx, tx, group, repo.GroupEvent{TS: ts, Kind: k, Actor: actor, Target: target}); err != nil {
			return true, err
		}
	}
	return true, nil
}

func (in *Ingester) liveGroupEvents(ctx context.Context, tx *sql.Tx, e *events.GroupInfo) error {
	group := e.JID.String()
	ts := ms(e.Timestamp)
	if ts == 0 {
		ts = ms(in.now())
	}
	actor := ""
	if e.Sender != nil {
		if e.SenderPN != nil {
			in.learn(ctx, tx, newEffects(), *e.Sender, *e.SenderPN)
		}
		actor = in.jids.Key(ctx, *e.Sender)
	}
	add := func(kind string, list []types.JID) error {
		for _, j := range list {
			target := in.jids.Key(ctx, j)
			k := kind
			switch {
			case k == repo.GroupAdd && (actor == "" || actor == target || e.JoinReason == "invite"):
				k = repo.GroupJoin
			case k == repo.GroupRemove && (actor == "" || actor == target):
				k = repo.GroupLeave
			}
			if err := repo.AddGroupEvent(ctx, tx, group, repo.GroupEvent{TS: ts, Kind: k, Actor: actor, Target: target}); err != nil {
				return err
			}
		}
		return nil
	}
	for _, step := range []struct {
		kind string
		list []types.JID
	}{
		{repo.GroupAdd, e.Join}, {repo.GroupRemove, e.Leave}, {repo.GroupPromote, e.Promote}, {repo.GroupDemote, e.Demote},
	} {
		if err := add(step.kind, step.list); err != nil {
			return err
		}
	}
	return nil
}
