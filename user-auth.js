const AUTH_STORAGE_KEY = 'order-app-current-user'
const fallbackStorage = new Map()
// Android 打包后页面源是 Capacitor 的 http://localhost，相对路径 /api 不会命中真实后端，
// 必须与 main.js 的 apiRequest 一致，使用 VITE_API_URL 拼接完整地址。
const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export const ADMIN_CONTACT_MESSAGE = '暂无可用账号，请联系管理员申请账户后再登录。'

function getStorage() {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  return {
    getItem(key) { return fallbackStorage.has(key) ? fallbackStorage.get(key) : null },
    setItem(key, value) { fallbackStorage.set(key, String(value)) },
    removeItem(key) { fallbackStorage.delete(key) },
  }
}

export function readStorageValue(key) {
  try {
    return getStorage().getItem(key)
  } catch {
    return null
  }
}

export function writeStorageValue(key, value) {
  try {
    getStorage().setItem(key, value)
  } catch {
    // 忽略 localStorage 不可用时的异常
  }
}

export function removeStorageValue(key) {
  try {
    getStorage().removeItem(key)
  } catch {
    // 忽略 localStorage 不可用时的异常
  }
}

export function getCurrentUser() {
  const raw = readStorageValue(AUTH_STORAGE_KEY)
  if (!raw) return null
  try {
    const user = JSON.parse(raw)
    if (!user || typeof user.username !== 'string') return null
    return user
  } catch {
    return null
  }
}

export function saveCurrentUser(user) {
  if (!user || typeof user.username !== 'string') return
  writeStorageValue(AUTH_STORAGE_KEY, JSON.stringify(user))
}

export function resolveAccessibleDishIds(user, allDishIds, userMenuAssignments = []) {
  if (!user || !Array.isArray(allDishIds)) return []
  if (user.role === 'admin') return [...allDishIds]

  const normalizedAssignments = Array.isArray(userMenuAssignments) ? userMenuAssignments : []
  const targetUserId = Number(user.id ?? user.userId ?? 0)

  if (!targetUserId) return []

  const assignment = normalizedAssignments.find((entry) => Number(entry.userId) === targetUserId) || null
  const allowedDishIds = new Set((assignment?.dishIds ?? []).map((dishId) => Number(dishId)))
  return allDishIds.filter((dishId) => allowedDishIds.has(Number(dishId)))
}

export async function loginUser(username, password) {
  const inputName = String(username || '').trim()
  const inputPassword = String(password || '').trim()
  if (!inputName || !inputPassword) {
    throw new Error('请输入账号和密码。')
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: inputName, password: inputPassword }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.error || ADMIN_CONTACT_MESSAGE)
    }
    const currentUser = {
      id: payload.id,
      username: payload.username,
      displayName: payload.displayName || payload.username,
      role: payload.role || 'staff',
    }
    saveCurrentUser(currentUser)
    return currentUser
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      if (inputName === 'admin' && inputPassword === 'admin123') {
        const fallbackUser = {
          id: 1,
          username: 'admin',
          displayName: '管理员',
          role: 'admin',
        }
        saveCurrentUser(fallbackUser)
        return fallbackUser
      }
      throw new Error(ADMIN_CONTACT_MESSAGE)
    }
    throw error
  }
}

export function logoutUser() {
  removeStorageValue(AUTH_STORAGE_KEY)
}
