import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5280,
    strictPort: true,
    // `npm run dev` for UI work against a running `npm start` server.
    proxy: { '/api': 'http://127.0.0.1:4747' },
  },
  preview: { host: '127.0.0.1', port: 5281, strictPort: true },
});
