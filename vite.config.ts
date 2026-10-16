import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// The Python server in ./server (uvicorn on port 8000) holds the hosted LLM's API key and the
// universal tools. The app calls it as /api/..., so the browser never needs the key or CORS.
const api = {
  '/api': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: { proxy: api },
  preview: { proxy: api },
})
