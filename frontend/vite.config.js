import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dev server proxy: routes /api/* to Express backend
  // This way the frontend doesn't need CORS headers in local dev
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  // In Docker (nginx), the API is proxied at /api/ → backend:3001
  // The frontend uses /api as base URL in production
  define: {
    // Injected at build time — can be overridden by env
    __API_BASE__: JSON.stringify(''),
  },
})
