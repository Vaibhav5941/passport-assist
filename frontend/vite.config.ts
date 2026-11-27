import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  // Same-origin proxy keeps the session cookie first-party and avoids CORS.
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4000' } },
});
