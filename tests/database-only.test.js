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

test('清空已点菜单会同步取消数据库中的当前菜单', () => {
  assert.match(mainSource, /apiRequest\('\/api\/orders\/current', \{ method: 'DELETE' \}\)/)
  assert.match(serverSource, /app\.delete\('\/api\/orders\/current'/)
  assert.match(databaseSource, /export async function clearCurrentOrder/)
  assert.match(databaseSource, /DELETE FROM orders WHERE status != 'completed'/)
})
