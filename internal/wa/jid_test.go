package wa

import (
	"context"
	"testing"

	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

type mapLIDs map[types.JID]types.JID

func (m mapLIDs) PutManyLIDMappings(ctx context.Context, ms []waStore.LIDMapping) error {
	for _, x := range ms {
		m[x.LID] = x.PN
	}
	return nil
}
func (m mapLIDs) PutLIDMapping(_ context.Context, lid, pn types.JID) error { m[lid] = pn; return nil }
func (m mapLIDs) GetPNForLID(_ context.Context, lid types.JID) (types.JID, error) {
	return m[lid], nil
}
func (m mapLIDs) GetLIDForPN(_ context.Context, pn types.JID) (types.JID, error) {
	for l, p := range m {
		if p == pn {
			return l, nil
		}
	}
	return types.EmptyJID, nil
}
func (m mapLIDs) GetManyLIDsForPNs(context.Context, []types.JID) (map[types.JID]types.JID, error) {
	return nil, nil
}

func TestCanonical(t *testing.T) {
	ctx := context.Background()
	pn := types.NewJID("491701234567", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)
	unknownLID := types.NewJID("999", types.HiddenUserServer)
	store := mapLIDs{lid: pn}
	j := NewJIDs(func() waStore.LIDStore { return store })

	cases := []struct {
		in, want types.JID
	}{
		{pn, pn},
		{types.NewADJID(pn.User, 0, 12), pn}, // device suffix dropped
		{lid, pn},
		{types.NewADJID(lid.User, 1, 3).ToNonAD(), pn},
		{types.JID{User: lid.User, Server: types.HiddenUserServer, Device: 7}, pn},
		{unknownLID, unknownLID}, // no mapping yet: stays a LID
		{types.NewJID("120363", types.GroupServer), types.NewJID("120363", types.GroupServer)},
		{types.EmptyJID, types.EmptyJID},
	}
	for _, c := range cases {
		if got := j.Canonical(ctx, c.in); got != c.want {
			t.Errorf("Canonical(%s) = %s, want %s", c.in, got, c.want)
		}
	}
}

func TestLearn(t *testing.T) {
	ctx := context.Background()
	store := mapLIDs{}
	j := NewJIDs(func() waStore.LIDStore { return store })
	pn := types.NewJID("491701234567", types.DefaultUserServer)
	lid := types.NewJID("123456789012345", types.HiddenUserServer)

	if _, _, isNew := j.Learn(ctx, pn, types.NewJID("other", types.DefaultUserServer)); isNew {
		t.Error("two phone numbers aren't a mapping")
	}
	gotLID, gotPN, isNew := j.Learn(ctx, types.JID{User: pn.User, Server: pn.Server, Device: 3}, lid)
	if !isNew || gotLID != lid || gotPN != pn {
		t.Fatalf("Learn = %s %s %v", gotLID, gotPN, isNew)
	}
	if _, _, isNew := j.Learn(ctx, lid, pn); isNew {
		t.Error("known mapping reported as new")
	}
	if j.Canonical(ctx, lid) != pn {
		t.Error("learned mapping not used")
	}
}

func TestNoStore(t *testing.T) {
	lid := types.NewJID("1", types.HiddenUserServer)
	var j *JIDs
	if j.Canonical(context.Background(), lid) != lid {
		t.Error("nil JIDs should pass through")
	}
	j = NewJIDs(func() waStore.LIDStore { return nil })
	if j.Canonical(context.Background(), lid) != lid {
		t.Error("missing store should pass through")
	}
}
