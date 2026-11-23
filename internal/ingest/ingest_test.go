package ingest

import (
	"context"
	"database/sql"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
	evnames "github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/store"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/wa"
)

var (
	me    = types.NewJID("10000000001", types.DefaultUserServer)
	alice = types.NewJID("491700000001", types.DefaultUserServer)
	bob   = types.NewJID("491700000002", types.DefaultUserServer)
	group = types.NewJID("120363000000000001", types.GroupServer)
)

// fakeClient only implements what ingest calls; anything else panics on the nil embedded interface.
type fakeClient struct {
	wa.Client
	real *whatsmeow.Client
}

func newFakeClient() *fakeClient {
	id := me
	return &fakeClient{real: whatsmeow.NewClient(&waStore.Device{ID: &id}, nil)}
}

func (f *fakeClient) OwnID() types.JID  { return me }
func (f *fakeClient) IsConnected() bool { return false }
func (f *fakeClient) ParseWebMessage(chat types.JID, m *waWeb.WebMessageInfo) (*events.Message, error) {
	return f.real.ParseWebMessage(chat, m)
}

type memLIDs struct {
	mu sync.Mutex
	m  map[types.JID]types.JID
}

func (l *memLIDs) PutManyLIDMappings(ctx context.Context, ms []waStore.LIDMapping) error {
	for _, m := range ms {
		l.PutLIDMapping(ctx, m.LID, m.PN)
	}
	return nil
}
func (l *memLIDs) PutLIDMapping(_ context.Context, lid, pn types.JID) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.m[lid] = pn
	return nil
}
func (l *memLIDs) GetPNForLID(_ context.Context, lid types.JID) (types.JID, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.m[lid], nil
}
func (l *memLIDs) GetLIDForPN(_ context.Context, pn types.JID) (types.JID, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, v := range l.m {
		if v == pn {
			return k, nil
		}
	}
	return types.EmptyJID, nil
}
func (l *memLIDs) GetManyLIDsForPNs(ctx context.Context, pns []types.JID) (map[types.JID]types.JID, error) {
	out := map[types.JID]types.JID{}
	for _, pn := range pns {
		if lid, _ := l.GetLIDForPN(ctx, pn); !lid.IsEmpty() {
			out[pn] = lid
		}
	}
	return out, nil
}

type rec struct {
	mu  sync.Mutex
	evs []namedEvent
}

func (r *rec) Emit(name string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.evs = append(r.evs, namedEvent{name, data})
}

func (r *rec) take(name string) []any {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []any
	for _, e := range r.evs {
		if e.name == name {
			out = append(out, e.data)
		}
	}
	return out
}

func (r *rec) reset() {
	r.mu.Lock()
	r.evs = nil
	r.mu.Unlock()
}

type fakeMedia struct{ queued []int64 }

func (f *fakeMedia) Enqueue(pk int64) { f.queued = append(f.queued, pk) }
func (f *fakeMedia) Remove(string)    {}

type env struct {
	in     *Ingester
	db     *sql.DB
	rec    *rec
	lids   *memLIDs
	media  *fakeMedia
	policy domain.HistoryPolicy
}

func newEnv(t *testing.T) *env {
	t.Helper()
	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "whatszori.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := &env{db: db, rec: &rec{}, lids: &memLIDs{m: map[types.JID]types.JID{}}, media: &fakeMedia{},
		policy: domain.HistoryPolicy{KeepDeleted: true, KeepEditHistory: true, AutoDownload: true}}
	cli := newFakeClient()
	e.in = New(Options{
		DB:     db,
		JIDs:   wa.NewJIDs(func() waStore.LIDStore { return e.lids }),
		Emit:   e.rec,
		Policy: func() domain.HistoryPolicy { return e.policy },
		Client: func() wa.Client { return cli },
		Media:  e.media,
	})
	return e
}

var clock = time.Unix(1_750_000_000, 0)

func tick() time.Time {
	clock = clock.Add(time.Second)
	return clock
}

