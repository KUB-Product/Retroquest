import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite serves + bundles the React app. Backend stays at localhost:3001 during dev;
// production backend URL is resolved at runtime (see src/api.js).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
});
