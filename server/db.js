import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import { defaultDishes } from '../menu-data.js'

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
      sales INT UNSIGNED NOT NULL DEFAULT 0,
      spicy TINYINT UNSIGNED NOT NULL DEFAULT 0,
      badge VARCHAR(50) NULL,
      image_url VARCHAR(1000) NULL,
      sold_out BOOLEAN NOT NULL DEFAULT FALSE,
      is_custom BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), INDEX idx_dishes_category (category), INDEX idx_dishes_name (name)
    ) ENGINE=InnoDB`)
    await connection.query(`CREATE TABLE IF NOT EXISTS dish_options (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      dish_id BIGINT UNSIGNED NOT NULL,
      option_name VARCHAR(100) NOT NULL,
      sort_order INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (id), UNIQUE KEY uk_dish_option (dish_id, option_name),
      CONSTRAINT fk_dish_options_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
    await connection.query(`CREATE TABLE IF NOT EXISTS orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_number VARCHAR(32) NOT NULL,
      table_number VARCHAR(20) NOT NULL,
      guest_count TINYINT UNSIGNED NOT NULL,
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
      quantity INT UNSIGNED NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), INDEX idx_order_items_order_id (order_id),
      CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_order_items_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE SET NULL
    ) ENGINE=InnoDB`)
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
        `INSERT INTO dishes (category, name, description, sales, spicy, badge, image_url, sold_out, is_custom)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
        [dish.category, dish.name, dish.desc, dish.sales, dish.spicy || 0, dish.badge || null, dish.image, Boolean(dish.soldOut)],
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
    `SELECT id, category, name, description, sales, spicy, badge, image_url, sold_out, is_custom
     FROM dishes ORDER BY id`,
  )
  const [optionRows] = await pool.query(
    'SELECT dish_id, option_name FROM dish_options ORDER BY dish_id, sort_order, id',
  )
  const optionsByDish = new Map()
  for (const row of optionRows) {
    const options = optionsByDish.get(String(row.dish_id)) || []
    options.push(row.option_name)
    optionsByDish.set(String(row.dish_id), options)
  }
  return dishRows.map((row) => ({
    id: Number(row.id), category: row.category, name: row.name, desc: row.description,
    sales: row.sales, spicy: row.spicy, badge: row.badge || undefined,
    image: row.image_url || '/icons/icon.svg', soldOut: Boolean(row.sold_out),
    custom: Boolean(row.is_custom), options: optionsByDish.get(String(row.id)) || ['标准份'],
  }))
}

export async function getDish(id, connection = pool) {
  const [[row]] = await connection.execute(
    `SELECT id, category, name, description, sales, spicy, badge, image_url, sold_out, is_custom
     FROM dishes WHERE id = ?`,
    [id],
  )
  if (!row) return null
  const [optionRows] = await connection.execute(
    'SELECT option_name FROM dish_options WHERE dish_id = ? ORDER BY sort_order, id',
    [id],
  )
  return {
    id: Number(row.id), category: row.category, name: row.name, desc: row.description,
    sales: row.sales, spicy: row.spicy, badge: row.badge || undefined,
    image: row.image_url || '/icons/icon.svg', soldOut: Boolean(row.sold_out),
    custom: Boolean(row.is_custom), options: optionRows.map((option) => option.option_name),
  }
}

export async function createDish(dish) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.execute(
      `INSERT INTO dishes (category, name, description, spicy, image_url, is_custom)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [dish.category, dish.name, dish.desc, dish.spicy, dish.image],
    )
    for (const [index, option] of dish.options.entries()) {
      await connection.execute(
        'INSERT INTO dish_options (dish_id, option_name, sort_order) VALUES (?, ?, ?)',
        [result.insertId, option, index],
      )
    }
    await connection.commit()
    return { ...dish, id: result.insertId, sales: 0, custom: true }
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
    const [result] = await connection.execute(
      `UPDATE dishes
       SET category = ?, name = ?, description = ?, spicy = ?, image_url = ?
       WHERE id = ?`,
      [dish.category, dish.name, dish.desc, dish.spicy, dish.image, id],
    )
    if (!result.affectedRows) {
      await connection.rollback()
      return null
    }
    await connection.execute('DELETE FROM dish_options WHERE dish_id = ?', [id])
    for (const [index, option] of dish.options.entries()) {
      await connection.execute(
        'INSERT INTO dish_options (dish_id, option_name, sort_order) VALUES (?, ?, ?)',
        [id, option, index],
      )
    }
    const updatedDish = await getDish(id, connection)
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
  const [result] = await pool.execute('DELETE FROM dishes WHERE id = ?', [id])
  return result.affectedRows > 0
}

export async function createOrder(order) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.execute(
      `INSERT INTO orders (order_number, table_number, guest_count, status)
       VALUES (?, ?, ?, 'confirmed')`,
      [order.orderNumber, order.table, order.guests],
    )
    for (const item of order.items) {
      await connection.execute(
        `INSERT INTO order_items (order_id, dish_id, dish_name, option_name, note, quantity)
         VALUES (?, (SELECT id FROM dishes WHERE id = ?), ?, ?, ?, ?)`,
        [result.insertId, item.dishId, item.name, item.option, item.note, item.quantity],
      )
    }
    await connection.commit()
    return { id: result.insertId, orderNumber: order.orderNumber }
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') {
      const [[existing]] = await pool.execute(
        'SELECT id, order_number FROM orders WHERE order_number = ?',
        [order.orderNumber],
      )
      if (existing) return { id: existing.id, orderNumber: existing.order_number }
    }
    throw error
  } finally {
    connection.release()
  }
}
