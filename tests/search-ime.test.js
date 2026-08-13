import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldSkipSearchRender } from '../search-ime.js'

test('search input should skip re-render while IME composition is active', () => {
  const event = {
    target: { id: 'dish-search' },
    isComposing: true,
  }

  assert.equal(shouldSkipSearchRender(event), true)
})

test('search input should render after IME composition ends', () => {
  const event = {
    target: { id: 'dish-search' },
    isComposing: false,
  }

  assert.equal(shouldSkipSearchRender(event), false)
})