func info(chat, sender types.JID, id string) types.MessageInfo {
	return types.MessageInfo{
		MessageSource: types.MessageSource{Chat: chat, Sender: sender, IsFromMe: sender == me, IsGroup: chat.Server == types.GroupServer},
		ID:            id,
		PushName:      "Push " + sender.User,
		Timestamp:     tick(),
	}
}

func text(chat, sender types.JID, id, body string) *events.Message {
	return &events.Message{Info: info(chat, sender, id), Message: &waE2E.Message{Conversation: proto.String(body)}}
}

func revokeEvt(chat, revoker types.JID, targetID string, targetFromMe bool, participant string) *events.Message {
	key := &waCommon.MessageKey{ID: proto.String(targetID), FromMe: proto.Bool(targetFromMe), RemoteJID: proto.String(chat.String())}
	if participant != "" {
		key.Participant = proto.String(participant)
	}
	in := info(chat, revoker, "REVOKE-"+targetID+strconv.FormatInt(clock.Unix(), 10))
	in.Edit = types.EditAttributeSenderRevoke
	if participant != "" && participant != revoker.String() {
		in.Edit = types.EditAttributeAdminRevoke
	}
	return &events.Message{Info: in, Message: &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
		Type: waE2E.ProtocolMessage_REVOKE.Enum(), Key: key,
	}}}
}

func editEvt(chat, editor types.JID, targetID, body string) *events.Message {
	at := tick()
	in := info(chat, editor, "EDIT-"+strconv.FormatInt(at.Unix(), 10))
	in.Edit = types.EditAttributeMessageEdit
	return &events.Message{Info: in, IsEdit: true, Message: &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
		Type:          waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(),
		Key:           &waCommon.MessageKey{ID: proto.String(targetID), RemoteJID: proto.String(chat.String()), FromMe: proto.Bool(editor == me)},
		EditedMessage: &waE2E.Message{Conversation: proto.String(body)},
		TimestampMS:   proto.Int64(at.UnixMilli()),
	}}}
}

func reactEvt(chat, sender types.JID, targetID, emoji string) *events.Message {
	at := tick()
	return &events.Message{Info: info(chat, sender, "R-"+strconv.FormatInt(at.UnixNano(), 10)), Message: &waE2E.Message{
		ReactionMessage: &waE2E.ReactionMessage{
			Key:               &waCommon.MessageKey{ID: proto.String(targetID), RemoteJID: proto.String(chat.String())},
			Text:              proto.String(emoji),
			SenderTimestampMS: proto.Int64(at.UnixMilli()),
		},
	}}
}

func (e *env) handle(t *testing.T, evt any) {
	t.Helper()
	if err := e.in.Handle(evt); err != nil {
		t.Fatalf("handle %T: %v", evt, err)
	}
}

func (e *env) msg(t *testing.T, chat types.JID, id string) repo.MessageRow {
	t.Helper()
	m, err := repo.GetMessageByID(context.Background(), e.db, chat.String(), id)
	if err != nil {
		t.Fatalf("message %s: %v", id, err)
	}
	return m
}

func TestNormalMessage(t *testing.T) {
	e := newEnv(t)
	e.handle(t, text(alice, alice, "M1", "hello there"))

	m := e.msg(t, alice, "M1")
	if m.Body != "hello there" || m.Kind != repo.KindText || m.FromMe || m.SenderJID != alice.String() || m.Raw == nil {
		t.Fatalf("row wrong: %+v", m)
	}
	c, _ := repo.GetChat(context.Background(), e.db, alice.String())
	if c.Unread != 1 || c.LastTS != m.TS {
		t.Errorf("chat wrong: %+v", c)
	}
	batches := e.rec.take(evnames.MsgBatch)
	if len(batches) != 1 || batches[0].(domain.MsgBatchEvent).Messages[0].Text != "hello there" {
		t.Fatalf("msg:batch wrong: %+v", batches)
	}
	if got := batches[0].(domain.MsgBatchEvent).Messages[0].SenderName; got != "Push "+alice.User {
		t.Errorf("sender name = %q, want the push name", got)
	}
	ups := e.rec.take(evnames.ChatUpdate)
	if len(ups) != 1 || ups[0].(domain.ChatUpdateEvent).Chat.Unread != 1 {
		t.Errorf("chat:update wrong: %+v", ups)
	}

	// a redelivery is a no-op
	e.rec.reset()
	again := text(alice, alice, "M1", "hello there")
	e.handle(t, again)
	if c, _ := repo.GetChat(context.Background(), e.db, alice.String()); c.Unread != 1 {
		t.Errorf("redelivery bumped unread to %d", c.Unread)
	}
}

