import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

// main.go embeds frontend/dist, so the folder has to exist even on a fresh clone; the committed
// .gitkeep gets wiped by emptyOutDir, so put it back after every build.
function keepDistPlaceholder(): Plugin {
  return {
    name: 'wz-keep-dist-placeholder',
    apply: 'build',
    closeBundle() {
      writeFileSync(resolve(import.meta.dirname, 'dist/.gitkeep'), '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), keepDistPlaceholder()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    // the Wails dev proxy dials IPv4 only, and Node may bind "localhost" to ::1 on Windows
    host: '127.0.0.1',
    port: Number(process.env.WAILS_VITE_PORT) || 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
