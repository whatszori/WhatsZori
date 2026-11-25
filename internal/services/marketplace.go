package services

import (
	"context"
	"errors"
	"time"

	"github.com/whatszori/WhatsZori/internal/market"
	"github.com/whatszori/WhatsZori/internal/plugins"
)

// Marketplace lists what the marketplace offers next to what's installed, and installs, updates
// and removes plugins and themes. A plugin installed from here is off until the user turns it on
// and allows what it asks for, the same as one copied in by hand.
type Marketplace struct {
	store   *market.Store
	plugins *Plugins
}

func NewMarketplace(store *market.Store, plugins *Plugins) *Marketplace {
	return &Marketplace{store: store, plugins: plugins}
}

type MarketEntry struct {
	Item market.Item `json:"item"`
	// the installed version, "" when it isn't installed
	Installed string `json:"installed"`
	// the marketplace has a newer version
	Update bool `json:"update"`
	// a publisher WhatsZori vouches for, by the plugin's signing key; empty for everyone else
	Publisher string `json:"publisher"`
}

// List fetches the marketplace (from cache unless refresh) and marks what's installed.
func (m *Marketplace) List(refresh bool) ([]MarketEntry, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	ix, err := m.store.Index(ctx, refresh)
	if err != nil {
		return nil, err
	}
	out := make([]MarketEntry, 0, len(ix.Items))
	for _, it := range ix.Items {
		inst := m.store.Installed(it.Kind, it.ID)
		out = append(out, MarketEntry{Item: it, Installed: inst, Update: inst != "" && market.Newer(it.Version, inst),
			Publisher: plugins.TrustedPublishers[it.Key]})
	}
	return out, nil
}

// Install puts a plugin or theme in place (or updates it). Plugins stay off until turned on.
func (m *Marketplace) Install(kind, id string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	return m.store.Install(ctx, kind, id)
}

// Uninstall removes it; for a plugin it also turns it off and forgets what the user allowed.
func (m *Marketplace) Uninstall(kind, id string) error {
	if kind == "plugin" && m.plugins != nil {
		if err := m.plugins.Revoke(id); err != nil {
			return err
		}
	}
	if kind != "plugin" && kind != "theme" {
		return errors.New("unknown kind")
	}
	return m.store.Uninstall(kind, id)
}
