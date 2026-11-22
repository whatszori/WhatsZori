package wa

import (
	"fmt"
	"log/slog"

	waLog "go.mau.fi/whatsmeow/util/log"

	"github.com/whatszori/WhatsZori/internal/redact"
)

// slogger sends whatsmeow's logs to slog with phone numbers masked. Debug is dropped: at that
// level whatsmeow dumps whole stanzas, which can contain message content.
type slogger struct {
	module string
	l      *slog.Logger
}

func NewLogger(l *slog.Logger) waLog.Logger {
	if l == nil {
		l = slog.Default()
	}
	return slogger{module: "whatsmeow", l: l}
}

func (s slogger) msg(f string, args []any) string { return redact.Digits(fmt.Sprintf(f, args...)) }

func (s slogger) Warnf(f string, args ...any)  { s.l.Warn(s.msg(f, args), "module", s.module) }
func (s slogger) Errorf(f string, args ...any) { s.l.Error(s.msg(f, args), "module", s.module) }
func (s slogger) Infof(f string, args ...any)  { s.l.Info(s.msg(f, args), "module", s.module) }
func (s slogger) Debugf(string, ...any)        {}
func (s slogger) Sub(module string) waLog.Logger {
	return slogger{module: s.module + "/" + module, l: s.l}
}
