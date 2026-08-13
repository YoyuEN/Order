import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../server/index.js', import.meta.url), 'utf8')
const databaseSource = await readFile(new URL('../server/db.js', import.meta.url), 'utf8')

test('前端通过数据库 API 读取业务数据，并保留本地用户持久化状态', () => {
  assert.doesNotMatch(mainSource, /defaultDishes/)
  assert.doesNotMatch(mainSource, /pendingOrders|localOnly/)
  assert.match(mainSource, /apiRequest\('\/api\/dishes'\)/)
  assert.match(mainSource, /apiRequest\('\/api\/orders\/latest'/)
  assert.match(mainSource, /apiRequest\('\/api\/orders', \{\s*method: 'POST'/)
  assert.match(mainSource, /localStorage|getCurrentUser\(/)
})

test('管理员具备创建用户入口和数据库创建路由', () => {
  assert.match(mainSource, /data-action="create-user"/)
  assert.match(serverSource, /app\.post\('\/api\/users'/)
  assert.match(databaseSource, /export async function createUser/)
})

test('管理员具备分配菜单入口和用户菜单分配接口', () => {
  assert.match(mainSource, /data-action="assign-menu"/)
  assert.match(serverSource, /app\.(get|put)\('\/api\/users\/.+\/menu'|app\.get\('\/api\/users'/)
  assert.match(databaseSource, /export async function setUserMenuDishIds/)
})

test('刷新后如果已登录，应直接恢复到菜单页而不是回到登录页', () => {
  assert.match(mainSource, /const persistedUser = getCurrentUser\(\)/)
  assert.match(mainSource, /function restoreCurrentUserSession\(\)/)
  assert.match(mainSource, /state\.view = 'menu'/)
})

test('不同用户要有独立的点单和留言历史', () => {
  assert.match(serverSource, /X-User-Id.*orders|X-User-Id.*messages|app\.get\('\/api\/orders\/latest'/)
  assert.match(databaseSource, /user_id BIGINT UNSIGNED|ALTER TABLE orders ADD COLUMN user_id|ALTER TABLE messages ADD COLUMN user_id/)
  assert.match(databaseSource, /WHERE user_id = \?/)
})

test('清空已点菜单会同步取消数据库中的当前菜单', () => {
  assert.match(mainSource, /apiRequest\('\/api\/orders\/current', \{ method: 'DELETE' \}\)/)
  assert.match(serverSource, /app\.delete\('\/api\/orders\/current'/)
  assert.match(databaseSource, /export async function clearCurrentOrder/)
  assert.match(databaseSource, /DELETE FROM orders WHERE status != 'completed'/)
})
