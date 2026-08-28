import { defineConfig } from 'vite';

// GitHub Pages serves a project site from /<repo>/, everywhere else is the
// domain root. Set BASE_PATH at build time to match the host.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  server: { port: 5173, open: false },
  preview: { port: 4173 },
  build: { target: 'es2022', assetsDir: 'assets' },
});
