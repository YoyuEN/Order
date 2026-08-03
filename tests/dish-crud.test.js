import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import {
  createDish,
  deleteDish,
  getDish,
  listDishes,
  pool,
  updateDish,
} from '../server/db.js'

let createdDishId

after(async () => {
  if (createdDishId) await deleteDish(createdDishId)
  await pool.end()
})

test('菜品支持新增、查询、修改和删除', async () => {
  const stamp = Date.now()
  const created = await createDish({
    category: '测试分类',
    name: `CRUD测试菜品-${stamp}`,
    desc: '创建状态',
    spicy: 0,
    image: '/icons/icon.svg',
    options: ['标准份'],
    ingredients: [
      { name: '测试食材', amount: '100克' },
      { name: '测试调料', amount: '少许' },
    ],
    steps: ['准备食材', '完成烹饪'],
  })
  createdDishId = Number(created.id)

  const found = await getDish(createdDishId)
  assert.equal(found.name, created.name)
  assert.deepEqual(found.options, ['标准份'])
  assert.deepEqual(found.ingredients, [
    { name: '测试食材', amount: '100克' },
    { name: '测试调料', amount: '少许' },
  ])
  assert.deepEqual(found.steps, ['准备食材', '完成烹饪'])

  const updated = await updateDish(createdDishId, {
    category: '测试分类',
    name: created.name,
    desc: '修改状态',
    spicy: 1,
    image: '/icons/icon.svg',
    options: ['小份', '大份'],
    ingredients: [{ name: '更新食材', amount: '2份' }],
    steps: ['更新后的步骤'],
  })
  assert.equal(updated.desc, '修改状态')
  assert.equal(updated.spicy, 1)
  assert.deepEqual(updated.options, ['小份', '大份'])
  assert.deepEqual(updated.ingredients, [{ name: '更新食材', amount: '2份' }])
  assert.deepEqual(updated.steps, ['更新后的步骤'])

  const listed = await listDishes()
  assert.equal(listed.find((dish) => dish.id === createdDishId)?.desc, '修改状态')

  assert.equal(await deleteDish(createdDishId), true)
  createdDishId = undefined
  assert.equal(await getDish(created.id), null)
  assert.equal(await deleteDish(created.id), false)
})
