import { defineConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  root: 'src',

  plugins: [
    viteCompression({ algorithm: 'brotliCompress', ext: '.br' }),
    viteCompression({ algorithm: 'gzip',           ext: '.gz' }),
  ],
  publicDir: '../public',

  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.warn', 'console.error'],
        passes: 2,
      },
      mangle: { safari10: true },
    },
    cssCodeSplit: true,
    cssMinify: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 200,

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@supabase/auth-js') || id.includes('@supabase/realtime')) {
            return 'vendor-supabase-auth';
          }
          if (id.includes('@supabase/supabase-js') || id.includes('@supabase/postgrest')) {
            return 'vendor-supabase-core';
          }
          if (id.includes('node_modules')) return 'vendor';
        },
        entryFileNames:  'js/[name].[hash].js',
        chunkFileNames:  'js/[name].[hash].js',
        assetFileNames:  'assets/[name].[hash][extname]',
      },
    },
  },

  server: {
    port: 5173,
    open: true,
  },

  optimizeDeps: {
    include: ['@supabase/supabase-js'],
  },
});
