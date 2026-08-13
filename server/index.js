import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { z } from 'zod'
import { clearCurrentOrder, completeOrder, createDish, createMessage, createOrder, createUser, deleteDish, deleteMessage, getDish, getLatestOrder, getUserById, getUserByUsername, getUserMenuDishIds, initializeDatabase, listDishes, listMessages, listOrders, listUsers, pool, setFavorite, setUserMenuDishIds, updateDish, updateMessage } from './db.js'

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

// 轻量级 API token 校验 + 简单写操作限流（适配 P1 要求）
const allowedApiTokens = new Set((process.env.ALLOWED_API_TOKENS || '').split(',').map((t) => t.trim()).filter(Boolean))

function unauthorizedError(msg = '未授权的 API 调用') {
  const err = new Error(msg)
  err.status = 403
  return err
}

// 简单内存限流：每 IP 每分钟允许的写请求数（默认 30）
const writeRateMap = new Map() // ip -> { count, windowStart }
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX = Number(process.env.API_WRITE_RATE_LIMIT || 30)

setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of writeRateMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 5) writeRateMap.delete(ip)
  }
}, 60 * 1000)

app.use((request, response, next) => {
  // 只对 /api 下的写操作（POST/PUT/DELETE/PATCH）做 token 校验与限流
  if (!request.path.startsWith('/api/')) return next()
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) return next()

  // Token 校验（若未配置 ALLOWED_API_TOKENS 则跳过）
  if (allowedApiTokens.size > 0) {
    const token = request.get('X-Api-Token') || request.query.api_token
    if (!token || !allowedApiTokens.has(token)) return next(unauthorizedError())
  }

  // 简单按 IP 限流
  const ip = request.ip || request.headers['x-forwarded-for'] || request.connection?.remoteAddress || 'unknown'
  const now = Date.now()
  const entry = writeRateMap.get(ip) || { count: 0, windowStart: now }
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0
    entry.windowStart = now
  }
  entry.count += 1
  writeRateMap.set(ip, entry)
  if (entry.count > RATE_LIMIT_MAX) {
    const err = new Error('写操作过于频繁，请稍后重试')
    err.status = 429
    return next(err)
  }

  next()
})

app.use('/uploads', express.static(path.join(projectRoot, 'uploads'), {
  fallthrough: false,
  setHeaders(response) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    response.setHeader('X-Content-Type-Options', 'nosniff')
  },
}))

const loginSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().trim().min(1).max(100),
})

const createUserSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().trim().min(1).max(100),
  displayName: z.string().trim().max(100).optional(),
  role: z.enum(['admin', 'staff']).optional(),
})

const userMenuAssignmentSchema = z.object({
  dishIds: z.array(z.coerce.number().int().positive()).default([]),
})

