package wa_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/antispam"
	"github.com/whatszori/WhatsZori/internal/domain"
	"github.com/whatszori/WhatsZori/internal/ingest"
	"github.com/whatszori/WhatsZori/internal/privacy"
	"github.com/whatszori/WhatsZori/internal/store"
	"github.com/whatszori/WhatsZori/internal/store/repo"
	"github.com/whatszori/WhatsZori/internal/wa"
)

var (
	me    = types.NewJID("10000000001", types.DefaultUserServer)
	alice = types.NewJID("491700000001", types.DefaultUserServer)
)

type sent struct {
	to  types.JID
	msg *waE2E.Message
	id  string
}

type fakeClient struct {
	wa.Client
	real    *whatsmeow.Client
	mu      sync.Mutex
	sent    []sent
	sendErr error
	n       int
}

func newFake() *fakeClient {
	id := me
	return &fakeClient{real: whatsmeow.NewClient(&waStore.Device{ID: &id}, nil)}
}

func (f *fakeClient) OwnID() types.JID  { return me }
func (f *fakeClient) IsConnected() bool { return true }
func (f *fakeClient) GenerateMessageID() types.MessageID {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.n++
	return "OUT" + strconv.Itoa(f.n)
}
func (f *fakeClient) SendMessage(_ context.Context, to types.JID, msg *waE2E.Message, id types.MessageID) (whatsmeow.SendResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, sent{to, msg, id})
	return whatsmeow.SendResponse{Timestamp: time.Now()}, f.sendErr
}
func (f *fakeClient) BuildEdit(chat types.JID, id types.MessageID, c *waE2E.Message) *waE2E.Message {
	return f.real.BuildEdit(chat, id, c)
}
func (f *fakeClient) BuildRevoke(chat, sender types.JID, id types.MessageID) *waE2E.Message {
	return f.real.BuildRevoke(chat, sender, id)
}
func (f *fakeClient) BuildReaction(chat, sender types.JID, id types.MessageID, e string) *waE2E.Message {
	return f.real.BuildReaction(chat, sender, id, e)
}

type transport struct{ reads int }

func (t *transport) SendPresence(context.Context, types.Presence) error { return nil }
func (t *transport) SendChatPresence(context.Context, types.JID, types.ChatPresence, types.ChatPresenceMedia) error {
	return nil
}
func (t *transport) MarkRead(context.Context, []types.MessageID, time.Time, types.JID, types.JID) error {
	t.reads++
	return nil
}

type discard struct{}

func (discard) Emit(string, any) {}

type env struct {
	db  *sql.DB
	cli *fakeClient
	in  *ingest.Ingester
	s   *wa.Sender
	tr  *transport
	g   *privacy.Gate
}

func newEnv(t *testing.T) *env {
	t.Helper()
	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "whatszori.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := &env{db: db, cli: newFake(), tr: &transport{}}
	jids := wa.NewJIDs(func() waStore.LIDStore { return nil })
	e.in = ingest.New(ingest.Options{DB: db, JIDs: jids, Emit: discard{}, Client: func() wa.Client { return e.cli }})
	e.g = privacy.New(ingest.Reads{DB: db}, domain.DefaultGhost())
	e.g.SetTransport(e.tr)
	e.s = &wa.Sender{
		DB:      db,
		Ready:   func() (wa.Client, error) { return e.cli, nil },
		Gate:    e.g,
		Limiter: antispam.New(antispam.DefaultLimits()),
		Local:   e.in,
		Emit:    discard{},
		Async:   func(fn func()) { fn() },
	}
	return e
}

func (e *env) incoming(t *testing.T, id, body string) int64 {
	t.Helper()
	err := e.in.Handle(&events.Message{
		Info:    types.MessageInfo{MessageSource: types.MessageSource{Chat: alice, Sender: alice}, ID: id, Timestamp: time.Now()},
		Message: &waE2E.Message{Conversation: proto.String(body)},
	})
	if err != nil {
		t.Fatal(err)
	}
	m, _ := repo.GetMessageByID(context.Background(), e.db, alice.String(), id)
	return m.PK
}

func TestSendTextAndReply(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	qpk := e.incoming(t, "IN1", "question?")

	m, err := e.s.SendText(ctx, alice.String(), "answer", qpk)
	if err != nil {
		t.Fatal(err)
	}
	if m.Status != domain.StatusPending || !m.FromMe || m.ReplyTo == nil || m.ReplyTo.Text != "question?" {
		t.Fatalf("returned message: %+v", m)
	}
	if len(e.cli.sent) != 1 {
		t.Fatalf("sent %d stanzas", len(e.cli.sent))
	}
	ci := e.cli.sent[0].msg.GetExtendedTextMessage().GetContextInfo()
	if ci.GetStanzaID() != "IN1" || ci.GetParticipant() != alice.String() || ci.GetQuotedMessage().GetConversation() != "question?" {
		t.Errorf("reply context: %+v", ci)
	}
	pk, _ := strconv.ParseInt(m.PK, 10, 64)
	row, _ := repo.GetMessage(ctx, e.db, pk)
	if row.Status != "sent" || row.MsgID != e.cli.sent[0].id {
		t.Errorf("after send: status=%q id=%q", row.Status, row.MsgID)
	}
}

