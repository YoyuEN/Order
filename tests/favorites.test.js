import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import {
  createDish,
  deleteDish,
  getDish,
  listDishes,
  pool,
  setFavorite,
} from '../server/db.js'

let createdDishId

after(async () => {
  if (createdDishId) await deleteDish(createdDishId)
  await pool.end()
})

test('菜品收藏支持设置、取消并在查询结果中反映', async () => {
  const stamp = Date.now()
  const created = await createDish({
    category: '收藏测试',
    name: `收藏测试菜品-${stamp}`,
    desc: '用于验证收藏功能',
    spicy: 0,
    image: '/icons/icon.svg',
    options: ['标准份'],
  })
  createdDishId = Number(created.id)

  assert.equal(created.favorite, false)
  assert.equal((await getDish(createdDishId)).favorite, false)
  assert.equal((await listDishes()).find((dish) => dish.id === createdDishId)?.favorite, false)

  await setFavorite(createdDishId, true)
  assert.equal((await getDish(createdDishId)).favorite, true)
  assert.equal((await listDishes()).find((dish) => dish.id === createdDishId)?.favorite, true)

  // 重复收藏不会报错（幂等）
  await setFavorite(createdDishId, true)
  assert.equal((await getDish(createdDishId)).favorite, true)

  await setFavorite(createdDishId, false)
  assert.equal((await getDish(createdDishId)).favorite, false)

  // 删除菜品后收藏记录级联清理
  assert.equal(await deleteDish(createdDishId), true)
  createdDishId = undefined
  assert.equal(await getDish(created.id), null)
})
