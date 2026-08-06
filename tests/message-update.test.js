import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import {
  createMessage,
  deleteMessage,
  listMessages,
  pool,
  updateMessage,
} from '../server/db.js'

const createdIds = []

after(async () => {
  for (const id of createdIds) {
    try {
      await deleteMessage(id)
    } catch {
      // 记录可能已不存在，忽略
    }
  }
  await pool.end()
})

test('编辑留言是更新同一记录而不是新增', async () => {
  const first = await createMessage('第一条留言')
  createdIds.push(first.id)

  const second = await updateMessage(first.id, '编辑后的留言')

  assert.equal(second.id, first.id, '更新后 id 应保持不变')
  assert.equal(second.content, '编辑后的留言')
  assert.ok(second.updatedAt, '更新后应返回 updatedAt')
  assert.ok(
    new Date(second.updatedAt) >= new Date(first.updatedAt || first.createdAt),
    '更新时间不应早于创建时间',
  )

  const all = await listMessages()
  const matches = all.filter((m) => m.id === first.id)
  assert.equal(matches.length, 1, '同一条记录应只存在一份')
  assert.equal(matches[0].content, '编辑后的留言')
  assert.ok(matches[0].updatedAt, '列表接口应返回 updatedAt')
})

test('更新不存在的留言返回 null', async () => {
  const updated = await updateMessage(999999999, '不存在')
  assert.equal(updated, null)
})