const dishSchema = z.object({
  category: z.string().trim().max(50).default(''),
  name: z.string().trim().min(1).max(100),
  desc: z.string().trim().max(500).default(''),
  spicy: z.number().int().min(0).max(5),
  image: z.string().trim().max(1000)
    .refine((value) => value.startsWith('/') || /^https?:\/\//.test(value))
    .refine((value) => value !== '/icons/icon.svg', '菜品封面不能为空'),
  options: z.array(z.string().trim().min(1).max(100)).min(1).max(6)
    .refine((options) => new Set(options).size === options.length, '规格名称不能重复'),
  ingredients: z.array(z.object({
    name: z.string().trim().max(100),
    amount: z.string().trim().max(100),
  })).max(20).default([]),
  steps: z.array(z.union([
    z.string().trim().min(1).max(1000).transform((instruction) => ({ instruction, image: null })),
    z.object({
      instruction: z.string().trim().max(1000),
      image: z.string().trim().max(1000)
        .refine((value) => value.startsWith('/') || /^https?:\/\//.test(value))
        .nullable(),
    }),
  ])).max(20).default([]),
})

const idSchema = z.coerce.number().int().positive()

// 订单号由服务端生成（createOrder 内），避免多设备客户端用时间戳撞号
const orderSchema = z.object({
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

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const { username, password } = loginSchema.parse(request.body)
    const user = await getUserByUsername(username)
    if (!user) {
      response.status(401).json({ error: '暂无可用账号，请联系管理员申请账户后再登录。' })
      return
    }
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex')
    if (user.password_hash !== passwordHash) {
      response.status(401).json({ error: '暂无可用账号，请联系管理员申请账户后再登录。' })
      return
    }
    response.json({
      id: Number(user.id),
      username: user.username,
      displayName: user.display_name || user.username,
      role: user.role,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/users', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    const [userRows] = await pool.execute('SELECT role FROM users WHERE id = ? LIMIT 1', [currentUserId])
    if (!currentUserId || !userRows.length || userRows[0].role !== 'admin') {
      response.status(403).json({ error: '只有管理员才能管理用户' })
      return
    }
    response.json(await listUsers())
  } catch (error) {
    next(error)
  }
})

app.post('/api/users', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    const [userRows] = await pool.execute('SELECT role FROM users WHERE id = ? LIMIT 1', [currentUserId])
    if (!currentUserId || !userRows.length || userRows[0].role !== 'admin') {
      response.status(403).json({ error: '只有管理员才能创建用户' })
      return
    }

    const payload = createUserSchema.parse(request.body)
    const created = await createUser({
      username: payload.username,
      password: payload.password,
      displayName: payload.displayName || payload.username,
      role: payload.role || 'staff',
    })

    response.status(201).json(created)
  } catch (error) {
    next(error)
  }
})

app.get('/api/users/:id/menu', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    const [userRows] = await pool.execute('SELECT role FROM users WHERE id = ? LIMIT 1', [currentUserId])
    if (!currentUserId || !userRows.length || userRows[0].role !== 'admin') {
      response.status(403).json({ error: '只有管理员才能分配菜单' })
      return
    }
    const userId = idSchema.parse(request.params.id)
    const user = await getUserById(userId)
    if (!user) {
      response.status(404).json({ error: '用户不存在' })
      return
    }
    response.json({
      userId: Number(user.id),
      username: user.username,
      displayName: user.display_name || user.username,
      role: user.role,
      dishIds: await getUserMenuDishIds(userId),
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/users/:id/menu', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    const [userRows] = await pool.execute('SELECT role FROM users WHERE id = ? LIMIT 1', [currentUserId])
    if (!currentUserId || !userRows.length || userRows[0].role !== 'admin') {
      response.status(403).json({ error: '只有管理员才能分配菜单' })
      return
    }
    const userId = idSchema.parse(request.params.id)
    const user = await getUserById(userId)
    if (!user) {
      response.status(404).json({ error: '用户不存在' })
      return
    }
    const payload = userMenuAssignmentSchema.parse(request.body)
    const nextDishIds = await setUserMenuDishIds(userId, payload.dishIds)
    response.json({
      userId: Number(user.id),
      username: user.username,
      displayName: user.display_name || user.username,
      role: user.role,
      dishIds: nextDishIds,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/dishes', async (request, response, next) => {
  try {
    const userId = Number(request.get('X-User-Id') || 0)
    response.json(await listDishes(userId || null))
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

const favoriteSchema = z.object({ favorite: z.boolean() })
const messageSchema = z.object({
  // content 允许空字符串：点单时会为每个新订单初始化一条占位留言
  content: z.string().trim().max(500),
  orderId: z.coerce.number().int().positive().nullable().optional(),
})

app.get('/api/messages', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    response.setHeader('Cache-Control', 'no-store')
    response.json(await listMessages(currentUserId || null))
  } catch (error) {
    next(error)
  }
})

app.post('/api/messages', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    const { content, orderId } = messageSchema.parse(request.body)
    response.status(201).json(await createMessage(content, orderId ?? null, currentUserId || null))
  } catch (error) {
    next(error)
  }
})

app.put('/api/messages/:id', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    const { content, orderId } = messageSchema.parse(request.body)
    const updated = await updateMessage(idSchema.parse(request.params.id), content, orderId ?? null, currentUserId || null)
    if (!updated) {
      response.status(404).json({ error: '留言不存在' })
      return
    }
    response.json(updated)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/messages/:id', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    const deleted = await deleteMessage(idSchema.parse(request.params.id), currentUserId || null)
    if (!deleted) {
      response.status(404).json({ error: '留言不存在' })
      return
    }
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.put('/api/dishes/:id/favorite', async (request, response, next) => {
  try {
    const dishId = idSchema.parse(request.params.id)
    const { favorite } = favoriteSchema.parse(request.body)
    const dish = await getDish(dishId)
    if (!dish) {
      response.status(404).json({ error: '菜品不存在' })
      return
    }
    await setFavorite(dishId, favorite)
    response.json({ id: dishId, favorite })
  } catch (error) {
    next(error)
  }
})

app.get('/api/orders/latest', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    const order = await getLatestOrder(currentUserId || null)
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

app.get('/api/orders', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    const days = Math.min(Number(request.query.days) || 30, 90)
    response.setHeader('Cache-Control', 'no-store')
    response.json(await listOrders({ days, userId: currentUserId || null }))
  } catch (error) {
    next(error)
  }
})

app.delete('/api/orders/current', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    await clearCurrentOrder(currentUserId || null)
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.post('/api/orders', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    response.status(201).json(await createOrder(orderSchema.parse(request.body), currentUserId || null))
  } catch (error) {
    next(error)
  }
})

app.put('/api/orders/:id/complete', async (request, response, next) => {
  try {
    const currentUserId = Number(request.get('X-User-Id') || 0)
    const completed = await completeOrder(idSchema.parse(request.params.id), currentUserId || null)
    if (!completed) {
      response.status(404).json({ error: '订单不存在或已结束' })
      return
    }
    response.json({ id: idSchema.parse(request.params.id), status: 'completed' })
  } catch (error) {
    next(error)
  }
})

app.use(express.static('dist'))
app.get('/{*path}', (request, response, next) => {
  if (request.path.startsWith('/api')) { response.status(404).json({ error: '接口不存在' }); return }
  response.sendFile('index.html', { root: 'dist' })
})

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
  // 请求体过大（express.json limit）返回 413
  if (error.type === 'entity.too.large') {
    response.status(413).json({ error: '请求内容过大' })
    return
  }
  // 明确传递的状态码（如 400/403/429 等）优先返回
  if (error.status === 400) {
    response.status(400).json({ error: error.message || '请求无效' })
    return
  }
  if (error.status === 403) {
    response.status(403).json({ error: '当前来源无权访问服务' })
    return
  }
  if (error.status === 429) {
    response.status(429).json({ error: error.message || '请求过多' })
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