func TestReplyAndMediaAndUnknown(t *testing.T) {
	e := newEnv(t)
	e.handle(t, text(group, alice, "Q1", "original"))
	reply := &events.Message{Info: info(group, bob, "R1"), Message: &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
		Text:        proto.String("answer"),
		ContextInfo: &waE2E.ContextInfo{StanzaID: proto.String("Q1"), Participant: proto.String(alice.String())},
	}}}
	e.handle(t, reply)
	img := &events.Message{Info: info(group, bob, "IMG"), Message: &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
		Caption: proto.String("look"), Mimetype: proto.String("image/jpeg"), FileLength: proto.Uint64(1234),
		Width: proto.Uint32(640), Height: proto.Uint32(480), DirectPath: proto.String("/v/t62/x"), MediaKey: []byte{1, 2, 3},
		JPEGThumbnail: []byte{0xff, 0xd8},
	}}}
	e.handle(t, img)
	odd := &events.Message{Info: info(group, bob, "ODD"), Message: &waE2E.Message{ButtonsResponseMessage: &waE2E.ButtonsResponseMessage{SelectedButtonID: proto.String("x")}}}
	e.handle(t, odd)
	meta := &events.Message{Info: info(group, bob, "META"), Message: &waE2E.Message{SenderKeyDistributionMessage: &waE2E.SenderKeyDistributionMessage{GroupID: proto.String("g")}}}
	e.handle(t, meta)

	ctx := context.Background()
	v := repo.View{Me: me.String()}
	rows, _, _ := repo.Page(ctx, e.db, group.String(), 0, 10)
	if len(rows) != 4 {
		t.Fatalf("got %d rows, want 4 (meta-only isn't stored): %+v", len(rows), rows)
	}
	dtos, err := v.Messages(ctx, e.db, rows)
	if err != nil {
		t.Fatal(err)
	}
	if dtos[1].ReplyTo == nil || dtos[1].ReplyTo.Text != "original" || dtos[1].ReplyTo.PK != dtos[0].PK {
		t.Errorf("reply not linked: %+v", dtos[1].ReplyTo)
	}
	if dtos[2].Kind != domain.KindImage || dtos[2].Media == nil || dtos[2].Media.Width != 640 || dtos[2].Text != "look" {
		t.Errorf("image wrong: %+v", dtos[2])
	}
	if len(e.media.queued) != 1 {
		t.Errorf("image not queued for auto-download: %v", e.media.queued)
	}
	if rows[3].Kind != repo.KindUnknown || rows[3].Raw == nil || dtos[3].Text == "" {
		t.Errorf("unknown type not kept with its raw proto: %+v", rows[3])
	}
}

func TestRevokeAfterOriginal(t *testing.T) {
	e := newEnv(t)
	e.handle(t, text(alice, alice, "M1", "secret"))
	e.rec.reset()
	e.handle(t, revokeEvt(alice, alice, "M1", false, ""))

	m := e.msg(t, alice, "M1")
	if !m.IsDeleted || m.Body != "secret" || m.Raw == nil || m.DeleteKind != "sender" || m.DeletedBy != alice.String() {
		t.Fatalf("revoke wrong: %+v", m)
	}
	dels := e.rec.take(evnames.MsgDeleted)
	if len(dels) != 1 || dels[0].(domain.MsgDeletedEvent).Purged {
		t.Fatalf("msg:deleted wrong: %+v", dels)
	}
	// revoking twice changes nothing
	e.rec.reset()
	e.handle(t, revokeEvt(alice, alice, "M1", false, ""))
	if len(e.rec.take(evnames.MsgDeleted)) != 0 {
		t.Error("second revoke emitted again")
	}
}

