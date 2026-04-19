import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const tunnelHost = env.VITE_FRONTEND_URL ? new URL(env.VITE_FRONTEND_URL).hostname : null;

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: ['.cpolar.top', 'localhost'],
      hmr: tunnelHost ? {
        host: tunnelHost,
        protocol: 'wss',
      } : undefined,
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },
  };
});
