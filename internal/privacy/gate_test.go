package privacy

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/types"

	"github.com/whatszori/WhatsZori/internal/domain"
)

type call struct {
	kind   string
	state  string
	chat   string
	sender string
	ids    []string
}

type fakeTransport struct{ calls []call }

func (f *fakeTransport) SendPresence(_ context.Context, s types.Presence) error {
	f.calls = append(f.calls, call{kind: "presence", state: string(s)})
	return nil
}

func (f *fakeTransport) SendChatPresence(_ context.Context, jid types.JID, s types.ChatPresence, _ types.ChatPresenceMedia) error {
	f.calls = append(f.calls, call{kind: "typing", state: string(s), chat: jid.String()})
	return nil
}

func (f *fakeTransport) MarkRead(_ context.Context, ids []types.MessageID, _ time.Time, chat, sender types.JID) error {
	f.calls = append(f.calls, call{kind: "read", chat: chat.String(), sender: sender.String(), ids: ids})
	return nil
}

func (f *fakeTransport) count(kind string) int {
	n := 0
	for _, c := range f.calls {
		if c.kind == kind {
			n++
		}
	}
	return n
}

type fakeReads struct {
	pending map[string][]Pending
	sent    map[string][]string
}

func (f *fakeReads) PendingReads(_ context.Context, chat string) ([]Pending, error) {
	var out []Pending
	for _, p := range f.pending[chat] {
		if !contains(f.sent[chat], p.ID) {
			out = append(out, p)
		}
	}
	return out, nil
}

