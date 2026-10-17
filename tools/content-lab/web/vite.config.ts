import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import {fileURLToPath} from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  cacheDir: fileURLToPath(new URL('../../../node_modules/.vite-content-lab', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: {'/api': 'http://127.0.0.1:4174'},
  },
  build: {outDir: 'dist', emptyOutDir: true},
})

