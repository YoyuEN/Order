import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import {
  createDish,
  createOrder,
  deleteDish,
  getLatestOrder,
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