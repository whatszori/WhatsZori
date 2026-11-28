package ingest

import (
	"fmt"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"github.com/whatszori/WhatsZori/internal/store/repo"
)

// content is what we pull out of a waE2E.Message for the messages and media tables.
type content struct {
	kind         string
	body         string
	quotedID     string
	quotedSender string
	forwardScore int
	media        *repo.MediaRow
}

type withContext interface {
	GetContextInfo() *waE2E.ContextInfo
}

// isMetaOnly is true for messages that carry nothing to show: sender key distribution, context
// info, and the like. Those aren't stored. Anything else we don't understand is stored as unknown.
func isMetaOnly(msg *waE2E.Message) bool {
	if msg == nil {
		return true
	}
	c := proto.Clone(msg).(*waE2E.Message)
	c.SenderKeyDistributionMessage = nil
	c.MessageContextInfo = nil
	c.FastRatchetKeySenderKeyDistributionMessage = nil
	return proto.Size(c) == 0
}

// isControl covers message types that change other messages or state rather than being one.
func isControl(msg *waE2E.Message) bool {
	return msg.GetProtocolMessage() != nil || msg.GetReactionMessage() != nil || msg.GetEncReactionMessage() != nil ||
		msg.GetPollUpdateMessage() != nil || msg.GetKeepInChatMessage() != nil || msg.GetPinInChatMessage() != nil ||
		msg.GetSecretEncryptedMessage() != nil || msg.GetEncEventResponseMessage() != nil ||
		// the marker before an album; its photos come as their own messages
		msg.GetAlbumMessage() != nil
}

