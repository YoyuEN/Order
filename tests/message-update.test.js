import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import {
  completeOrder,
  createDish,
  createMessage,
  createOrder,
  deleteDish,
  deleteMessage,
  listMessages,
  listOrders,
  pool,
  updateMessage,
} from '../server/db.js'

const createdIds = []
const createdDishIds = []
const createdOrderIds = []

after(async () => {
  for (const id of createdOrderIds) {
    try {
      await completeOrder(id)
    } catch {
      // 订单可能已不存在，忽略
    }
  }
  for (const id of createdIds) {
    try {
      await deleteMessage(id)
    } catch {
      // 记录可能已不存在，忽略
    }
  }
  for (const id of createdDishIds) {
    try {
      await deleteDish(id)
    } catch {
      // 忽略
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

test('留言可以关联到订单（orderId）', async () => {
  const linked = await createMessage('这单想说的话', 42)
  createdIds.push(linked.id)
  const general = await createMessage('通用留言', null)
  createdIds.push(general.id)

  const all = await listMessages()
  const linkedRow = all.find((m) => m.id === linked.id)
  const generalRow = all.find((m) => m.id === general.id)

  assert.equal(linkedRow.orderId, 42, '关联订单的留言应返回 orderId')
  assert.equal(generalRow.orderId, null, '未关联的留言 orderId 应为 null')

  const updated = await updateMessage(linked.id, '这单改想说的话', 42)
  assert.equal(updated.id, linked.id)
  assert.equal(updated.orderId, 42)
  assert.equal(updated.content, '这单改想说的话')
})

test('同一订单重复创建留言是幂等的（每单一条留言）', async () => {
  const stamp = Date.now()
  const dish = await createDish({
    category: '留言测试',
    name: `留言幂等菜品-${stamp}`,
    desc: '用于验证同订单留言幂等',
    spicy: 0,
    image: '/icons/icon.svg',
    options: ['标准份'],
  })
  createdDishIds.push(Number(dish.id))

  const created = await createOrder({
    orderNumber: `MSGIDEMP${stamp}`,
    items: [{ dishId: Number(dish.id), name: dish.name, option: '标准份', note: '' }],
  })
  const orderId = created.id
  createdOrderIds.push(created.id)

  const first = await createMessage('', orderId)
  createdIds.push(first.id)
  const second = await createMessage('第二次内容', orderId)

  assert.equal(second.id, first.id, '同一订单重复创建应返回已有留言，而不是新增')
  assert.equal(second.content, '', '幂等返回的是最初的占位留言')

  const all = await listMessages()
  const rows = all.filter((m) => m.orderId === orderId)
  assert.equal(rows.length, 1, '同一订单应只有一条留言')

  await completeOrder(created.id) // 清理：避免留下 confirmed 订单干扰并行测试
})

test('留言列表联查订单信息（订单时间与菜品）', async () => {
  const stamp = Date.now()
  const dish = await createDish({
    category: '留言测试',
    name: `留言联查菜品-${stamp}`,
    desc: '用于验证留言列表联查订单',
    spicy: 0,
    image: '/icons/icon.svg',
    options: ['标准份'],
  })
  createdDishIds.push(Number(dish.id))

  const created = await createOrder({
    orderNumber: `MSGLINK${stamp}`,
    items: [{ dishId: Number(dish.id), name: dish.name, option: '标准份', note: '' }],
  })
  createdOrderIds.push(created.id)
  const message = await createMessage('这单想说的话', created.id)
  createdIds.push(message.id)

  const all = await listMessages()
  const row = all.find((m) => m.id === message.id)
  assert.ok(row.order, '留言应联查返回订单摘要')
  assert.equal(row.order.id, created.id)
  assert.equal(row.order.status, 'confirmed')
  assert.ok(row.order.dishes.includes(dish.name), '订单摘要应包含菜品名')

  // 订单未关联留言时 order 为 null
  const general = await createMessage('通用留言', null)
  createdIds.push(general.id)
  const generalRow = (await listMessages()).find((m) => m.id === general.id)
  assert.equal(generalRow.order, null)

  await completeOrder(created.id) // 清理：避免留下 confirmed 订单干扰并行测试
})

test('点餐记录联查每单留言', async () => {
  const stamp = Date.now()
  const dish = await createDish({
    category: '留言测试',
    name: `记录留言菜品-${stamp}`,
    desc: '用于验证点餐记录联查留言',
    spicy: 0,
    image: '/icons/icon.svg',
    options: ['标准份'],
  })
  createdDishIds.push(Number(dish.id))

  const created = await createOrder({
    orderNumber: `MSGHIST${stamp}`,
    items: [{ dishId: Number(dish.id), name: dish.name, option: '标准份', note: '' }],
  })
  createdOrderIds.push(created.id)
  const message = await createMessage('今天想吃：\n这单的留言', created.id)
  createdIds.push(message.id)
  await completeOrder(created.id)

  const history = await listOrders({ days: 30 })
  const found = history.find((order) => order.id === created.id)
  assert.ok(found, '订单应出现在点餐记录中')
  assert.equal(found.message, '今天想吃：\n这单的留言')
})