func TestRevokeByAdmin(t *testing.T) {
	e := newEnv(t)
	e.handle(t, text(group, alice, "G1", "rude"))
	e.handle(t, revokeEvt(group, bob, "G1", false, alice.String()))
	if m := e.msg(t, group, "G1"); m.DeleteKind != "admin" || m.DeletedBy != bob.String() {
		t.Fatalf("admin revoke wrong: %+v", m)
	}
}

func TestRevokeWithoutKeeping(t *testing.T) {
	e := newEnv(t)
	e.policy.KeepDeleted = false
	e.handle(t, text(alice, alice, "M1", "secret"))
	e.handle(t, revokeEvt(alice, alice, "M1", false, ""))
	m := e.msg(t, alice, "M1")
	if !m.IsDeleted || m.Body != "" || m.Raw != nil {
		t.Fatalf("content kept with keepDeleted off: %+v", m)
	}
	if dels := e.rec.take(evnames.MsgDeleted); len(dels) != 1 || !dels[0].(domain.MsgDeletedEvent).Purged {
		t.Fatalf("purged flag not set: %+v", dels)
	}
}

func TestRevokeBeforeOriginal(t *testing.T) {
	e := newEnv(t)
	e.handle(t, revokeEvt(alice, alice, "M1", false, ""))

	m := e.msg(t, alice, "M1")
	if !m.IsPlaceholder || !m.IsDeleted || m.Raw != nil || m.Kind != repo.KindUnknown {
		t.Fatalf("placeholder wrong: %+v", m)
	}
	dto, _ := repo.View{Me: me.String()}.Message(context.Background(), e.db, m.PK)
	if !dto.ContentUnknown || dto.Deleted == nil {
		t.Errorf("placeholder dto: %+v", dto)
	}

	e.rec.reset()
	orig := text(alice, alice, "M1", "now you see it")
	orig.Info.Timestamp = clock.Add(-time.Hour)
	e.handle(t, orig)

	m = e.msg(t, alice, "M1")
	if !m.IsPlaceholder || !m.IsDeleted || m.Body != "now you see it" || m.Raw == nil || m.TS != orig.Info.Timestamp.UnixMilli() {
		t.Fatalf("placeholder not filled (or flags cleared): %+v", m)
	}
	batches := e.rec.take(evnames.MsgBatch)
	if len(batches) != 1 {
		t.Fatalf("filled placeholder not emitted: %+v", batches)
	}
	got := batches[0].(domain.MsgBatchEvent).Messages[0]
	if got.ContentUnknown || got.Deleted == nil || got.Text != "now you see it" {
		t.Errorf("filled dto wrong: %+v", got)
	}
	if c, _ := repo.GetChat(context.Background(), e.db, alice.String()); c.Unread != 0 {
		t.Errorf("a revoked message counted as unread: %d", c.Unread)
	}
}

func TestEditChain(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.handle(t, text(alice, alice, "M1", "v0"))
	orig := e.msg(t, alice, "M1")
	for _, body := range []string{"v1", "v2", "v3"} {
		e.handle(t, editEvt(alice, alice, "M1", body))
	}
	m := e.msg(t, alice, "M1")
	if m.Body != "v3" || m.EditCount != 3 || m.EditedAt == 0 {
		t.Fatalf("after edits: %+v", m)
	}
	edits, _ := repo.Edits(ctx, e.db, m.PK)
	if len(edits) != 4 {
		t.Fatalf("got %d versions, want 4: %+v", len(edits), edits)
	}
	for i, ed := range edits {
		if ed.Version != i || ed.Body != "v"+strconv.Itoa(i) {
			t.Errorf("version %d = %+v", i, ed)
		}
	}
	if edits[0].EditedAt != orig.TS {
		t.Errorf("version 0 should carry the original time")
	}
	evs := e.rec.take(evnames.MsgEdited)
	if len(evs) != 3 || evs[2].(domain.MsgEditedEvent).EditCount != 3 {
		t.Errorf("msg:edited events: %+v", evs)
	}
}

