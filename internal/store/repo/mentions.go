package repo

import (
	"context"
	"strings"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/domain"
)

// Mentions in WhatsApp are plain text, "@<user part of the JID>", with the JIDs listed in the
// message's ContextInfo. In groups that use LIDs the user part is the LID number, which means
// nothing to a person, so the view swaps each token for the name it belongs to.

// MentionedJIDs returns the JIDs a stored message mentions (from its raw proto).
func MentionedJIDs(raw []byte) []string {
	if raw == nil {
		return nil
	}
	var msg waE2E.Message
	if proto.Unmarshal(raw, &msg) != nil {
		return nil
	}
	var ci *waE2E.ContextInfo
	switch {
	case msg.GetExtendedTextMessage() != nil:
		ci = msg.GetExtendedTextMessage().GetContextInfo()
	case msg.GetImageMessage() != nil:
		ci = msg.GetImageMessage().GetContextInfo()
	case msg.GetVideoMessage() != nil:
		ci = msg.GetVideoMessage().GetContextInfo()
	case msg.GetDocumentMessage() != nil:
		ci = msg.GetDocumentMessage().GetContextInfo()
	case msg.GetDocumentWithCaptionMessage().GetMessage().GetDocumentMessage() != nil:
		ci = msg.GetDocumentWithCaptionMessage().GetMessage().GetDocumentMessage().GetContextInfo()
	case msg.GetAudioMessage() != nil:
		ci = msg.GetAudioMessage().GetContextInfo()
	}
	jids := ci.GetMentionedJID()
	out := make([]string, 0, len(jids))
	for _, j := range jids {
		if j != "" {
			out = append(out, nonAD(j))
		}
	}
	return out
}

// "123:4@s.whatsapp.net" -> "123@s.whatsapp.net"
func nonAD(jid string) string {
	user, server, ok := strings.Cut(jid, "@")
	if !ok {
		return jid
	}
	if i := strings.IndexByte(user, ':'); i >= 0 {
		user = user[:i]
	}
	return user + "@" + server
}

// MentionToken is the text a JID's mention appears as: "@" and its user part.
func MentionToken(jid string) string {
	user, _, _ := strings.Cut(jid, "@")
	return user
}

// ContactsByLID finds contacts by their LID.
func ContactsByLID(ctx context.Context, q DBTX, lids []string) (map[string]ContactRow, error) {
	out := map[string]ContactRow{}
	if len(lids) == 0 {
		return out, nil
	}
	rows, err := q.QueryContext(ctx, `SELECT `+contactCols+` FROM contacts WHERE lid IN (`+placeholders(len(lids))+`)`, anys(lids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		c, err := scanContact(rows)
		if err != nil {
			return nil, err
		}
		out[c.LID] = c
	}
	return out, rows.Err()
}

// resolveMentions turns mentioned JIDs into names: by phone-number JID, by LID, or, failing both,
// the phone number (or "Unknown" for a LID we can't place).
func (v View) resolveMentions(ctx context.Context, q DBTX, jids []string) (map[string]domain.Mention, error) {
	out := map[string]domain.Mention{}
	if len(jids) == 0 {
		return out, nil
	}
	var pns, lids []string
	for _, j := range jids {
		if strings.HasSuffix(j, "@lid") {
			lids = append(lids, j)
		} else {
			pns = append(pns, j)
		}
	}
	byJID, err := ContactsFor(ctx, q, pns)
	if err != nil {
		return nil, err
	}
	byLID, err := ContactsByLID(ctx, q, lids)
	if err != nil {
		return nil, err
	}
	for _, j := range jids {
		m := domain.Mention{JID: j, Token: MentionToken(j)}
		if c, ok := byLID[j]; ok {
			m.JID, m.Name = c.JID, v.Name(c, c.JID)
		} else {
			m.Name = v.Name(byJID[j], j)
		}
		if m.Name == "Unknown" {
			m.Name = ""
		}
		out[j] = m
	}
	return out, nil
}
