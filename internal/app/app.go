package app

import (
	"context"
	"io/fs"
	"log/slog"
	"os"
	"strconv"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	wailsevents "github.com/wailsapp/wails/v3/pkg/events"

	"github.com/whatszori/WhatsZori/internal/assets"
	"github.com/whatszori/WhatsZori/internal/boot"
	"github.com/whatszori/WhatsZori/internal/config"
	"github.com/whatszori/WhatsZori/internal/core"
	"github.com/whatszori/WhatsZori/internal/events"
	"github.com/whatszori/WhatsZori/internal/services"
	"github.com/whatszori/WhatsZori/internal/settings"
	"github.com/whatszori/WhatsZori/internal/systheme"
)

// Version is overridden at build time with -ldflags "-X .../internal/app.Version=...".
var Version = "0.1.0"

const (
	appID = "io.github.whatszori.whatszori"
	title = "WhatsZori"

	// --wz-bg-app from tokens.css, used until the frontend reports the real background
	defaultLightBg = "#e9e9eb"
	defaultDarkBg  = "#121214"
)

type App struct {
	cfg      config.Config
	store    *settings.Store
	boot     *boot.Sentinel
	sysTheme *services.SystemTheme

	wails  *application.App
	window *application.WebviewWindow

	mu     sync.Mutex
	state  windowState
	normal rect
}

