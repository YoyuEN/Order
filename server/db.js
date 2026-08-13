import crypto from 'node:crypto'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import { defaultDishes } from '../menu-data.js'
import path from 'node:path'
import { unlink } from 'node:fs/promises'

dotenv.config({ path: '.env.local' })

const requiredVariables = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
const missingVariables = requiredVariables.filter((name) => !process.env[name])
if (missingVariables.length) throw new Error(`缺少数据库配置：${missingVariables.join(', ')}`)

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
})

export async function initializeDatabase() {
  const connection = await pool.getConnection()
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS dishes (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          category VARCHAR(50) NOT NULL,
          name VARCHAR(100) NOT NULL,
          description VARCHAR(500) NOT NULL DEFAULT '',
          spicy TINYINT UNSIGNED NOT NULL DEFAULT 0,
          badge VARCHAR(50) NULL,
          image_url VARCHAR(1000) NULL,
          sold_out BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB`)
    await connection.query(`CREATE TABLE IF NOT EXISTS dish_options (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      dish_id BIGINT UNSIGNED NOT NULL,
      option_name VARCHAR(100) NOT NULL,
      sort_order INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (id), UNIQUE KEY uk_dish_option (dish_id, option_name),
      CONSTRAINT fk_dish_options_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
    await connection.query(`CREATE TABLE IF NOT EXISTS dish_ingredients (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      dish_id BIGINT UNSIGNED NOT NULL,
      ingredient_name VARCHAR(100) NOT NULL,
      amount VARCHAR(100) NOT NULL,
      sort_order INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (id), INDEX idx_dish_ingredients_dish_id (dish_id),
      CONSTRAINT fk_dish_ingredients_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
    await connection.query(`CREATE TABLE IF NOT EXISTS dish_steps (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      dish_id BIGINT UNSIGNED NOT NULL,
      instruction VARCHAR(1000) NOT NULL,
      image_url VARCHAR(1000) NULL,
      sort_order INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (id), INDEX idx_dish_steps_dish_id (dish_id),
      CONSTRAINT fk_dish_steps_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
    const [stepImageColumns] = await connection.query("SHOW COLUMNS FROM dish_steps LIKE 'image_url'")
    if (!stepImageColumns.length) {
      await connection.query('ALTER TABLE dish_steps ADD COLUMN image_url VARCHAR(1000) NULL AFTER instruction')
    }
    await connection.query(`CREATE TABLE IF NOT EXISTS orders (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          order_number VARCHAR(32) NOT NULL,
          status ENUM('draft', 'confirmed', 'completed', 'cancelled') NOT NULL DEFAULT 'draft',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id), UNIQUE KEY uk_orders_order_number (order_number),
          INDEX idx_orders_created_at (created_at), INDEX idx_orders_status (status)
        ) ENGINE=InnoDB`)
    await connection.query(`CREATE TABLE IF NOT EXISTS order_items (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          order_id BIGINT UNSIGNED NOT NULL,
          dish_id BIGINT UNSIGNED NULL,
          dish_name VARCHAR(100) NOT NULL,
          option_name VARCHAR(100) NOT NULL DEFAULT '标准份',
          note VARCHAR(255) NOT NULL DEFAULT '',
          PRIMARY KEY (id), INDEX idx_order_items_order_id (order_id),
          CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
          CONSTRAINT fk_order_items_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE SET NULL
        ) ENGINE=InnoDB`)
    await connection.query(`CREATE TABLE IF NOT EXISTS favorites (
      dish_id BIGINT UNSIGNED NOT NULL,
          PRIMARY KEY (dish_id),
          CONSTRAINT fk_favorites_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE
        ) ENGINE=InnoDB`)
    await connection.query(`CREATE TABLE IF NOT EXISTS messages (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          content VARCHAR(500) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id), INDEX idx_messages_created_at (created_at)
        ) ENGINE=InnoDB`)
    const [messageOrderColumns] = await connection.query("SHOW COLUMNS FROM messages LIKE 'order_id'")
    if (!messageOrderColumns.length) {
      await connection.query('ALTER TABLE messages ADD COLUMN order_id BIGINT UNSIGNED NULL AFTER content')
    }
    const [messageColumns] = await connection.query("SHOW COLUMNS FROM messages LIKE 'updated_at'")
    if (!messageColumns.length) {
      await connection.query('ALTER TABLE messages ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at')
    }
    // 每单最多一条留言：先清理历史重复（优先保留非空内容、最新一条），再建唯一索引；order_id 为 NULL 的通用留言不受影响
    const [messageOrderUniqueIndexes] = await connection.query("SHOW INDEX FROM messages WHERE Key_name = 'uk_messages_order'")
    if (!messageOrderUniqueIndexes.length) {
      const [duplicatedMessageGroups] = await connection.query(
        `SELECT order_id FROM messages WHERE order_id IS NOT NULL
         GROUP BY order_id HAVING COUNT(*) > 1`,
      )
      for (const { order_id } of duplicatedMessageGroups) {
        const [[preferred]] = await connection.execute(
          "SELECT id FROM messages WHERE order_id = ? AND content != '' ORDER BY id DESC LIMIT 1",
          [order_id],
        )
        let keepId = preferred ? preferred.id : null
        if (keepId === null) {
          // 全是空占位：保留最新一条
          const [[latest]] = await connection.execute(
            'SELECT id FROM messages WHERE order_id = ? ORDER BY id DESC LIMIT 1',
            [order_id],
          )
          keepId = latest ? latest.id : null
        }
        if (keepId !== null) {
          await connection.execute('DELETE FROM messages WHERE order_id = ? AND id != ?', [order_id, keepId])
        }
      }
      await connection.query('ALTER TABLE messages ADD UNIQUE KEY uk_messages_order (order_id)')
    }
    await connection.query(`CREATE TABLE IF NOT EXISTS app_metadata (
      metadata_key VARCHAR(100) NOT NULL,
      metadata_value VARCHAR(500) NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (metadata_key)
    ) ENGINE=InnoDB`)
    const [[seedVersion]] = await connection.execute(
      'SELECT metadata_value FROM app_metadata WHERE metadata_key = ?',
      ['default_dishes_version'],
    )
    if (!seedVersion) {
      await seedMissingDefaultDishes(connection)
      await connection.execute(
        'INSERT INTO app_metadata (metadata_key, metadata_value) VALUES (?, ?)',
        ['default_dishes_version', '1'],
      )
    }
  } finally {
    connection.release()
  }
}

async function seedMissingDefaultDishes(connection) {
  await connection.beginTransaction()
  try {
    for (const dish of defaultDishes) {
      const [[existingDish]] = await connection.execute(
        'SELECT id FROM dishes WHERE name = ? LIMIT 1',
        [dish.name],
      )
      if (existingDish) continue

      const [result] = await connection.execute(
        `INSERT INTO dishes (category, name, description, spicy, badge, image_url, sold_out)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dish.category, dish.name, dish.desc, dish.spicy || 0, dish.badge || null, dish.image, Boolean(dish.soldOut)],
      )
      for (const [index, option] of dish.options.entries()) {
        await connection.execute(
          'INSERT INTO dish_options (dish_id, option_name, sort_order) VALUES (?, ?, ?)',
          [result.insertId, option, index],
        )
      }
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  }
}

export async function listDishes() {
  const [dishRows] = await pool.query(
      `SELECT id, category, name, description, spicy, badge, image_url, sold_out,
           EXISTS(SELECT 1 FROM favorites f WHERE f.dish_id = dishes.id) AS favorite
     FROM dishes ORDER BY id`,
  )
  const [optionRows] = await pool.query(
    'SELECT dish_id, option_name FROM dish_options ORDER BY dish_id, sort_order, id',
  )
  const [ingredientRows] = await pool.query(
    'SELECT dish_id, ingredient_name, amount FROM dish_ingredients ORDER BY dish_id, sort_order, id',
  )
  const [stepRows] = await pool.query(
    'SELECT dish_id, instruction, image_url FROM dish_steps ORDER BY dish_id, sort_order, id',
  )
  const optionsByDish = new Map()
  for (const row of optionRows) {
    const options = optionsByDish.get(String(row.dish_id)) || []
    options.push(row.option_name)
    optionsByDish.set(String(row.dish_id), options)
  }
  const ingredientsByDish = new Map()
  for (const row of ingredientRows) {
    const ingredients = ingredientsByDish.get(String(row.dish_id)) || []
    ingredients.push({ name: row.ingredient_name, amount: row.amount })
    ingredientsByDish.set(String(row.dish_id), ingredients)
  }
  const stepsByDish = new Map()
  for (const row of stepRows) {
    const steps = stepsByDish.get(String(row.dish_id)) || []
    steps.push({ instruction: row.instruction, image: row.image_url || null })
    stepsByDish.set(String(row.dish_id), steps)
  }
  return dishRows.map((row) => ({
    id: Number(row.id), category: row.category, name: row.name, desc: row.description,
      sales: 0, spicy: row.spicy, badge: row.badge || undefined,
    image: row.image_url || '/icons/icon.svg', soldOut: Boolean(row.sold_out),
      custom: false, favorite: Boolean(row.favorite), options: optionsByDish.get(String(row.id)) || ['标准份'],
    ingredients: ingredientsByDish.get(String(row.id)) || [],
    steps: stepsByDish.get(String(row.id)) || [],
  }))
}

export async function getDish(id, connection = pool) {
  const [[row]] = await connection.execute(
      `SELECT id, category, name, description, spicy, badge, image_url, sold_out,
           EXISTS(SELECT 1 FROM favorites f WHERE f.dish_id = dishes.id) AS favorite
     FROM dishes WHERE id = ?`,
    [id],
  )
  if (!row) return null
  const [optionRows] = await connection.execute(
    'SELECT option_name FROM dish_options WHERE dish_id = ? ORDER BY sort_order, id',
    [id],
  )
  const [ingredientRows] = await connection.execute(
    'SELECT ingredient_name, amount FROM dish_ingredients WHERE dish_id = ? ORDER BY sort_order, id',
    [id],
  )
  const [stepRows] = await connection.execute(
    'SELECT instruction, image_url FROM dish_steps WHERE dish_id = ? ORDER BY sort_order, id',
    [id],
  )
  return {
    id: Number(row.id), category: row.category, name: row.name, desc: row.description,
      sales: 0, spicy: row.spicy, badge: row.badge || undefined,
    image: row.image_url || '/icons/icon.svg', soldOut: Boolean(row.sold_out),
      custom: false, favorite: Boolean(row.favorite), options: optionRows.map((option) => option.option_name),
    ingredients: ingredientRows.map((ingredient) => ({
      name: ingredient.ingredient_name,
      amount: ingredient.amount,
    })),
    steps: stepRows.map((step) => ({ instruction: step.instruction, image: step.image_url || null })),
  }
}

export async function createDish(dish) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.execute(
      `INSERT INTO dishes (category, name, description, spicy, image_url)
       VALUES (?, ?, ?, ?, ?)`,
      [dish.category, dish.name, dish.desc, dish.spicy, dish.image],
    )
    for (const [index, option] of (dish.options || ['标准份']).entries()) {
      await connection.execute(
        'INSERT INTO dish_options (dish_id, option_name, sort_order) VALUES (?, ?, ?)',
        [result.insertId, option, index],
      )
    }
    for (const [index, ingredient] of (dish.ingredients || []).entries()) {
      await connection.execute(
        'INSERT INTO dish_ingredients (dish_id, ingredient_name, amount, sort_order) VALUES (?, ?, ?, ?)',
        [result.insertId, ingredient.name, ingredient.amount, index],
      )
    }
    for (const [index, step] of (dish.steps || []).entries()) {
      const normalizedStep = typeof step === 'string' ? { instruction: step, image: null } : step
      await connection.execute(
        'INSERT INTO dish_steps (dish_id, instruction, image_url, sort_order) VALUES (?, ?, ?, ?)',
        [result.insertId, normalizedStep.instruction, normalizedStep.image || null, index],
      )
    }
    await connection.commit()
    return {
      ...dish,
      id: result.insertId,
      sales: 0,
      custom: true,
      favorite: false,
      options: dish.options || ['标准份'],
      ingredients: dish.ingredients || [],
      steps: dish.steps || [],
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateDish(id, dish) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    // 先确认菜品存在并读取旧封面（用于可能的文件垃圾回收）
    const [[existing]] = await connection.execute('SELECT id, image_url FROM dishes WHERE id = ?', [id])
    if (!existing) {
      await connection.rollback()
      return null
    }
    const oldImage = existing.image_url || null
    await connection.execute(
      `UPDATE dishes
       SET category = ?, name = ?, description = ?, spicy = ?, image_url = ?
       WHERE id = ?`,
      [dish.category, dish.name, dish.desc, dish.spicy, dish.image, id],
    )
    await connection.execute('DELETE FROM dish_options WHERE dish_id = ?', [id])
    await connection.execute('DELETE FROM dish_ingredients WHERE dish_id = ?', [id])
    await connection.execute('DELETE FROM dish_steps WHERE dish_id = ?', [id])
    for (const [index, option] of (dish.options || ['标准份']).entries()) {
      await connection.execute(
        'INSERT INTO dish_options (dish_id, option_name, sort_order) VALUES (?, ?, ?)',
        [id, option, index],
      )
    }
    for (const [index, ingredient] of (dish.ingredients || []).entries()) {
      await connection.execute(
        'INSERT INTO dish_ingredients (dish_id, ingredient_name, amount, sort_order) VALUES (?, ?, ?, ?)',
        [id, ingredient.name, ingredient.amount, index],
      )
    }
    for (const [index, step] of (dish.steps || []).entries()) {
      const normalizedStep = typeof step === 'string' ? { instruction: step, image: null } : step
      await connection.execute(
        'INSERT INTO dish_steps (dish_id, instruction, image_url, sort_order) VALUES (?, ?, ?, ?)',
        [id, normalizedStep.instruction, normalizedStep.image || null, index],
      )
    }
    const updatedDish = await getDish(id, connection)

    // 如果封面已更换且指向本地 uploads，尝试删除旧文件（失败不阻塞）
    try {
      if (oldImage && oldImage !== dish.image && oldImage.startsWith('/uploads/')) {
        const abs = path.join(process.cwd(), oldImage.slice(1))
        await unlink(abs)
      }
    } catch (e) {
      console.error('删除旧菜品图片失败：', e?.message || e)
    }

    await connection.commit()
    return updatedDish
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function deleteDish(id) {
  const [[row]] = await pool.execute('SELECT image_url FROM dishes WHERE id = ? LIMIT 1', [id])
  const imageUrl = row ? row.image_url : null
  const [result] = await pool.execute('DELETE FROM dishes WHERE id = ?', [id])
  if (result.affectedRows > 0 && imageUrl && imageUrl.startsWith('/uploads/')) {
    try {
      await unlink(path.join(process.cwd(), imageUrl.slice(1)))
    } catch (e) {
      console.error('删除菜品图片失败：', e?.message || e)
    }
  }
  return result.affectedRows > 0
}

export async function setFavorite(dishId, favorite) {
  if (favorite) {
    await pool.execute('INSERT IGNORE INTO favorites (dish_id) VALUES (?)', [dishId])
  } else {
    await pool.execute('DELETE FROM favorites WHERE dish_id = ?', [dishId])
  }
}

function messageRow(row) {
  return {
    id: Number(row.id),
    content: row.content,
    orderId: row.order_id === null ? null : Number(row.order_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    order: row.o_id === null || row.o_id === undefined
      ? null
      : { id: Number(row.o_id), createdAt: row.o_created_at, status: row.o_status, dishes: row.o_dishes || '' },
  }
}

function messageSummary(row) {
  return {
    id: Number(row.id),
    content: row.content,
    orderId: row.order_id === null ? null : Number(row.order_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    order: null,
  }
}

export async function listMessages() {
  const [rows] = await pool.query(
    `SELECT m.id, m.content, m.order_id, m.created_at, m.updated_at,
            o.id AS o_id, o.created_at AS o_created_at, o.status AS o_status,
            (SELECT GROUP_CONCAT(oi.dish_name SEPARATOR '、') FROM order_items oi WHERE oi.order_id = m.order_id) AS o_dishes
     FROM messages m
     LEFT JOIN orders o ON o.id = m.order_id
     ORDER BY m.id DESC LIMIT 500`,
  )
  return rows.map(messageRow)
}

export async function createMessage(content, orderId = null) {
  // 同一订单只保留一条留言：已存在则直接返回（用于点单初始化占位，避免重复创建）
  if (orderId !== null) {
    const [existingRows] = await pool.execute(
      'SELECT id, content, order_id, created_at, updated_at FROM messages WHERE order_id = ? ORDER BY id DESC LIMIT 1',
      [orderId],
    )
    if (existingRows.length) return messageSummary(existingRows[0])
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO messages (content, order_id) VALUES (?, ?)',
      [content, orderId],
    )
    const [[row]] = await pool.execute(
      'SELECT id, content, order_id, created_at, updated_at FROM messages WHERE id = ?',
      [result.insertId],
    )
    return messageSummary(row)
  } catch (error) {
    // 并发创建占位留言撞唯一索引 uk_messages_order：返回已存在的那条
    if (error.code === 'ER_DUP_ENTRY' && orderId !== null) {
      const [[existing]] = await pool.execute(
        'SELECT id, content, order_id, created_at, updated_at FROM messages WHERE order_id = ? ORDER BY id DESC LIMIT 1',
        [orderId],
      )
      if (existing) return messageSummary(existing)
    }
    throw error
  }
}

export async function updateMessage(id, content, orderId = null) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    // 留言迁移/保存到已有留言的订单时，删除目标订单的其他留言，保证每单只有一条
    if (orderId !== null) {
      await connection.execute('DELETE FROM messages WHERE order_id = ? AND id != ?', [orderId, id])
    }
    const [result] = await connection.execute(
      'UPDATE messages SET content = ?, order_id = ? WHERE id = ?',
      [content, orderId, id],
    )
    if (result.affectedRows === 0) {
      await connection.rollback()
      return null
    }
    const [[row]] = await connection.execute(
      'SELECT id, content, order_id, created_at, updated_at FROM messages WHERE id = ?',
      [id],
    )
    await connection.commit()
    return messageSummary(row)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function deleteMessage(id) {
  const [result] = await pool.execute('DELETE FROM messages WHERE id = ?', [id])
  return result.affectedRows > 0
}

export async function createOrder(order) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    // 取代旧单并清理历史垃圾单：只保留 completed（点餐记录）与本次新建的 confirmed，
    // 避免每次加菜都累积一张 cancelled 死单导致表无限膨胀
    await connection.execute("DELETE FROM orders WHERE status != 'completed'")
    // 订单号改为服务端生成，杜绝多设备同时用客户端时间戳撞号导致的串单
    const orderNumber = `ORD${Date.now()}${crypto.randomUUID().slice(0, 6).toUpperCase()}`

    // 先批量校验菜品是否存在，若不存在返回 400（避免插入 NULL 并产生“幽灵菜品”）
    const ids = order.items.map((i) => i.dishId)
    if (ids.length === 0) {
      await connection.rollback()
      const err = new Error('订单必须包含至少一道菜')
      err.status = 400
      throw err
    }
    const placeholders = ids.map(() => '?').join(',')
    const [rows] = await connection.execute(
      `SELECT id FROM dishes WHERE id IN (${placeholders})`,
      ids,
    )
    const existing = new Set(rows.map((r) => Number(r.id)))
    const missing = order.items.find((i) => !existing.has(i.dishId))
    if (missing) {
      await connection.rollback()
      const err = new Error(`菜品不存在: ${missing.dishId}`)
      err.status = 400
      throw err
    }

    const [result] = await connection.execute(
      `INSERT INTO orders (order_number, status) VALUES (?, 'confirmed')`,
      [orderNumber],
    )
    for (const item of order.items) {
      await connection.execute(
        'INSERT INTO order_items (order_id, dish_id, dish_name, option_name, note, quantity) VALUES (?, ?, ?, ?, ?, 1)',
        [result.insertId, item.dishId, item.name, item.option, item.note],
      )
    }
    await connection.commit()
    return { id: result.insertId, orderNumber }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function clearCurrentOrder() {
  // 清空当前菜单：删除所有未完成订单（含历史遗留的 cancelled 死单）
  const [result] = await pool.execute(
    "DELETE FROM orders WHERE status != 'completed'",
  )
  return result.affectedRows > 0
}

export async function completeOrder(id) {
  const [result] = await pool.execute(
    "UPDATE orders SET status = 'completed' WHERE id = ? AND status = 'confirmed'",
    [id],
  )
  return result.affectedRows > 0
}

export async function getLatestOrder() {
  const [[order]] = await pool.query(
      `SELECT id, order_number, created_at
     FROM orders WHERE status = 'confirmed' ORDER BY id DESC LIMIT 1`,
  )
  if (!order) return null

  const [itemRows] = await pool.execute(
    `SELECT dish_id, dish_name, option_name, note
     FROM order_items WHERE order_id = ? ORDER BY id`,
    [order.id],
  )
  return {
  id: Number(order.id),
  orderNumber: order.order_number,
  createdAt: order.created_at,
  items: itemRows.map((item) => ({
    dishId: Number(item.dish_id),
    name: item.dish_name,
    option: item.option_name,
    note: item.note,
  })),
  }
}

export async function listOrders({ days = 30 } = {}) {
  const [orderRows] = await pool.query(
      `SELECT id, order_number, status, created_at
     FROM orders
     WHERE status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY created_at DESC, id DESC`,
    [days],
  )
  if (!orderRows.length) return []
  const ids = orderRows.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(',')
  const [itemRows] = await pool.query(
    `SELECT order_id, dish_id, dish_name, option_name, note
     FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id, id`,
    ids,
  )
  const itemsByOrder = new Map()
  for (const row of itemRows) {
    const items = itemsByOrder.get(row.order_id) || []
    items.push({
      dishId: Number(row.dish_id),
      name: row.dish_name,
      option: row.option_name,
      note: row.note,
    })
    itemsByOrder.set(row.order_id, items)
  }
  const [messageRows] = await pool.query(
    `SELECT order_id, content FROM messages
     WHERE order_id IN (${placeholders}) ORDER BY order_id, id DESC`,
    ids,
  )
  const messageByOrder = new Map()
  for (const row of messageRows) {
    if (!messageByOrder.has(row.order_id)) messageByOrder.set(row.order_id, row.content)
  }
  return orderRows.map((row) => ({
  id: Number(row.id),
  orderNumber: row.order_number,
  status: row.status,
  createdAt: row.created_at,
  items: itemsByOrder.get(row.id) || [],
  message: messageByOrder.get(row.id) ?? null,
  }))
}
