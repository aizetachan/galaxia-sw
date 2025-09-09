import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // target: 'esnext', // <-- solo si algún día quieres permitir top-level await
  },
  publicDir: 'assets', // Copiar assets estáticos
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  define: {
    global: 'globalThis',
    'process.env': {},
    'process.env.NODE_ENV': JSON.stringify(mode || 'development'),
  },
  resolve: {
    alias: {
      process: 'process/browser',
    },
  },
  optimizeDeps: {
    include: ['process']
  },
  esbuild: {
    // Configuración para compatibilidad con ESM
    target: 'es2020',
  },
}));
