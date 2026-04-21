import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  const isDev = mode === 'development';
  const signalingUrl = env.VITE_SIGNALING_URL || '';
  const isLocalDev = isDev && !signalingUrl;

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: ['localhost'],
      proxy: isLocalDev ? {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      } : undefined,
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    define: {
      'import.meta.env.VITE_SIGNALING_URL': JSON.stringify(signalingUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
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
