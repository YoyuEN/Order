import express from 'express'
import cors from 'cors'
import { z } from 'zod'
import { createDish, createOrder, initializeDatabase, listDishes, pool } from './db.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://localhost,http://localhost').split(',').map((origin) => origin.trim()).filter(Boolean))

app.disable('x-powered-by')
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) callback(null, true)
    else callback(new Error('Origin not allowed'))
  },
}))
app.use(express.json({ limit: '32kb' }))

const dishSchema = z.object({
  category: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  desc: z.string().trim().min(1).max(500),
  spicy: z.number().int().min(0).max(5),
  image: z.string().trim().max(1000).refine((value) => value.startsWith('/') || /^https?:\/\//.test(value)),
  options: z.array(z.string().trim().min(1).max(100)).min(1).max(6),
})

const orderSchema = z.object({
  orderNumber: z.string().trim().min(6).max(32),
  table: z.string().trim().min(1).max(20),
  guests: z.number().int().min(1).max(20),
  items: z.array(z.object({
    dishId: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    option: z.string().trim().min(1).max(100),
    note: z.string().trim().max(255),
    quantity: z.number().int().positive().max(99),
  })).min(1).max(100),
})

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1')
    response.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
})

app.get('/api/dishes', async (_request, response, next) => {
  try {
    response.json(await listDishes())
  } catch (error) {
    next(error)
  }
})

app.post('/api/dishes', async (request, response, next) => {
  try {
    response.status(201).json(await createDish(dishSchema.parse(request.body)))
  } catch (error) {
    next(error)
  }
})

app.post('/api/orders', async (request, response, next) => {
  try {
    response.status(201).json(await createOrder(orderSchema.parse(request.body)))
  } catch (error) {
    next(error)
  }
})

app.use(express.static('dist'))
app.get('/{*path}', (_request, response) => response.sendFile('index.html', { root: 'dist' }))

app.use((error, _request, response, _next) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: '提交的数据格式不正确', details: error.issues })
    return
  }
  console.error(error)
  response.status(500).json({ error: '服务器暂时无法处理请求' })
})

try {
  await initializeDatabase()
  app.listen(port, () => console.log(`禾味点菜服务已启动：http://localhost:${port}`))
} catch (error) {
  console.error('数据库初始化失败：', error.message)
  process.exitCode = 1
}