func TestEditWithoutHistory(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.policy.KeepEditHistory = false
	e.handle(t, text(alice, alice, "M1", "v0"))
	e.handle(t, editEvt(alice, alice, "M1", "v1"))
	m := e.msg(t, alice, "M1")
	edits, _ := repo.Edits(ctx, e.db, m.PK)
	if m.Body != "v1" || m.EditCount != 1 || len(edits) != 0 {
		t.Fatalf("keepEditHistory off: body=%q count=%d edits=%d", m.Body, m.EditCount, len(edits))
	}
}

func TestEditFromWrongSenderIgnored(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.handle(t, text(group, alice, "G1", "alice wrote this"))
	e.rec.reset()
	e.handle(t, editEvt(group, bob, "G1", "bob says alice wrote this"))
	m := e.msg(t, group, "G1")
	edits, _ := repo.Edits(ctx, e.db, m.PK)
	if m.Body != "alice wrote this" || m.EditCount != 0 || len(edits) != 0 {
		t.Fatalf("foreign edit applied: %+v", m)
	}
	if len(e.rec.take(evnames.MsgEdited)) != 0 {
		t.Error("foreign edit emitted")
	}
	// and someone editing our own message isn't us either
	e.handle(t, text(group, me, "MINE", "mine"))
	e.handle(t, editEvt(group, bob, "MINE", "not mine"))
	if m := e.msg(t, group, "MINE"); m.Body != "mine" {
		t.Errorf("edit of my message by someone else applied")
	}
}

func TestReactions(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.handle(t, text(group, alice, "G1", "party?"))
	last := func() []domain.Reaction {
		evs := e.rec.take(evnames.MsgReaction)
		if len(evs) == 0 {
			t.Fatal("no msg:reaction")
		}
		return evs[len(evs)-1].(domain.MsgReactionEvent).Reactions
	}

	e.handle(t, reactEvt(group, bob, "G1", "👍"))
	if r := last(); len(r) != 1 || r[0].Emoji != "👍" || r[0].Count != 1 || r[0].Mine {
		t.Fatalf("add: %+v", r)
	}
	e.handle(t, reactEvt(group, me, "G1", "👍"))
	if r := last(); len(r) != 1 || r[0].Count != 2 || !r[0].Mine {
		t.Fatalf("second person: %+v", r)
	}
	e.handle(t, reactEvt(group, bob, "G1", "🎉"))
	if r := last(); len(r) != 2 {
		t.Fatalf("change: %+v", r)
	}
	e.handle(t, reactEvt(group, bob, "G1", ""))
	if r := last(); len(r) != 1 || r[0].Emoji != "👍" || r[0].Count != 1 {
		t.Fatalf("remove: %+v", r)
	}
	// reacting to a message we don't have yet is kept for later
	e.handle(t, reactEvt(group, bob, "LATER", "❤️"))
	e.handle(t, text(group, alice, "LATER", "late"))
	m := e.msg(t, group, "LATER")
	dto, _ := repo.View{Me: me.String()}.Message(ctx, e.db, m.PK)
	if len(dto.Reactions) != 1 || dto.Reactions[0].Emoji != "❤️" {
		t.Errorf("early reaction lost: %+v", dto.Reactions)
	}
}

