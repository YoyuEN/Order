import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8')

test('前端业务数据只通过数据库 API 读写', () => {
  assert.doesNotMatch(mainSource, /localStorage/)
  assert.doesNotMatch(mainSource, /defaultDishes/)
  assert.doesNotMatch(mainSource, /pendingOrders|localOnly/)
  assert.match(mainSource, /apiRequest\('\/api\/dishes'\)/)
  assert.match(mainSource, /apiRequest\('\/api\/orders\/latest'/)
  assert.match(mainSource, /apiRequest\('\/api\/orders', \{\s*method: 'POST'/)
})
