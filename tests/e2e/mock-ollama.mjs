// Minimal stand-in for Ollama's /api/tags and streaming /api/chat, for tests without a GPU model.
import { createServer } from 'node:http'

export function startMockOllama() {
  const server = createServer((req, res) => {
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'mock:1b' }] }))
    if (req.url === '/api/chat') {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', async () => {
        const json = JSON.parse(body).format === 'json'
        res.setHeader('content-type', 'application/x-ndjson')
        const parts = json ? ['{"groups":[{"title":"Examples","tabs":[1,2,', '3]}]}'] : ['Gist: an example page.', '\n- It is used ', 'in documentation.']
        for (const p of parts) {
          res.write(JSON.stringify({ message: { role: 'assistant', content: p }, done: false }) + '\n')
          await new Promise((r) => setTimeout(r, 50))
        }
        res.end(JSON.stringify({ done: true }) + '\n')
      })
      return
    }
    res.statusCode = 404
    res.end()
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })))
}