func TestReceiptsDriveStatus(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	mine := text(alice, me, "OUT", "hi")
	e.handle(t, mine)
	if m := e.msg(t, alice, "OUT"); m.Status != "sent" {
		t.Fatalf("own message status = %q", m.Status)
	}
	receipt := func(typ types.ReceiptType) *events.Receipt {
		return &events.Receipt{MessageSource: types.MessageSource{Chat: alice, Sender: alice}, MessageIDs: []string{"OUT"}, Timestamp: tick(), Type: typ}
	}
	e.handle(t, receipt(types.ReceiptTypeDelivered))
	if m := e.msg(t, alice, "OUT"); m.Status != "delivered" {
		t.Fatalf("after delivered: %q", m.Status)
	}
	e.handle(t, receipt(types.ReceiptTypeRead))
	e.handle(t, receipt(types.ReceiptTypeDelivered))
	if m := e.msg(t, alice, "OUT"); m.Status != "read" {
		t.Fatalf("status went backwards or didn't move: %q", m.Status)
	}
	if n, _ := repo.ReceiptCount(ctx, e.db, alice.String(), "OUT", []string{"read"}); n != 1 {
		t.Errorf("receipt not stored")
	}

	// read-self: another device of ours read the chat
	e.handle(t, text(alice, alice, "IN1", "one"))
	e.handle(t, text(alice, alice, "IN2", "two"))
	e.handle(t, &events.Receipt{MessageSource: types.MessageSource{Chat: alice, Sender: me, IsFromMe: true}, MessageIDs: []string{"IN2"}, Timestamp: tick(), Type: types.ReceiptTypeReadSelf})
	if c, _ := repo.GetChat(ctx, e.db, alice.String()); c.Unread != 0 {
		t.Errorf("unread after read-self = %d", c.Unread)
	}
	if m := e.msg(t, alice, "IN2"); !m.ReadSent {
		t.Error("read-self didn't mark the receipt as sent")
	}
}

func TestHistorySyncBatch(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	web := func(id string, fromMe bool, ts int64, msg *waE2E.Message) *waHistorySync.HistorySyncMsg {
		return &waHistorySync.HistorySyncMsg{Message: &waWeb.WebMessageInfo{
			Key:              &waCommon.MessageKey{ID: proto.String(id), FromMe: proto.Bool(fromMe), RemoteJID: proto.String(alice.String())},
			Message:          msg,
			MessageTimestamp: proto.Uint64(uint64(ts)),
		}}
	}
	groupMsg := &waHistorySync.HistorySyncMsg{Message: &waWeb.WebMessageInfo{
		Key:              &waCommon.MessageKey{ID: proto.String("GH1"), RemoteJID: proto.String(group.String()), Participant: proto.String(bob.String())},
		Message:          &waE2E.Message{Conversation: proto.String("group history")},
		MessageTimestamp: proto.Uint64(1_700_000_100),
		PushName:         proto.String("Bob"),
	}}
	revoked := &waHistorySync.HistorySyncMsg{Message: &waWeb.WebMessageInfo{
		Key:              &waCommon.MessageKey{ID: proto.String("GONE"), RemoteJID: proto.String(alice.String())},
		MessageStubType:  waWeb.WebMessageInfo_REVOKE.Enum(),
		MessageTimestamp: proto.Uint64(1_700_000_050),
	}}
	hs := &events.HistorySync{Data: &waHistorySync.HistorySync{
		SyncType:  waHistorySync.HistorySync_INITIAL_BOOTSTRAP.Enum(),
		Progress:  proto.Uint32(40),
		Pushnames: []*waHistorySync.Pushname{{ID: proto.String(alice.String()), Pushname: proto.String("Alice")}},
		Conversations: []*waHistorySync.Conversation{
			{
				ID:          proto.String(alice.String()),
				UnreadCount: proto.Uint32(1),
				Pinned:      proto.Uint32(1_700_000_000),
				Messages: []*waHistorySync.HistorySyncMsg{
					web("H3", false, 1_700_000_030, &waE2E.Message{Conversation: proto.String("third")}),
					web("H2", true, 1_700_000_020, &waE2E.Message{Conversation: proto.String("mine")}),
					web("H1", false, 1_700_000_010, &waE2E.Message{Conversation: proto.String("first")}),
					revoked,
				},
			},
			{ID: proto.String(group.String()), Name: proto.String("History Group"), Messages: []*waHistorySync.HistorySyncMsg{groupMsg}},
			{ID: proto.String("status@broadcast"), Messages: []*waHistorySync.HistorySyncMsg{web("S1", false, 1, &waE2E.Message{Conversation: proto.String("status")})}},
		},
	}}
	e.handle(t, hs)

	rows, _, _ := repo.Page(ctx, e.db, alice.String(), 0, 10)
	if len(rows) != 4 {
		t.Fatalf("alice has %d rows, want 4", len(rows))
	}
	if rows[0].Body != "first" || rows[2].Body != "third" || !rows[1].FromMe || rows[1].SenderJID != me.String() {
		t.Errorf("history order or sender wrong: %+v", rows)
	}
	if !rows[3].IsDeleted || !rows[3].IsPlaceholder {
		t.Errorf("revoked stub not kept as a deleted placeholder: %+v", rows[3])
	}
	for _, r := range rows[:3] {
		if !r.ReadSent {
			t.Errorf("history message %s would get a read receipt later", r.MsgID)
		}
	}
	c, _ := repo.GetChat(ctx, e.db, alice.String())
	if c.Unread != 1 || !c.Pinned {
		t.Errorf("chat flags from history: %+v", c)
	}
	g, _ := repo.GetChat(ctx, e.db, group.String())
	if g.Name != "History Group" || !g.IsGroup {
		t.Errorf("group from history: %+v", g)
	}
	if _, err := repo.GetChat(ctx, e.db, "status@broadcast"); err != repo.ErrNotFound {
		t.Error("status broadcast stored as a chat")
	}
	ct, _ := repo.GetContact(ctx, e.db, alice.String())
	if ct.PushName != "Alice" {
		t.Errorf("push name from history: %+v", ct)
	}
	prog := e.rec.take(evnames.SyncProgress)
	if len(prog) != 1 || prog[0].(domain.SyncProgressEvent).Progress != 40 {
		t.Errorf("sync:progress: %+v", prog)
	}
	if len(e.media.queued) != 0 {
		t.Error("history queued auto-downloads")
	}

	// the same blob again doesn't duplicate anything
	e.handle(t, hs)
	rows, _, _ = repo.Page(ctx, e.db, alice.String(), 0, 10)
	if len(rows) != 4 {
		t.Errorf("replayed history duplicated rows: %d", len(rows))
	}
}

