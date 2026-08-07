import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import {
  completeOrder,
  createDish,
  createOrder,
  deleteDish,
  getLatestOrder,
  listOrders,
  pool,
} from '../server/db.js'

let createdDishId

after(async () => {
  if (createdDishId) await deleteDish(createdDishId)
  await pool.end()
})

test('另一台设备可以读取最近确认的菜单', async () => {
  const stamp = Date.now()
  const dish = await createDish({
    category: '同步测试',
    name: `同步测试菜品-${stamp}`,
    desc: '用于验证跨设备菜单同步',
    spicy: 0,
    image: '/icons/icon.svg',
    options: ['标准份'],
  })
  createdDishId = Number(dish.id)
  const orderNumber = `SYNC${stamp}`

  await createOrder({
    orderNumber,
    items: [{ dishId: createdDishId, name: dish.name, option: '标准份', note: '少盐' }],
  })

  const latestOrder = await getLatestOrder()

  assert.equal(latestOrder.orderNumber, orderNumber)
  assert.deepEqual(latestOrder.items, [{
    dishId: createdDishId,
    name: dish.name,
    option: '标准份',
    note: '少盐',
  }])
})

test('新订单会覆盖旧的确认单（全局只有一单进行中）', async () => {
  const stamp = Date.now()
  const dish = await createDish({
    category: '同步测试',
    name: `覆盖测试菜品-${stamp}`,
    desc: '用于验证新单覆盖旧确认单',
    spicy: 0,
    image: '/icons/icon.svg',
    options: ['标准份'],
  })
  const dishId = Number(dish.id)
  const firstNumber = `FIRST${stamp}`
  const secondNumber = `SECOND${stamp}`

  await createOrder({
    orderNumber: firstNumber,
    items: [{ dishId, name: dish.name, option: '标准份', note: '' }],
  })
  const first = await getLatestOrder()
  assert.equal(first.orderNumber, firstNumber)

  await createOrder({
    orderNumber: secondNumber,
    items: [{ dishId, name: dish.name, option: '标准份', note: '' }],
  })
  const second = await getLatestOrder()
  assert.equal(second.orderNumber, secondNumber, '新订单应成为最新的确认单')

  await deleteDish(dishId)
})

test('结束点单后进入点餐记录，且不再是最新确认单', async () => {
  const stamp = Date.now()
  const dish = await createDish({
    category: '同步测试',
    name: `完成测试菜品-${stamp}`,
    desc: '用于验证结束点单的生命周期',
    spicy: 0,
    image: '/icons/icon.svg',
    options: ['标准份'],
  })
  const dishId = Number(dish.id)
  const orderNumber = `DONE${stamp}`

  const created = await createOrder({
    orderNumber,
    items: [{ dishId, name: dish.name, option: '标准份', note: '' }],
  })

  const completed = await completeOrder(created.id)
  assert.equal(completed, true, '结束点单应成功')

  const latest = await getLatestOrder()
  assert.equal(latest, null, '完成后不应再有进行中的确认单')

  const history = await listOrders({ days: 30 })
  const found = history.find((order) => order.id === created.id)
  assert.ok(found, '完成的订单应出现在点餐记录中')
  assert.equal(found.status, 'completed')
  assert.deepEqual(found.items, [{ dishId, name: dish.name, option: '标准份', note: '' }])

  await deleteDish(dishId)
})