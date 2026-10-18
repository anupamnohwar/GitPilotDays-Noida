import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function protectProjectStorage(): Plugin {
  return {
    name: 'projectpassport-protect-project-storage',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let pathname
        try {
          pathname = decodeURIComponent((request.url || '/').split(/[?#]/, 1)[0]).replaceAll('\\', '/')
        } catch {
          response.statusCode = 400
          response.end()
          return
        }
        if (/(^|[\\/])data([\\/]|$)/i.test(pathname)) {
          response.statusCode = 404
          response.end()
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [protectProjectStorage(), react()],
  server: {
    fs: {
      deny: ['data/**'],
    },
    watch: {
      ignored: ['**/data/**'],
    },
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
