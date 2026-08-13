import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveAccessibleDishIds } from '../user-auth.js'

test('admin can access all dishes', () => {
  assert.deepEqual(resolveAccessibleDishIds({ role: 'admin' }, [1, 2, 3], []), [1, 2, 3])
})

test('staff sees only assigned dishes', () => {
  const user = { username: 'alice', role: 'staff' }
  const assigned = [{ userId: 7, dishIds: [2, 3] }]
  assert.deepEqual(resolveAccessibleDishIds(user, [1, 2, 3], assigned), [2, 3])
})

test('new user without assigned dishes sees empty menu', () => {
  const user = { username: 'bob', role: 'staff' }
  assert.deepEqual(resolveAccessibleDishIds(user, [1, 2, 3], []), [])
})
