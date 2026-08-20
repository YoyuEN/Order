// 临时 mock API：模拟乐梵小灶后端，用于复现手机端菜单底部问题
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const dishes = Array.from({ length: 11 }, (_, i) => ({
  id: i + 1,
  category: i < 4 ? '热菜' : i < 6 ? '凉菜' : i < 9 ? '汤' : '主食',
  name: ['红烧肉', '清蒸鲈鱼', '宫保鸡丁', '麻婆豆腐', '凉拌黄瓜', '口水鸡', '冬瓜排骨汤', '番茄蛋汤', '玉米排骨汤', '扬州炒饭', '白灼虾'][i],
  desc: '精选优质食材，用心烹饪的家常美味，分量十足。',
  spicy: i % 3,
  image: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22276%22%3E%3Crect width=%22400%22 height=%22276%22 fill=%22%23dfe5da%22/%3E%3C/svg%3E',
  favorite: false,
  soldOut: false,
  options: ['标准份'],
  ingredients: [],
  steps: [],
}))

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  // 登录：直接断开连接 -> 前端 fetch 抛 TypeError -> user-auth.js 走 admin/admin123 fallback
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    req.destroy()
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/dishes') { send(200, dishes); return }
  if (req.method === 'GET' && url.pathname === '/api/messages') { send(200, []); return }
  if (req.method === 'GET' && url.pathname === '/api/orders/latest') { res.writeHead(204); res.end(); return }
  if (req.method === 'GET' && url.pathname === '/api/orders') { send(200, []); return }
  if (req.method === 'DELETE' && url.pathname === '/api/orders/current') { res.writeHead(204); res.end(); return }
  if (req.method === 'POST' && url.pathname === '/api/orders') {
    send(201, { id: 1, orderNumber: 'TEST-' + randomUUID().slice(0, 6).toUpperCase() })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/uploads/dish-image') { send(201, { url: '/uploads/dishes/mock.jpg' }); return }
  send(404, { error: 'not found' })
})

server.listen(3001, () => console.log('mock api on 3001'))
