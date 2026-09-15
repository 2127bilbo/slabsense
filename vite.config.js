import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Same-origin path for TCGDex reference images (production: vercel.json rewrite)
    proxy: {
      '/tcgdex-img': { target: 'https://assets.tcgdex.net', changeOrigin: true, rewrite: (p) => p.replace(/^\/tcgdex-img/, '') },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
