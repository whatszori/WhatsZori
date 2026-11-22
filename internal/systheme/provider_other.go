//go:build !windows && !linux && !darwin

package systheme

func New() Provider { return Static(SystemPalette{Source: "none", Scheme: SchemeNone}) }