func extract(msg *waE2E.Message) content {
	var c content
	var ctx withContext
	switch {
	case msg.Conversation != nil:
		c.kind, c.body = repo.KindText, msg.GetConversation()
	case msg.ExtendedTextMessage != nil:
		m := msg.GetExtendedTextMessage()
		c.kind, c.body, ctx = repo.KindText, m.GetText(), m
	case msg.ImageMessage != nil:
		m := msg.GetImageMessage()
		c.kind, c.body, ctx = repo.KindImage, m.GetCaption(), m
		c.media = &repo.MediaRow{MediaType: "image", Mime: m.GetMimetype(), Size: int64(m.GetFileLength()),
			Width: int(m.GetWidth()), Height: int(m.GetHeight()), MediaKey: m.GetMediaKey(), DirectPath: m.GetDirectPath(),
			FileSHA256: m.GetFileSHA256(), FileEncSHA256: m.GetFileEncSHA256(), Thumbnail: m.GetJPEGThumbnail()}
	case msg.VideoMessage != nil:
		m := msg.GetVideoMessage()
		c.kind, c.body, ctx = repo.KindVideo, m.GetCaption(), m
		if m.GetGifPlayback() {
			// WhatsApp sends GIFs as short mp4s with this flag
			c.kind = repo.KindGif
		}
		c.media = &repo.MediaRow{MediaType: "video", Mime: m.GetMimetype(), Size: int64(m.GetFileLength()),
			Width: int(m.GetWidth()), Height: int(m.GetHeight()), Duration: int(m.GetSeconds()), MediaKey: m.GetMediaKey(),
			DirectPath: m.GetDirectPath(), FileSHA256: m.GetFileSHA256(), FileEncSHA256: m.GetFileEncSHA256(),
			Thumbnail: m.GetJPEGThumbnail()}
	case msg.PtvMessage != nil:
		m := msg.GetPtvMessage()
		c.kind, c.body, ctx = repo.KindRound, m.GetCaption(), m
		c.media = &repo.MediaRow{MediaType: "video", Mime: m.GetMimetype(), Size: int64(m.GetFileLength()),
			Width: int(m.GetWidth()), Height: int(m.GetHeight()), Duration: int(m.GetSeconds()), MediaKey: m.GetMediaKey(),
			DirectPath: m.GetDirectPath(), FileSHA256: m.GetFileSHA256(), FileEncSHA256: m.GetFileEncSHA256(),
			Thumbnail: m.GetJPEGThumbnail()}
	case msg.AudioMessage != nil:
		m := msg.GetAudioMessage()
		c.kind, ctx = repo.KindAudio, m
		if m.GetPTT() {
			c.kind = repo.KindVoice
		}
		c.media = &repo.MediaRow{MediaType: "audio", Mime: m.GetMimetype(), Size: int64(m.GetFileLength()),
			Duration: int(m.GetSeconds()), Waveform: m.GetWaveform(), MediaKey: m.GetMediaKey(), DirectPath: m.GetDirectPath(),
			FileSHA256: m.GetFileSHA256(), FileEncSHA256: m.GetFileEncSHA256()}
	case msg.DocumentMessage != nil:
		m := msg.GetDocumentMessage()
		c.kind, c.body, ctx = repo.KindDocument, m.GetCaption(), m
		name := m.GetFileName()
		if name == "" {
			name = m.GetTitle()
		}
		c.media = &repo.MediaRow{MediaType: "document", Mime: m.GetMimetype(), FileName: name, Size: int64(m.GetFileLength()),
			MediaKey: m.GetMediaKey(), DirectPath: m.GetDirectPath(), FileSHA256: m.GetFileSHA256(),
			FileEncSHA256: m.GetFileEncSHA256(), Thumbnail: m.GetJPEGThumbnail()}
	case msg.StickerMessage != nil:
		m := msg.GetStickerMessage()
		c.kind, ctx = repo.KindSticker, m
		c.media = &repo.MediaRow{MediaType: "image", Mime: m.GetMimetype(), Size: int64(m.GetFileLength()),
			Width: int(m.GetWidth()), Height: int(m.GetHeight()), MediaKey: m.GetMediaKey(), DirectPath: m.GetDirectPath(),
			FileSHA256: m.GetFileSHA256(), FileEncSHA256: m.GetFileEncSHA256(), Thumbnail: m.GetPngThumbnail()}
	case msg.LocationMessage != nil:
		m := msg.GetLocationMessage()
		c.kind, ctx = repo.KindLocation, m
		c.body = "📍 " + firstNonEmpty(m.GetName(), m.GetAddress(), fmt.Sprintf("Location %.5f, %.5f", m.GetDegreesLatitude(), m.GetDegreesLongitude()))
	case msg.LiveLocationMessage != nil:
		m := msg.GetLiveLocationMessage()
		c.kind, ctx = repo.KindLocation, m
		c.body = "📍 Live location"
		if m.GetCaption() != "" {
			c.body += ": " + m.GetCaption()
		}
	case msg.ContactMessage != nil:
		m := msg.GetContactMessage()
		c.kind, ctx = repo.KindContact, m
		c.body = "👤 " + firstNonEmpty(m.GetDisplayName(), "Contact")
	case msg.ContactsArrayMessage != nil:
		m := msg.GetContactsArrayMessage()
		c.kind, ctx = repo.KindContact, m
		c.body = fmt.Sprintf("👤 %d contacts", len(m.GetContacts()))
	case msg.EventInviteMessage != nil:
		m := msg.GetEventInviteMessage()
		c.kind, ctx = repo.KindEvent, m
		c.body = "📅 " + firstNonEmpty(m.GetEventTitle(), "Event")
	case msg.ButtonsMessage != nil:
		m := msg.GetButtonsMessage()
		c.kind, ctx = repo.KindBusiness, m
		c.body = firstNonEmpty(m.GetContentText(), m.GetText())
		c.media = headerMedia(m.GetImageMessage(), m.GetVideoMessage(), m.GetDocumentMessage())
	case msg.ListMessage != nil:
		m := msg.GetListMessage()
		c.kind, ctx = repo.KindBusiness, m
		c.body = firstNonEmpty(m.GetDescription(), m.GetTitle())
	case msg.InteractiveMessage != nil:
		m := msg.GetInteractiveMessage()
		c.kind, ctx = repo.KindBusiness, m
		c.body = firstNonEmpty(m.GetBody().GetText(), m.GetHeader().GetTitle())
		h := m.GetHeader()
		c.media = headerMedia(h.GetImageMessage(), h.GetVideoMessage(), h.GetDocumentMessage())
	case msg.TemplateMessage != nil:
		m := msg.GetTemplateMessage()
		c.kind, ctx = repo.KindBusiness, m
		if it := m.GetInteractiveMessageTemplate(); it != nil {
			c.body = firstNonEmpty(it.GetBody().GetText(), it.GetHeader().GetTitle())
			h := it.GetHeader()
			c.media = headerMedia(h.GetImageMessage(), h.GetVideoMessage(), h.GetDocumentMessage())
			break
		}
		h := m.GetHydratedTemplate()
		if h == nil {
			h = m.GetHydratedFourRowTemplate()
		}
		c.body = firstNonEmpty(h.GetHydratedContentText(), h.GetHydratedTitleText())
		c.media = headerMedia(h.GetImageMessage(), h.GetVideoMessage(), h.GetDocumentMessage())
	// answers to business messages (ours and other people's) read as text replies
	case msg.ButtonsResponseMessage != nil:
		m := msg.GetButtonsResponseMessage()
		c.kind, c.body, ctx = repo.KindText, m.GetSelectedDisplayText(), m
	case msg.TemplateButtonReplyMessage != nil:
		m := msg.GetTemplateButtonReplyMessage()
		c.kind, c.body, ctx = repo.KindText, m.GetSelectedDisplayText(), m
	case msg.ListResponseMessage != nil:
		m := msg.GetListResponseMessage()
		c.kind, c.body, ctx = repo.KindText, firstNonEmpty(m.GetTitle(), m.GetDescription()), m
	case msg.InteractiveResponseMessage != nil:
		m := msg.GetInteractiveResponseMessage()
		c.kind, c.body, ctx = repo.KindText, m.GetBody().GetText(), m
	case msg.EventMessage != nil:
		m := msg.GetEventMessage()
		c.kind, ctx = repo.KindEvent, m
		c.body = "📅 " + firstNonEmpty(m.GetName(), "Event")
	case msg.PollCreationMessage != nil || msg.PollCreationMessageV2 != nil || msg.PollCreationMessageV3 != nil:
		m := msg.GetPollCreationMessage()
		if m == nil {
			m = msg.GetPollCreationMessageV2()
		}
		if m == nil {
			m = msg.GetPollCreationMessageV3()
		}
		c.kind, ctx = repo.KindPoll, m
		c.body = "📊 " + firstNonEmpty(m.GetName(), "Poll")
		for _, o := range m.GetOptions() {
			c.body += "\n• " + o.GetOptionName()
		}
	default:
		c.kind = repo.KindUnknown
	}
	if ctx != nil {
		if ci := ctx.GetContextInfo(); ci.GetStanzaID() != "" {
			c.quotedID = ci.GetStanzaID()
			c.quotedSender = ci.GetParticipant()
		}
		if ci := ctx.GetContextInfo(); ci.GetIsForwarded() {
			c.forwardScore = max(1, int(ci.GetForwardingScore()))
		}
	}
	return c
}

// textOf is the editable text of a message: the text itself, or a media caption.
func textOf(msg *waE2E.Message) string {
	switch {
	case msg.Conversation != nil:
		return msg.GetConversation()
	case msg.ExtendedTextMessage != nil:
		return msg.GetExtendedTextMessage().GetText()
	case msg.ImageMessage != nil:
		return msg.GetImageMessage().GetCaption()
	case msg.VideoMessage != nil:
		return msg.GetVideoMessage().GetCaption()
	case msg.DocumentMessage != nil:
		return msg.GetDocumentMessage().GetCaption()
	}
	return ""
}

// headerMedia is the picture, video or file in a business message's header, as media of its own.
func headerMedia(img *waE2E.ImageMessage, vid *waE2E.VideoMessage, doc *waE2E.DocumentMessage) *repo.MediaRow {
	switch {
	case img != nil:
		return extract(&waE2E.Message{ImageMessage: img}).media
	case vid != nil:
		return extract(&waE2E.Message{VideoMessage: vid}).media
	case doc != nil:
		return extract(&waE2E.Message{DocumentMessage: doc}).media
	}
	return nil
}

func firstNonEmpty(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}
