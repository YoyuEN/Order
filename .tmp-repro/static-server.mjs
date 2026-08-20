// 极简静态服务器：仅服务 .tmp-repro 目录
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mjs': 'text/javascript; charset=utf-8',
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let p = decodeURIComponent(url.pathname)
    if (p === '/') p = '/index.html'
    const abs = path.join(root, p)
    if (!abs.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return }
    const data = await readFile(abs)
    res.writeHead(200, { 'Content-Type': types[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(data)
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); res.end('not found') }
    else { res.writeHead(500); res.end(String(e)) }
  }
})

server.listen(5199, () => console.log('static server on 5199'))
