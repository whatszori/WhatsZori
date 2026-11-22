package main

import (
	"embed"
	"io/fs"
	"log"
	"os"

	"github.com/whatszori/WhatsZori/internal/app"
	"github.com/whatszori/WhatsZori/internal/config"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	cfg, err := config.Load(os.Args[1:])
	if err != nil {
		log.Fatal(err)
	}
	dist, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	a, err := app.New(cfg, dist)
	if err != nil {
		log.Fatal(err)
	}
	if err := a.Run(); err != nil {
		log.Fatal(err)
	}
}