func TestSendFailureMarksFailed(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.cli.sendErr = errors.New("boom")
	m, err := e.s.SendText(ctx, alice.String(), "hi", 0)
	if err != nil {
		t.Fatal(err)
	}
	pk, _ := strconv.ParseInt(m.PK, 10, 64)
	if row, _ := repo.GetMessage(ctx, e.db, pk); row.Status != "failed" {
		t.Errorf("status %q, want failed", row.Status)
	}
}

func TestOnReplyMarksReadBeforeSending(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.g.SetGhost(ctx, domain.GhostSettings{ReadReceipts: domain.ReadOnReply})
	e.incoming(t, "IN1", "one")
	e.incoming(t, "IN2", "two")
	if err := e.g.ChatOpened(ctx, alice); err != nil || e.tr.reads != 0 {
		t.Fatalf("opening sent receipts in on-reply mode: %d %v", e.tr.reads, err)
	}
	if _, err := e.s.SendText(ctx, alice.String(), "reply", 0); err != nil {
		t.Fatal(err)
	}
	if e.tr.reads != 1 {
		t.Fatalf("read receipts before reply: %d, want 1", e.tr.reads)
	}
	if m, _ := repo.GetMessageByID(ctx, e.db, alice.String(), "IN2"); !m.ReadSent {
		t.Error("not recorded as read")
	}
}

func TestAntispamBlocksBeforeAnythingIsStored(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	text := "Hello friend, this is the very same long message"
	var blocked error
	for i := range 10 {
		chat := types.NewJID("4917000001"+strconv.Itoa(i), types.DefaultUserServer).String()
		if _, err := e.s.SendText(ctx, chat, text, 0); err != nil {
			blocked = err
			break
		}
	}
	var se *antispam.Error
	if !errors.As(blocked, &se) {
		t.Fatalf("bulk send not blocked: %v", blocked)
	}
	if len(e.cli.sent) != 4 {
		t.Errorf("sent %d before blocking, want 4", len(e.cli.sent))
	}
	var n int
	e.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages`).Scan(&n)
	if n != 4 {
		t.Errorf("blocked message was stored: %d rows", n)
	}
}

func TestEditRevokeReact(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	m, _ := e.s.SendText(ctx, alice.String(), "tpyo", 0)
	pk, _ := strconv.ParseInt(m.PK, 10, 64)

	if err := e.s.Edit(ctx, pk, "typo"); err != nil {
		t.Fatal(err)
	}
	edit := e.cli.sent[len(e.cli.sent)-1].msg
	pm := edit.GetEditedMessage().GetMessage().GetProtocolMessage()
	if pm.GetType() != waE2E.ProtocolMessage_MESSAGE_EDIT || pm.GetKey().GetID() != e.cli.sent[0].id || pm.GetEditedMessage().GetConversation() != "typo" {
		t.Fatalf("edit stanza wrong: %v", edit)
	}
	row, _ := repo.GetMessage(ctx, e.db, pk)
	edits, _ := repo.Edits(ctx, e.db, pk)
	if row.Body != "typo" || row.EditCount != 1 || len(edits) != 2 {
		t.Errorf("local edit: %+v, %d versions", row, len(edits))
	}

	qpk := e.incoming(t, "IN1", "nice")
	r, err := e.s.React(ctx, qpk, "👍")
	if err != nil || len(r) != 1 || !r[0].Mine {
		t.Fatalf("react: %+v %v", r, err)
	}
	rm := e.cli.sent[len(e.cli.sent)-1].msg.GetReactionMessage()
	if rm.GetText() != "👍" || rm.GetKey().GetID() != "IN1" || rm.GetKey().GetFromMe() {
		t.Errorf("reaction stanza: %v", rm)
	}
	// same emoji again takes it back
	r, _ = e.s.React(ctx, qpk, "👍")
	if len(r) != 0 || e.cli.sent[len(e.cli.sent)-1].msg.GetReactionMessage().GetText() != "" {
		t.Errorf("toggle off: %+v", r)
	}

	if err := e.s.Revoke(ctx, qpk); !errors.Is(err, wa.ErrNotOwn) {
		t.Errorf("revoking someone else's message: %v", err)
	}
	if err := e.s.Revoke(ctx, pk); err != nil {
		t.Fatal(err)
	}
	rv := e.cli.sent[len(e.cli.sent)-1].msg.GetProtocolMessage()
	if rv.GetType() != waE2E.ProtocolMessage_REVOKE || rv.GetKey().GetID() != e.cli.sent[0].id {
		t.Errorf("revoke stanza: %v", rv)
	}
	row, _ = repo.GetMessage(ctx, e.db, pk)
	if !row.IsDeleted || row.Body != "typo" || row.DeletedBy != me.String() {
		t.Errorf("own revoke not kept locally: %+v", row)
	}
	if err := e.s.Edit(ctx, pk, "after delete"); err == nil {
		t.Error("edited a deleted message")
	}
}

func TestEditWindow(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	m, _ := e.s.SendText(ctx, alice.String(), "old", 0)
	pk, _ := strconv.ParseInt(m.PK, 10, 64)
	e.s.Now = func() time.Time { return time.Now().Add(25 * time.Minute) }
	if err := e.s.Edit(ctx, pk, "new"); !errors.Is(err, wa.ErrEditWindow) {
		t.Errorf("edit after the window: %v", err)
	}
}
