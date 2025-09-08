import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // target: 'esnext', // <-- solo si algún día quieres permitir top-level await
  },
  publicDir: 'assets', // Copiar assets estáticos
  define: {
    global: 'globalThis',
    'process.env': {},
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  resolve: {
    alias: {
      process: 'process/browser',
    },
  },
  optimizeDeps: {
    include: ['process']
  }
});