func (f *fakeReads) MarkReadSent(_ context.Context, chat string, ids []string) error {
	f.sent[chat] = append(f.sent[chat], ids...)
	return nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

var (
	dm    = types.NewJID("491701234567", types.DefaultUserServer)
	group = types.NewJID("1203630", types.GroupServer)
)

func setup(mode domain.ReadReceiptMode) (*Gate, *fakeTransport, *fakeReads) {
	now := time.Now()
	reads := &fakeReads{
		pending: map[string][]Pending{
			dm.String():    {{ID: "A", Sender: dm.String(), TS: now}, {ID: "B", Sender: dm.String(), TS: now}},
			group.String(): {{ID: "G1", Sender: "111@s.whatsapp.net", TS: now}, {ID: "G2", Sender: "222@s.whatsapp.net", TS: now}, {ID: "G3", Sender: "111@s.whatsapp.net", TS: now}},
		},
		sent: map[string][]string{},
	}
	t := &fakeTransport{}
	g := New(reads, domain.GhostSettings{ReadReceipts: mode})
	g.SetTransport(t)
	return g, t, reads
}

func TestReadAlways(t *testing.T) {
	ctx := context.Background()
	g, tr, reads := setup(domain.ReadAlways)
	if err := g.ChatOpened(ctx, dm); err != nil {
		t.Fatal(err)
	}
	if tr.count("read") != 1 || len(tr.calls[0].ids) != 2 {
		t.Fatalf("want one receipt for 2 messages, got %+v", tr.calls)
	}
	if tr.calls[0].sender != "" {
		t.Errorf("1:1 receipts must not carry a participant, got %q", tr.calls[0].sender)
	}
	// opening again doesn't resend
	g.ChatOpened(ctx, dm)
	if tr.count("read") != 1 {
		t.Errorf("receipts sent twice")
	}
	if len(reads.sent[dm.String()]) != 2 {
		t.Errorf("sent ids not recorded: %v", reads.sent)
	}
}

func TestReadAlwaysGroupSplitsBySender(t *testing.T) {
	g, tr, _ := setup(domain.ReadAlways)
	g.ChatOpened(context.Background(), group)
	if tr.count("read") != 2 {
		t.Fatalf("want one receipt per sender, got %+v", tr.calls)
	}
	for _, c := range tr.calls {
		if c.sender == "" {
			t.Errorf("group receipt without participant: %+v", c)
		}
	}
}

func TestReadNever(t *testing.T) {
	ctx := context.Background()
	g, tr, _ := setup(domain.ReadNever)
	g.ChatOpened(ctx, dm)
	g.BeforeSend(ctx, dm)
	g.ChatOpened(ctx, group)
	if len(tr.calls) != 0 {
		t.Fatalf("never mode sent something: %+v", tr.calls)
	}
}

func TestReadOnReply(t *testing.T) {
	ctx := context.Background()
	g, tr, _ := setup(domain.ReadOnReply)
	g.ChatOpened(ctx, dm)
	if len(tr.calls) != 0 {
		t.Fatalf("on-reply sent receipts just for opening: %+v", tr.calls)
	}
	g.BeforeSend(ctx, dm)
	if tr.count("read") != 1 || len(tr.calls[0].ids) != 2 {
		t.Fatalf("on-reply didn't mark the chat read before sending: %+v", tr.calls)
	}
	g.BeforeSend(ctx, dm)
	if tr.count("read") != 1 {
		t.Errorf("second reply resent receipts")
	}
}

func TestHideTyping(t *testing.T) {
	ctx := context.Background()
	g, tr, _ := setup(domain.ReadAlways)
	g.Typing(ctx, dm, true)
	if tr.count("typing") != 1 || tr.calls[0].state != string(types.ChatPresenceComposing) {
		t.Fatalf("typing not sent: %+v", tr.calls)
	}
	g.SetGhost(ctx, domain.GhostSettings{HideTyping: true, ReadReceipts: domain.ReadAlways})
	g.Typing(ctx, dm, true)
	g.Typing(ctx, dm, false)
	if tr.count("typing") != 1 {
		t.Errorf("typing sent while hidden: %+v", tr.calls)
	}
}

func TestHideOnline(t *testing.T) {
	ctx := context.Background()
	g, tr, _ := setup(domain.ReadAlways)
	g.Online(ctx)
	if tr.calls[0].state != string(types.PresenceAvailable) {
		t.Fatalf("want available, got %+v", tr.calls)
	}
	// turning it on announces unavailable right away
	g.SetGhost(ctx, domain.GhostSettings{HideOnline: true, ReadReceipts: domain.ReadAlways})
	if last := tr.calls[len(tr.calls)-1]; last.state != string(types.PresenceUnavailable) {
		t.Fatalf("want unavailable after enabling, got %+v", last)
	}
	g.Online(ctx)
	for _, c := range tr.calls[1:] {
		if c.state == string(types.PresenceAvailable) {
			t.Errorf("available sent while hidden")
		}
	}
}

func TestNoTransportIsQuiet(t *testing.T) {
	g := New(&fakeReads{pending: map[string][]Pending{}, sent: map[string][]string{}}, domain.DefaultGhost())
	ctx := context.Background()
	for _, err := range []error{g.Online(ctx), g.Typing(ctx, dm, true), g.ChatOpened(ctx, dm), g.BeforeSend(ctx, dm)} {
		if err != nil {
			t.Fatal(err)
		}
	}
}

// Nobody outside this package (and the whatsmeow adapter that implements the transport) may call
// the presence, typing or read receipt methods directly.
func TestOnlyTheGateSendsPresence(t *testing.T) {
	banned := map[string]bool{"SendPresence": true, "SendChatPresence": true, "MarkRead": true}
	root := filepath.Join("..", "..")
	allowed := map[string]bool{
		filepath.Join(root, "internal", "privacy", "gate.go"): true,
		filepath.Join(root, "internal", "wa", "client.go"):    true,
	}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case "node_modules", "frontend", ".git", "bin", "build":
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") || allowed[path] {
			return nil
		}
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(f, func(n ast.Node) bool {
			if c, ok := n.(*ast.CallExpr); ok {
				if sel, ok := c.Fun.(*ast.SelectorExpr); ok && banned[sel.Sel.Name] {
					t.Errorf("%s calls %s directly; go through privacy.Gate", path, sel.Sel.Name)
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
