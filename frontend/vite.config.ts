import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const api = 'http://127.0.0.1:' + (process.env.E2E_API_PORT ?? '8001');
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/researcher/' : '/',
  server: {
    port: Number(process.env.E2E_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/test-types': api,
      '/study-templates': api,
      '/studies': api,
      '/sessions': api,
      '/terminals': api,
      '/terminal-pairings': api,
      '/rooms': api,
      '/booth-assignments': api,
      '/booth-board': api,
      '/operator/dashboard': api,
      '/operator/events': api,
      '/operator/operations': api,
      '/operations/export': api,
      '/analysis': api,
      '/questionnaire-items': api,
      '/health': api,
    },
  },
}));