func TestLIDChatFoldsIntoPhoneNumber(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	lid := types.NewJID("200000000000001", types.HiddenUserServer)
	// first message arrives addressed by LID only
	e.handle(t, text(lid, lid, "L1", "from lid"))
	if _, err := repo.GetChat(ctx, e.db, lid.String()); err != nil {
		t.Fatalf("lid chat missing: %v", err)
	}
	// the next one carries the phone number as SenderAlt
	m := text(lid, lid, "L2", "now with pn")
	m.Info.SenderAlt = alice
	m.Info.AddressingMode = types.AddressingModeLID
	e.handle(t, m)

	if _, err := repo.GetChat(ctx, e.db, lid.String()); err != repo.ErrNotFound {
		t.Errorf("lid chat still around: %v", err)
	}
	rows, _, _ := repo.Page(ctx, e.db, alice.String(), 0, 10)
	if len(rows) != 2 {
		t.Fatalf("pn chat has %d messages, want 2", len(rows))
	}
	for _, r := range rows {
		if r.SenderJID != alice.String() {
			t.Errorf("sender not normalized: %s", r.SenderJID)
		}
	}
	if len(e.rec.take(evnames.ChatRemoved)) != 1 {
		t.Error("chat:removed not emitted for the lid chat")
	}
}

type fakeAvatars struct{ invalidated []string }

func (f *fakeAvatars) Invalidate(_ context.Context, jid string) { f.invalidated = append(f.invalidated, jid) }

func TestPictureChange(t *testing.T) {
	e := newEnv(t)
	av := &fakeAvatars{}
	e.in.avatars = av
	lid := types.NewJID("200000000000009", types.HiddenUserServer)
	e.lids.PutLIDMapping(context.Background(), lid, alice)
	e.handle(t, &events.Picture{JID: lid, Author: lid, Timestamp: tick()})
	if len(av.invalidated) != 1 || av.invalidated[0] != alice.String() {
		t.Fatalf("invalidated %v, want the canonical jid", av.invalidated)
	}
	evs := e.rec.take(evnames.AvatarChange)
	if len(evs) != 1 || evs[0].(domain.AvatarChangedEvent).JID != alice.String() {
		t.Errorf("avatar:changed: %+v", evs)
	}
}
