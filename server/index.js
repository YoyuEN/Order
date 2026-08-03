import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { z } from 'zod'
import { clearCurrentOrder, createDish, createOrder, deleteDish, getDish, getLatestOrder, initializeDatabase, listDishes, pool, updateDish } from './db.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://localhost,http://localhost').split(',').map((origin) => origin.trim()).filter(Boolean))
const loopbackOriginPattern = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const uploadsDirectory = path.join(projectRoot, 'uploads', 'dishes')
const imageExtensions = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
])

await mkdir(uploadsDirectory, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDirectory,
    filename(_request, file, callback) {
      callback(null, `${crypto.randomUUID()}${imageExtensions.get(file.mimetype) || ''}`)
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    if (!imageExtensions.has(file.mimetype)) {
      callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'))
      return
    }
    callback(null, true)
  },
})

app.disable('x-powered-by')
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin) || loopbackOriginPattern.test(origin)) callback(null, true)
    else {
      const error = new Error('Origin not allowed')
      error.status = 403
      callback(error)
    }
  },
}))
app.use(express.json({ limit: '32kb' }))
app.use('/uploads', express.static(path.join(projectRoot, 'uploads'), {
  fallthrough: false,
  setHeaders(response) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    response.setHeader('X-Content-Type-Options', 'nosniff')
  },
}))

const dishSchema = z.object({
  category: z.string().trim().max(50).default(''),
  name: z.string().trim().min(1).max(100),
  desc: z.string().trim().max(500).default(''),
  spicy: z.number().int().min(0).max(5),
  image: z.string().trim().max(1000).refine((value) => value.startsWith('/') || /^https?:\/\//.test(value)),
  options: z.array(z.string().trim().min(1).max(100)).min(1).max(6)
    .refine((options) => new Set(options).size === options.length, '规格名称不能重复'),
  ingredients: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    amount: z.string().trim().min(1).max(100),
  })).max(20).default([]),
  steps: z.array(z.union([
    z.string().trim().min(1).max(1000).transform((instruction) => ({ instruction, image: null })),
    z.object({
      instruction: z.string().trim().min(1).max(1000),
      image: z.string().trim().max(1000)
        .refine((value) => value.startsWith('/') || /^https?:\/\//.test(value))
        .nullable(),
    }),
  ])).max(20).default([]),
})

const idSchema = z.coerce.number().int().positive()

const orderSchema = z.object({
  orderNumber: z.string().trim().min(6).max(32),
  items: z.array(z.object({
    dishId: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    option: z.string().trim().min(1).max(100),
    note: z.string().trim().max(255),
  })).min(1).max(100),
}).refine((order) => new Set(order.items.map((item) => item.dishId)).size === order.items.length, '每道菜只能选择一次')

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

app.post('/api/uploads/dish-image', upload.single('image'), (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: '请选择需要上传的图片' })
    return
  }
  response.status(201).json({ url: `/uploads/dishes/${request.file.filename}` })
})

app.get('/api/dishes/:id', async (request, response, next) => {
  try {
    const dish = await getDish(idSchema.parse(request.params.id))
    if (!dish) {
      response.status(404).json({ error: '菜品不存在' })
      return
    }
    response.json(dish)
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

app.put('/api/dishes/:id', async (request, response, next) => {
  try {
    const dish = await updateDish(idSchema.parse(request.params.id), dishSchema.parse(request.body))
    if (!dish) {
      response.status(404).json({ error: '菜品不存在' })
      return
    }
    response.json(dish)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/dishes/:id', async (request, response, next) => {
  try {
    const deleted = await deleteDish(idSchema.parse(request.params.id))
    if (!deleted) {
      response.status(404).json({ error: '菜品不存在' })
      return
    }
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.get('/api/orders/latest', async (_request, response, next) => {
  try {
    const order = await getLatestOrder()
    if (!order) {
      response.status(204).end()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.json(order)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/orders/current', async (_request, response, next) => {
  try {
    await clearCurrentOrder()
    response.status(204).end()
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
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 15MB' : '仅支持 JPG、PNG、WebP 或 GIF 图片'
    response.status(400).json({ error: message })
    return
  }
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: '提交的数据格式不正确', details: error.issues })
    return
  }
  if (error.type === 'entity.parse.failed') {
    response.status(400).json({ error: '请求内容不是有效的 JSON' })
    return
  }
  if (error.status === 403) {
    response.status(403).json({ error: '当前来源无权访问服务' })
    return
  }
  console.error(error)
  response.status(500).json({ error: '服务器暂时无法处理请求' })
})

try {
  await initializeDatabase()
  app.listen(port, () => console.log(`服务已启动：http://localhost:${port}`))
} catch (error) {
  console.error('数据库初始化失败：', error.message)
  process.exitCode = 1
}
