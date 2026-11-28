package repo

import (
	"context"
	"sort"

	"github.com/whatszori/WhatsZori/internal/domain"
)

type ReceiptRow struct {
	Participant string
	Type        string
	TS          int64
}

// ReceiptsFor lists every receipt for one message.
func ReceiptsFor(ctx context.Context, q DBTX, chat, msgID string) ([]ReceiptRow, error) {
	rows, err := q.QueryContext(ctx, `SELECT participant_jid, type, ts FROM receipts WHERE chat_jid = ? AND msg_id = ?`, chat, msgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReceiptRow
	for rows.Next() {
		var r ReceiptRow
		if err := rows.Scan(&r.Participant, &r.Type, &r.TS); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// MessageReceipts says, per person, when a message of ours reached them and when they read (or
// played) it. In a group, members we have no receipt from yet are listed as waiting.
func (v View) MessageReceipts(ctx context.Context, q DBTX, m MessageRow) (domain.MessageReceipts, error) {
	out := domain.MessageReceipts{People: []domain.ReceiptPerson{}}
	rs, err := ReceiptsFor(ctx, q, m.ChatJID, m.MsgID)
	if err != nil {
		return out, err
	}
	people := map[string]*domain.ReceiptPerson{}
	get := func(jid string) *domain.ReceiptPerson {
		p := people[jid]
		if p == nil {
			p = &domain.ReceiptPerson{JID: jid}
			people[jid] = p
		}
		return p
	}
	earliest := func(cur, ts int64) int64 {
		if cur == 0 || ts < cur {
			return ts
		}
		return cur
	}
	for _, r := range rs {
		if r.Participant == v.Me {
			continue
		}
		p := get(r.Participant)
		switch r.Type {
		case "delivered":
			p.DeliveredAt = earliest(p.DeliveredAt, r.TS)
		case "read":
			p.ReadAt = earliest(p.ReadAt, r.TS)
		case "played":
			p.PlayedAt = earliest(p.PlayedAt, r.TS)
		}
	}
	if isGroupJID(m.ChatJID) {
		members, err := Participants(ctx, q, m.ChatJID)
		if err != nil {
			return out, err
		}
		for _, mm := range members {
			if mm.JID != v.Me {
				get(mm.JID)
			}
		}
	} else if len(people) == 0 && m.ChatJID != v.Me {
		get(m.ChatJID)
	}

	jids := make([]string, 0, len(people))
	for j := range people {
		jids = append(jids, j)
	}
	contacts, err := ContactsFor(ctx, q, jids)
	if err != nil {
		return out, err
	}
	for _, p := range people {
		// a read implies it was delivered; some phones only send the read
		if p.DeliveredAt == 0 && (p.ReadAt > 0 || p.PlayedAt > 0) {
			p.DeliveredAt = min(nonZero(p.ReadAt), nonZero(p.PlayedAt))
		}
		p.Name = v.Name(contacts[p.JID], p.JID)
		out.People = append(out.People, *p)
	}
	// read first (earliest first), then delivered, then waiting; names break ties
	rank := func(p domain.ReceiptPerson) int {
		switch {
		case p.ReadAt > 0 || p.PlayedAt > 0:
			return 0
		case p.DeliveredAt > 0:
			return 1
		}
		return 2
	}
	sort.Slice(out.People, func(i, j int) bool {
		a, b := out.People[i], out.People[j]
		if ra, rb := rank(a), rank(b); ra != rb {
			return ra < rb
		}
		return a.Name < b.Name
	})
	return out, nil
}

func nonZero(v int64) int64 {
	if v == 0 {
		return 1<<62 - 1
	}
	return v
}

func isGroupJID(jid string) bool {
	return len(jid) > 5 && jid[len(jid)-5:] == "@g.us"
}