type windowState struct {
	X          int    `json:"x"`
	Y          int    `json:"y"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Maximised  bool   `json:"maximised"`
	Dark       *bool  `json:"dark,omitempty"`
	Background string `json:"background,omitempty"`
}

func New(cfg config.Config, frontend fs.FS) (*App, error) {
	store, err := settings.Open(cfg.Paths.SettingsFile())
	if err != nil {
		return nil, err
	}
	a := &App{
		cfg:      cfg,
		store:    store,
		boot:     boot.New(cfg.Paths.BootMarker(), cfg.Flags.SafeMode),
		sysTheme: services.NewSystemTheme(systheme.New(), events.Wails{}),
	}
	store.Decode(services.KeyWindow, &a.state)

	wa, err := core.New(context.Background(), core.Options{
		Paths:     cfg.Paths,
		Settings:  store,
		Version:   Version,
		NoConnect: cfg.Flags.NoConnect,
		Out:       events.Wails{},
	})
	if err != nil {
		return nil, err
	}
	if cfg.Flags.NoConnect {
		slog.Warn("WhatsApp connection disabled", "env", config.EnvNoConnect)
	}

	// a second launch exits inside application.New (single instance), so nothing below runs for it
	a.wails = application.New(application.Options{
		Name:        title,
		Description: "Desktop WhatsApp client",
		Services: []application.Service{
			application.NewService(services.NewSystem(Version, cfg.Paths, a.boot, shell{a})),
			application.NewService(services.NewSettings(store)),
			application.NewService(a.sysTheme),
			application.NewService(services.NewThemes(cfg.Paths.Themes, events.Wails{})),
			application.NewService(services.NewWindow(a)),
			application.NewService(services.NewAuth(wa)),
			application.NewService(services.NewChats(wa)),
			application.NewService(services.NewMessages(wa, filePicker{a})),
			application.NewService(services.NewProfile(wa)),
			application.NewService(services.NewPrivacy(wa)),
			application.NewService(services.NewContacts(wa)),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontend),
			Middleware: assets.Middleware(assets.Options{
				ThemesDir:  cfg.Paths.Themes,
				PluginsDir: cfg.Paths.Plugins,
				Media:      wa.Media.Handler(assets.MediaPrefix),
				Avatars:    wa.Avatars.Handler(assets.AvatarPrefix),
				HTMLAttrs:  a.htmlAttrs,
			}),
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:               appID,
			OnSecondInstanceLaunch: func(application.SecondInstanceData) { a.focus() },
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Windows:    application.WindowsOptions{AdditionalBrowserArgs: debugBrowserArgs()},
		OnShutdown: a.saveWindowState,
	})

	a.boot.Begin()
	if a.boot.SafeMode() {
		slog.Warn("starting in safe mode", "recovered", a.boot.Recovered())
	}
	a.createWindow()
	return a, nil
}

func (a *App) Run() error { return a.wails.Run() }

func (a *App) startDark() bool {
	var s struct {
		Appearance struct {
			Theme string `json:"theme"`
		} `json:"appearance"`
	}
	a.store.Decode(services.KeyApp, &s)
	switch s.Appearance.Theme {
	case "dark":
		return true
	case "light":
		return false
	}
	return a.sysTheme.Current().IsDark()
}

func (a *App) htmlAttrs() map[string]string {
	attrs := map[string]string{"data-wz-shell": "wails"}
	if a.startDark() {
		attrs["data-theme"] = "dark"
	} else {
		attrs["data-theme"] = "light"
	}
	return attrs
}

func (a *App) startBackground(dark bool) application.RGBA {
	hex := defaultLightBg
	if dark {
		hex = defaultDarkBg
	}
	// the saved one includes whatever a theme did to the background, but only if it's for the same mode
	if a.state.Background != "" && a.state.Dark != nil && *a.state.Dark == dark {
		hex = a.state.Background
	}
	r, g, b, ok := systheme.ParseHex(hex)
	if !ok {
		r, g, b, _ = systheme.ParseHex(defaultLightBg)
	}
	return application.NewRGB(r, g, b)
}

func (a *App) createWindow() {
	dark := a.startDark()
	theme := application.Light
	if dark {
		theme = application.Dark
	}
	w, h := a.state.Width, a.state.Height
	if w <= 0 || h <= 0 {
		w, h = DefaultWidth, DefaultHeight
	}
	a.normal = rect{a.state.X, a.state.Y, w, h}

	a.window = a.wails.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main",
		Title:            title,
		Width:            max(w, MinWidth),
		Height:           max(h, MinHeight),
		MinWidth:         MinWidth,
		MinHeight:        MinHeight,
		InitialPosition:  application.WindowCentered,
		BackgroundColour: a.startBackground(dark),
		URL:              "/",
		// shown once the saved position has been checked against the current screens
		Hidden: true,
		Windows: application.WindowsWindow{
			// set explicitly, not SystemDefault: with SystemDefault Wails would flip the title bar
			// on OS changes even when the app theme is fixed to light or dark
			Theme: theme,
		},
	})

	a.window.OnWindowEvent(wailsevents.Common.WindowDidMove, func(*application.WindowEvent) { a.trackNormal() })
	a.window.OnWindowEvent(wailsevents.Common.WindowDidResize, func(*application.WindowEvent) { a.trackNormal() })
	a.window.OnWindowEvent(wailsevents.Common.WindowClosing, func(*application.WindowEvent) { a.saveWindowState() })

	a.wails.Event.OnApplicationEvent(wailsevents.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		application.InvokeAsync(a.placeWindow)
	})
}

func (a *App) placeWindow() {
	defer a.window.Show()

	var screens []rect
	for _, s := range a.wails.Screen.GetAll() {
		screens = append(screens, rect{s.WorkArea.X, s.WorkArea.Y, s.WorkArea.Width, s.WorkArea.Height})
	}

	a.mu.Lock()
	saved := a.state
	a.mu.Unlock()

	w, h := fitSize(saved.Width, saved.Height, screens)
	target := rect{saved.X, saved.Y, w, h}
	if saved.Width > 0 && reachable(target, screens) {
		a.window.SetBounds(application.Rect{X: target.X, Y: target.Y, Width: target.W, Height: target.H})
	} else if w != saved.Width || h != saved.Height {
		a.window.SetSize(w, h)
		a.window.Center()
	}
	if saved.Maximised {
		a.window.Maximise()
	}
}

func (a *App) trackNormal() {
	if a.window.IsMaximised() || a.window.IsMinimised() || a.window.IsFullscreen() {
		return
	}
	b := a.window.Bounds()
	if b.Width <= 0 || b.Height <= 0 {
		return
	}
	a.mu.Lock()
	a.normal = rect{b.X, b.Y, b.Width, b.Height}
	a.mu.Unlock()
}

func (a *App) saveWindowState() {
	if a.window == nil {
		return
	}
	maximised := a.window.IsMaximised()
	if !maximised && !a.window.IsMinimised() {
		a.trackNormal()
	}
	a.mu.Lock()
	a.state.X, a.state.Y, a.state.Width, a.state.Height = a.normal.X, a.normal.Y, a.normal.W, a.normal.H
	a.state.Maximised = maximised
	state := a.state
	a.mu.Unlock()
	if err := a.store.Set(services.KeyWindow, state); err != nil {
		slog.Error("save window state", "error", err)
	}
}

// ApplyTheme implements services.ThemeTarget.
func (a *App) ApplyTheme(dark bool, background string) {
	setNativeDark(a.window, dark)
	if r, g, b, ok := systheme.ParseHex(background); ok {
		a.window.SetBackgroundColour(application.NewRGB(r, g, b))
	}
	a.mu.Lock()
	a.state.Dark = &dark
	if background != "" {
		a.state.Background = background
	}
	a.mu.Unlock()
}

func (a *App) focus() {
	application.InvokeAsync(func() {
		if a.window.IsMinimised() {
			a.window.UnMinimise()
		}
		a.window.Show()
		a.window.Focus()
	})
}

// EnvDebugPort opens the WebView2 DevTools protocol on that port, for driving the real app from
// Playwright. WebView2's own WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is ignored because Wails always
// passes arguments of its own.
const EnvDebugPort = "WHATSZORI_WEBVIEW_DEBUG_PORT"

func debugBrowserArgs() []string {
	port, err := strconv.Atoi(os.Getenv(EnvDebugPort))
	if err != nil || port <= 0 || port > 65535 {
		return nil
	}
	return []string{"--remote-debugging-port=" + strconv.Itoa(port)}
}

type shell struct{ a *App }

func (s shell) OpenURL(url string) error     { return s.a.wails.Browser.OpenURL(url) }
func (s shell) OpenFolder(path string) error { return s.a.wails.Env.OpenFileManager(path, false) }

type filePicker struct{ a *App }

func (p filePicker) PickFile(title string) (string, error) {
	return p.a.wails.Dialog.OpenFile().SetTitle(title).AttachToWindow(p.a.window).PromptForSingleSelection()
}
