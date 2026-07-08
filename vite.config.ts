import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// DEV-ONLY: accepts a base64 JPEG POSTed from the page (window.__shot) and
// writes it next to the project so headless preview sessions can inspect
// renders. No effect on production builds.
function shotSink(): Plugin {
  return {
    name: 'dev-shot-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          try {
            const b64 = body.replace(/^data:image\/\w+;base64,/, '')
            const file = join(server.config.root, '.dev-shot.jpg')
            writeFileSync(file, Buffer.from(b64, 'base64'))
            res.statusCode = 200
            res.end('ok')
          } catch (e) {
            res.statusCode = 500
            res.end(String(e))
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), shotSink()],
})
