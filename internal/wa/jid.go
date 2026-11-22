package wa

import (
	"context"
	"sync"

	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

// JIDs turns whatever address WhatsApp used (phone number, LID, with or without a device) into
// one canonical key, so a person never shows up as two chats.
//
// The canonical form is the phone-number JID when we know the mapping, the LID otherwise. Groups,
// broadcasts and newsletters pass through without the device part. When a mapping shows up later,
// Learn reports it so the caller can fold the LID chat into the phone-number one.
type JIDs struct {
	mu   sync.RWMutex
	lids func() waStore.LIDStore
}

func NewJIDs(lids func() waStore.LIDStore) *JIDs {
	return &JIDs{lids: lids}
}

func (j *JIDs) store() waStore.LIDStore {
	if j == nil || j.lids == nil {
		return nil
	}
	return j.lids()
}

func (j *JIDs) Canonical(ctx context.Context, jid types.JID) types.JID {
	if jid.IsEmpty() {
		return jid
	}
	jid = jid.ToNonAD()
	if jid.Server != types.HiddenUserServer {
		return jid
	}
	s := j.store()
	if s == nil {
		return jid
	}
	j.mu.RLock()
	defer j.mu.RUnlock()
	pn, err := s.GetPNForLID(ctx, jid)
	if err != nil || pn.IsEmpty() {
		return jid
	}
	return pn.ToNonAD()
}

func (j *JIDs) Key(ctx context.Context, jid types.JID) string {
	return j.Canonical(ctx, jid).String()
}

// Learn records that a and b are the same user, when one is a LID and the other a phone number.
// It returns the pair when it's a mapping we didn't have before.
func (j *JIDs) Learn(ctx context.Context, a, b types.JID) (lid, pn types.JID, isNew bool) {
	a, b = a.ToNonAD(), b.ToNonAD()
	switch {
	case a.Server == types.HiddenUserServer && b.Server == types.DefaultUserServer:
		lid, pn = a, b
	case a.Server == types.DefaultUserServer && b.Server == types.HiddenUserServer:
		lid, pn = b, a
	default:
		return types.EmptyJID, types.EmptyJID, false
	}
	s := j.store()
	if s == nil {
		return lid, pn, false
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if known, err := s.GetPNForLID(ctx, lid); err == nil && known.ToNonAD() == pn {
		return lid, pn, false
	}
	if err := s.PutLIDMapping(ctx, lid, pn); err != nil {
		return lid, pn, false
	}
	return lid, pn, true
}

// ForSend is the JID to address a chat with. Canonical keys are already what whatsmeow wants.
func ForSend(key string) (types.JID, error) {
	return types.ParseJID(key)
}
