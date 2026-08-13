import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { App } from '@capacitor/app'
import { shouldSkipSearchRender } from './search-ime.js'

let dishes = []
let dishesStatus = 'loading'
let messages = []
let messagesStatus = 'loading'
const state = {
  category: '全部', search: '', picks: [],
  currentOrderId: null,
  orderHistory: [], orderHistoryStatus: 'idle',
  selectedDish: null, editingDish: null, selectedOption: '', note: '', view: 'menu', orderNumber: '', confirmed: false, confirmedCount: 0, imagePreviewOpen: false, imagePreviewSrc: '', imagePreviewAlt: '', imagePreviewReturnSelector: null, showSuccessModal: false, moreMenuOpen: false, ordersMenuOpen: false, messageDraft: '',
}

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const orderRefreshInterval = 10000
const historyKey = 'order-app'
const formDraftKey = 'dish-form-draft'
let formDraft = null
let draftCoverUrl = null
let draftStepUrls = []
let previewScrollY = 0

function navigationState(scrollY = 0) {
  return {
    app: historyKey,
    view: state.view,
    selectedDishId: state.selectedDish?.id || null,
    editingDishId: state.editingDish?.id || null,
    scrollY,
  }
}

function restoreNavigationState(entry) {
  state.view = entry.view || 'menu'
  state.selectedDish = entry.selectedDishId ? dishes.find((dish) => dish.id === entry.selectedDishId) || state.selectedDish : null
  state.editingDish = entry.editingDishId ? dishes.find((dish) => dish.id === entry.editingDishId) || state.editingDish : null
  state.moreMenuOpen = false
  state.ordersMenuOpen = false
}

function restoreScroll(scrollY = 0) {
  window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' }))
}

function navigate(view, { replace = false } = {}) {
  window.history.replaceState(navigationState(window.scrollY), '')
  state.view = view
  const entry = navigationState(0)
  window.history[replace ? 'replaceState' : 'pushState'](entry, '')
  render()
  restoreScroll(0)
}

function goBack() {
  if (state.imagePreviewOpen) {
    closeImagePreview()
    return true
  }
  if (state.showSuccessModal) {
    closeSuccessModal()
    return true
  }
  if (state.view === 'menu') return false
  window.history.back()
  return true
}

async function apiRequest(path, options = {}) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  try {
    const token = localStorage.getItem('api_token') || ''
    const headers = { 'Content-Type': 'application/json', ...options.headers }
    if (token) headers['X-Api-Token'] = token

    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      let message = `请求失败（${response.status}）`
      try {
        const body = await response.json()
        if (body?.error) message = body.error
      } catch (e) {
        // 非 JSON 响应，保持默认消息
      }
      throw new Error(message)
    }
    return response.status === 204 ? null : await response.json()
  } finally {
    window.clearTimeout(timeout)
  }
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('仅支持图片文件')
  if (file.type === 'image/gif') return file
  const original = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = URL.createObjectURL(file)
  })
  const maxDimension = 1600
  let { width, height } = original
  if (width > maxDimension || height > maxDimension) {
    const ratio = maxDimension / Math.max(width, height)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(original, 0, 0, width, height)
  canvas.toBlob((blob) => URL.revokeObjectURL(original.src), file.type)
  const maxSize = 3 * 1024 * 1024
  const minSize = 500 * 1024
  let quality = 0.92
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (blob.size > maxSize) {
    const blobLow = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.5))
    const blobHigh = blob
    let lo = 0.5, hi = 0.92
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2
      const blobMid = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', mid))
      if (blobMid.size > maxSize) { hi = mid } else { lo = mid; blob = blobMid }
    }
  }
  if (blob.size < minSize && blob.size > 0) {
    const ratio = Math.min(Math.sqrt(minSize / blob.size), 1.8)
    const upscaleCanvas = document.createElement('canvas')
    upscaleCanvas.width = Math.round(width * ratio)
    upscaleCanvas.height = Math.round(height * ratio)
    const uctx = upscaleCanvas.getContext('2d')
    uctx.imageSmoothingEnabled = true
    uctx.imageSmoothingQuality = 'high'
    uctx.drawImage(original, 0, 0, upscaleCanvas.width, upscaleCanvas.height)
    blob = await new Promise((resolve) => upscaleCanvas.toBlob(resolve, 'image/jpeg', 0.88))
    URL.revokeObjectURL(original.src)
    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
  }
  URL.revokeObjectURL(original.src)
  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
}

async function uploadDishImage(file) {
  const compressed = await compressImage(file).catch(() => null)
  const uploadFile = compressed || file
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15000)
  const body = new FormData()
  body.append('image', uploadFile)
  try {
    const response = await fetch(`${apiBaseUrl}/api/uploads/dish-image`, { method: 'POST', body, signal: controller.signal })
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw new Error(result.error || '图片上传失败')
    }
    const result = await response.json()
    return result.url.startsWith('/') && apiBaseUrl ? `${apiBaseUrl}${result.url}` : result.url
  } finally {
    window.clearTimeout(timeout)
  }
}

async function loadDishes() {
  dishesStatus = 'loading'
  render()
  try {
    const remoteDishes = await apiRequest('/api/dishes')
    if (Array.isArray(remoteDishes)) {
      dishes = remoteDishes
      dishesStatus = 'ready'
      render()
    }
  } catch {
    dishes = []
    dishesStatus = 'error'
    render()
    showToast('菜单加载失败，请检查网络后重试')
  }
}

async function loadLatestOrder({ notify = false } = {}) {
  try {
    const order = await apiRequest('/api/orders/latest', { cache: 'no-store' })
    if (!order) {
      if (state.confirmed && state.picks.length > 0) {
        state.picks = []
        state.orderNumber = ''
        state.confirmed = false
        state.confirmedCount = 0
        state.currentOrderId = null
        render()
        if (notify) showToast('已同步清空菜单')
      } else if (state.currentOrderId) {
        state.currentOrderId = null
      }
      return
    }
    if (!order?.orderNumber || order.orderNumber === state.orderNumber || !Array.isArray(order.items)) return
    const previousOrderId = state.currentOrderId
    state.picks = order.items.map((item) => ({ ...item, key: String(item.dishId) }))
    state.orderNumber = order.orderNumber
    const nextOrderId = order.id ?? state.currentOrderId
    if (previousOrderId && previousOrderId !== nextOrderId) {
      try {
        // 先迁移留言再切换 currentOrderId，否则找不到旧订单的留言
        await moveMessageToOrder(nextOrderId)
      } catch {
        // 留言迁移失败不阻塞同步
      }
    }
    state.currentOrderId = nextOrderId
    state.confirmed = true
    state.confirmedCount = state.picks.length
    render()
    if (notify) showToast('已同步最新菜单')
  } catch {
    if (notify) showToast('菜单同步失败，请检查网络后重试')
  }
}

async function loadOrderHistory() {
  state.orderHistoryStatus = state.orderHistory.length ? 'ready' : 'loading'
  render()
  try {
    const history = await apiRequest('/api/orders?days=30', { cache: 'no-store' })
    if (Array.isArray(history)) {
      state.orderHistory = history
      state.orderHistoryStatus = 'ready'
    }
  } catch {
    state.orderHistoryStatus = state.orderHistory.length ? 'ready' : 'error'
  }
  render()
}

async function loadMessages({ silent = false } = {}) {
  if (!silent) {
    messagesStatus = 'loading'
    render()
  }
  try {
    const remoteMessages = await apiRequest('/api/messages', { cache: 'no-store' })
    if (Array.isArray(remoteMessages)) {
      messages = remoteMessages
      messagesStatus = 'ready'
      render()
    }
  } catch {
    if (silent) return
    messages = []
    messagesStatus = 'error'
    render()
    showToast('留言加载失败，请检查网络后重试')
  }
}

const icons = {
  search: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m21 21-4.4-4.4m2.4-5.1A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z"/></svg>',
  back: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  list: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 7 2 2 4-4M12 7h8M4 14l2 2 4-4m2 2h8"/></svg>',
  home: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m3 11 9-8 9 8v9H8v-7h8v7"/></svg>',
  receipt: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6"/></svg>',
  plus: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  upload: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5"/></svg>',
  send: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></svg>',
  message: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 9h8M8 12h5"/></svg>',
  close: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  heart: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21C12 21 3 14 3 8a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-9 13-9 13Z"/></svg>',
  user: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/><path d="M4 22a8 8 0 0 1 16 0"/></svg>',
  more: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
  moreHorizontal: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  edit: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  trash: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>',
  chevronDown: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>',
  zoom: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm6.3 10.9 4.5 4.5-1.4 1.4-4.5-4.5a7 7 0 1 1 1.4-1.4ZM9.2 7v6M6.2 10h6"/></svg>',
}

function markMenuAsDraft() {
  state.confirmed = false
}

function isFormView() {
  return state.view === 'dishForm'
}

function revokeDraftUrls() {
  if (draftCoverUrl) { URL.revokeObjectURL(draftCoverUrl); draftCoverUrl = null }
  draftStepUrls.forEach((url) => URL.revokeObjectURL(url))
  draftStepUrls = []
}

function saveFormDraft() {
  if (state.view !== 'dishForm') return
  const form = document.querySelector('#dish-form')
  if (!form) return
  const optionRows = [...form.querySelectorAll('[data-option-row]')]
  const ingredientRows = [...form.querySelectorAll('[data-ingredient-row]')]
  const stepRows = [...form.querySelectorAll('[data-step-row]')]
  formDraft = {
    editingId: state.editingDish?.id ?? null,
    name: form.querySelector('[name="name"]')?.value || '',
    desc: form.querySelector('[name="desc"]')?.value || '',
    categoryPreset: form.querySelector('[name="categoryPreset"]')?.value || '',
    customCategory: form.querySelector('[name="customCategory"]')?.value || '',
    options: optionRows.map((row) => row.querySelector('[name="dishOption"]')?.value || ''),
    ingredients: ingredientRows.map((row) => ({ name: row.querySelector('[name="ingredientName"]')?.value || '', amount: row.querySelector('[name="ingredientAmount"]')?.value || '' })),
    steps: stepRows.map((row, index) => ({
      instruction: row.querySelector('[name="stepInstruction"]')?.value || '',
      image: row.dataset.draftFile === 'true' ? null : (row.dataset.image || null),
      file: row.querySelector('[name="stepImage"]')?.files?.[0] || (row.dataset.draftFile === 'true' ? formDraft?.steps?.[index]?.file : null) || null,
    })),
    imageFile: form.querySelector('#dish-form-image')?.files?.[0] || formDraft?.imageFile || null,
    coverRemoved: formDraft?.coverRemoved || false,
  }
  try {
    localStorage.setItem(formDraftKey, JSON.stringify({ ...formDraft, imageFile: null, steps: formDraft.steps.map((step) => ({ instruction: step.instruction, image: step.image, file: null })) }))
  } catch { /* localStorage 不可用时忽略，草稿仅保留在内存中 */ }
}

function getFormDraft(editing) {
  let draft = formDraft
  if (!draft) {
    try {
      const raw = localStorage.getItem(formDraftKey)
      if (raw) draft = JSON.parse(raw)
    } catch { /* 忽略损坏的草稿 */ }
  }
  if (!draft) return null
  if ((draft.editingId ?? null) !== (editing?.id ?? null)) return null
  return draft
}

function clearFormDraft() {
  formDraft = null
  revokeDraftUrls()
  try { localStorage.removeItem(formDraftKey) } catch { /* 忽略 */ }
}

function pickCount() { return state.picks.length }

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML }
function escapeAttr(value) { return escapeHtml(String(value)).replaceAll('"', '&quot;').replaceAll("'", '&#39;') }

function imageMarkup(dish, large = false) {
  return `<div class="dish-image ${large ? 'dish-image--large' : ''}"><img src="${escapeAttr(dish.image)}" alt="${escapeAttr(dish.name)}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('image-fallback')"><span aria-hidden="true">食</span>${dish.soldOut ? '<em>已售罄</em>' : ''}</div>`
}

function menuView() {
  const categories = ['全部', ...new Set(dishes.map((dish) => dish.category))]
  const filtered = dishes.filter((dish) => (state.category === '全部' || dish.category === state.category) && (`${dish.name}${dish.desc}`.includes(state.search)))
  const dishGrid = dishesStatus === 'loading'
    ? '<div class="empty" role="status"><b>正在加载菜单</b><span>正在从数据库读取菜品</span></div>'
    : dishesStatus === 'error'
      ? '<div class="empty" role="alert"><b>菜单加载失败</b><span>无法连接数据库服务，请检查网络后重试</span><button class="secondary-button" data-action="retry-dishes">重新加载</button></div>'
      : filtered.length
        ? filtered.map(dishCard).join('')
        : `<div class="empty"><b>${dishes.length ? '没有找到相关菜品' : '数据库中暂无菜品'}</b><span>${dishes.length ? '换个关键词或分类试试' : '请使用新增菜品录入菜单'}</span></div>`
  return `
    <main class="menu-layout">
      <section class="menu-panel" aria-labelledby="menu-heading">
        <div class="search-wrap">${icons.search}<label class="sr-only" for="dish-search">搜索菜品</label><input id="dish-search" type="search" placeholder="搜索想吃的菜" value="${escapeHtml(state.search)}" autocomplete="off"></div>
        <nav class="categories" aria-label="菜品分类">${categories.map((category) => `<button class="category ${category === state.category ? 'active' : ''}" data-category="${escapeAttr(category)}" aria-pressed="${category === state.category}">${escapeHtml(category)}</button>`).join('')}</nav>
        <div class="section-title"><div><p class="eyebrow">今日菜单</p><h2 id="menu-heading">${state.category === '全部' ? '人气菜品' : escapeHtml(state.category)}</h2></div><span>${filtered.length} 道菜</span></div>
        <div class="dish-grid">${dishGrid}</div>
      </section>
      <aside class="desktop-cart" aria-label="已点菜单">${pickedContent(true)}</aside>
    </main>
    ${bottomBar()}`
}

function dishCard(dish) {
  const selected = state.picks.some((item) => item.dishId === dish.id)
  return `<article class="dish-card ${dish.soldOut ? 'sold-out' : ''}">
    <button class="dish-open" data-dish="${dish.id}" ${dish.soldOut ? 'disabled' : ''} aria-label="查看${escapeAttr(dish.name)}详情">${imageMarkup(dish)}<span class="dish-info">${dish.badge ? `<small>${escapeHtml(dish.badge)}</small>` : ''}<b>${escapeHtml(dish.name)}</b><span>${escapeHtml(dish.desc)}</span>${dish.spicy ? `<span class="sales">${'🌶'.repeat(dish.spicy)}</span>` : ''}</span></button>
    <div class="dish-footer"><span>${dish.soldOut ? '暂时售罄' : selected ? '已点' : '想吃就点它'}</span>${dish.soldOut ? '' : `<button class="add-button ${selected ? 'selected' : ''}" data-dish="${dish.id}" aria-label="${selected ? '已点' : '点选'}${escapeAttr(dish.name)}" ${selected ? 'disabled' : ''}>${selected ? '✓' : '+'}</button>`}</div>
  </article>`
}

function bottomBar() {
  const count = pickCount()
  const active = state.view
  return `<nav class="bottom-nav" aria-label="主导航">
    <button class="nav-item ${active === 'menu' ? 'active' : ''}" data-action="menu">${icons.home}<span>首页</span></button>
    <button class="nav-item ${active === 'orders' ? 'active' : ''}" data-action="orders">${icons.receipt}<span>已点</span></button>
    <button class="nav-center-btn" data-action="new-dish" aria-label="新增菜品">${icons.plus}</button>
    <button class="nav-item ${active === 'messages' ? 'active' : ''}" data-action="messages">${icons.message}<span>留言</span></button>
    <button class="nav-item ${active === 'profile' ? 'active' : ''}" data-action="profile">${icons.user}<span>我的</span></button>
  </nav>`
}

function detailView() {
  const dish = state.selectedDish
  const ingredients = (dish.ingredients || []).filter((ingredient) => ingredient?.name || ingredient?.amount)
  const steps = (dish.steps || []).map((step) => typeof step === 'string' ? { instruction: step, image: null } : step)
  const ingredientList = ingredients.length ? `<section class="detail-ingredients" aria-labelledby="detail-ingredients-heading"><h2 id="detail-ingredients-heading">用料</h2><dl>${ingredients.map((ingredient) => `<div><dt>${escapeHtml(ingredient.name || '')}</dt><dd>${escapeHtml(ingredient.amount || '')}</dd></div>`).join('')}</dl></section>` : ''
  const recipe = steps.length ? `<section class="recipe-section" aria-labelledby="recipe-heading"><h2 id="recipe-heading">制作步骤</h2><ol class="recipe-steps">${steps.map((step, stepIndex) => `<li><div class="recipe-step-content"><b>${escapeHtml(step.instruction)}</b></div>${step.image ? `<button class="recipe-step-image" type="button" data-action="preview-step-image" data-step-preview-index="${stepIndex}" data-image-src="${escapeAttr(step.image)}" aria-label="放大预览步骤图片">${icons.zoom}<img src="${escapeAttr(step.image)}" alt="" loading="lazy"></button>` : ''}</li>`).join('')}</ol></section>` : ''
  return `<main class="detail-view"><button class="icon-button floating-back" data-action="close" aria-label="返回菜单">${icons.back}</button><button class="icon-button floating-more" data-action="toggle-more-menu" aria-label="更多操作" aria-expanded="${state.moreMenuOpen}">${icons.more}</button>${state.moreMenuOpen ? `<div class="more-menu-dropdown" role="menu" aria-label="菜品管理"><button class="more-menu-item" data-action="edit-dish" role="menuitem">${icons.edit}<span>编辑菜品</span></button><button class="more-menu-item more-menu-item--danger" data-action="delete-dish" role="menuitem">${icons.trash}<span>删除菜品</span></button></div>` : ''}${state.moreMenuOpen ? '<button class="more-menu-backdrop" data-action="close-more-menu" aria-label="关闭菜单"></button>' : ''}<button class="dish-image-preview-button" data-action="preview-image" aria-label="放大预览${escapeAttr(dish.name)}图片">${imageMarkup(dish, true)}<span class="preview-hint" aria-hidden="true">点击查看大图</span></button><section class="detail-sheet"><p class="eyebrow">${escapeHtml(dish.category)}</p><h1>${escapeHtml(dish.name)}</h1><p class="detail-desc">${escapeHtml(dish.desc)}</p><div class="detail-meta"><strong>今天就吃这个</strong><button class="favorite-toggle ${dish.favorite ? 'active' : ''}" data-action="toggle-favorite" aria-pressed="${dish.favorite}" aria-label="${dish.favorite ? '取消收藏' : '收藏'}${escapeAttr(dish.name)}">${icons.heart}<span>${dish.favorite ? '已收藏' : '收藏'}</span></button></div>${ingredientList}${recipe}<fieldset><legend>选择规格 <em>必选</em></legend><div class="option-list">${dish.options.map((option, index) => `<label><input type="radio" name="option" value="${escapeAttr(option)}" ${state.selectedOption === option || (!state.selectedOption && index === 0) ? 'checked' : ''}><span>${escapeHtml(option)}</span></label>`).join('')}</div></fieldset><label class="note-label" for="dish-note">口味备注 <span>选填</span></label><textarea id="dish-note" maxlength="50" placeholder="例如：不要香菜、少盐">${escapeHtml(state.note)}</textarea><button class="primary-button" data-action="confirm-add">${state.picks.some((item) => item.dishId === dish.id) ? '更新选择' : '就点这道菜'}</button></section></main>`
}

function openImagePreview(src, alt, returnSelector = '[data-action="preview-image"]') {
  state.imagePreviewSrc = src
  state.imagePreviewAlt = alt
  state.imagePreviewReturnSelector = returnSelector
  state.imagePreviewOpen = true
  previewScrollY = window.scrollY
  render()
}

function imagePreview() {
  if (!state.imagePreviewOpen || !state.imagePreviewSrc) return ''
  return `<div class="image-lightbox" role="dialog" aria-modal="true" aria-label="${escapeAttr(state.imagePreviewAlt)}图片预览" data-action="close-image-preview"><button class="image-lightbox-close" data-action="close-image-preview" aria-label="关闭图片预览">${icons.close}</button><img src="${escapeAttr(state.imagePreviewSrc)}" alt="${escapeAttr(state.imagePreviewAlt)}的大图" data-lightbox-image><button class="image-lightbox-reset" data-action="reset-lightbox-zoom" hidden aria-label="还原缩放">${icons.zoom}<span>还原</span></button></div>`
}

function closeImagePreview() {
  state.imagePreviewOpen = false
  const returnSelector = state.imagePreviewReturnSelector
  state.imagePreviewSrc = ''
  state.imagePreviewAlt = ''
  state.imagePreviewReturnSelector = null
  resetLightboxZoom()
  render()
  document.querySelector(returnSelector || '[data-action="preview-image"]')?.focus()
  if (previewScrollY > 0) restoreScroll(previewScrollY)
}

// —— 图片预览缩放（捏合 / 拖动 / 双击），保证各平台（含 Android WebView、微信内置浏览器）行为一致 ——
const lightboxGesture = { scale: 1, tx: 0, ty: 0, mode: 'none', pointers: new Map(), startX: 0, startY: 0, startTx: 0, startTy: 0, startDist: 0, startScale: 1, moved: false, suppressClick: false, lastTap: 0, lastTapX: 0, lastTapY: 0 }
const LIGHTBOX_MAX_SCALE = 4

function lightboxImageEl() {
  return document.querySelector('.image-lightbox img[data-lightbox-image]')
}

function applyLightboxTransform(gesturing = false) {
  const img = lightboxImageEl()
  if (!img) return
  const g = lightboxGesture
  img.classList.toggle('gesturing', gesturing)
  if (g.scale <= 1.001 && g.tx === 0 && g.ty === 0) {
    img.style.transform = ''
    img.classList.remove('zoomed', 'grabbing')
  } else {
    img.style.transform = `translate3d(${g.tx}px, ${g.ty}px, 0) scale(${g.scale})`
    img.classList.add('zoomed')
  }
  const resetBtn = document.querySelector('.image-lightbox-reset')
  if (resetBtn) resetBtn.hidden = g.scale <= 1.001 && g.tx === 0 && g.ty === 0
}

function resetLightboxZoom() {
  const g = lightboxGesture
  g.scale = 1
  g.tx = 0
  g.ty = 0
  g.mode = 'none'
  g.pointers.clear()
  g.suppressClick = false
  applyLightboxTransform()
}

function clampLightboxTransform() {
  const g = lightboxGesture
  if (g.scale <= 1) { g.scale = 1; g.tx = 0; g.ty = 0; return }
  const img = lightboxImageEl()
  if (!img) return
  const rect = img.getBoundingClientRect()
  const baseW = rect.width / g.scale
  const baseH = rect.height / g.scale
  const maxTx = Math.max(0, (baseW * g.scale - window.innerWidth) / 2)
  const maxTy = Math.max(0, (baseH * g.scale - window.innerHeight) / 2)
  g.tx = Math.min(maxTx, Math.max(-maxTx, g.tx))
  g.ty = Math.min(maxTy, Math.max(-maxTy, g.ty))
}

function onLightboxPointerDown(event) {
  if (!state.imagePreviewOpen) return
  if (!event.target.closest('.image-lightbox')) return
  if (event.target.closest('.image-lightbox-close, .image-lightbox-reset')) return
  const lightbox = event.target.closest('.image-lightbox')
  const g = lightboxGesture
  try { lightbox.setPointerCapture(event.pointerId) } catch { /* 部分浏览器不支持 */ }
  g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (g.pointers.size === 1) {
    g.mode = 'drag'
    g.startX = event.clientX
    g.startY = event.clientY
    g.startTx = g.tx
    g.startTy = g.ty
    g.moved = false
    if (g.scale > 1) lightboxImageEl()?.classList.add('grabbing')
  } else if (g.pointers.size === 2) {
    g.mode = 'pinch'
    const [p1, p2] = [...g.pointers.values()]
    g.startDist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1
    g.startScale = g.scale
    g.startTx = g.tx
    g.startTy = g.ty
    lightboxImageEl()?.classList.remove('grabbing')
  }
}

function onLightboxPointerMove(event) {
  const g = lightboxGesture
  if (!g.pointers.has(event.pointerId)) return
  event.preventDefault()
  const prev = g.pointers.get(event.pointerId)
  if (Math.abs(event.clientX - prev.x) > 2 || Math.abs(event.clientY - prev.y) > 2) g.moved = true
  g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (g.mode === 'pinch' && g.pointers.size === 2) {
    const [p1, p2] = [...g.pointers.values()]
    const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1
    const ratio = dist / g.startDist
    const nextScale = Math.min(LIGHTBOX_MAX_SCALE, Math.max(1, g.startScale * ratio))
    const scaleRatio = nextScale / g.scale
    g.scale = nextScale
    g.tx = g.tx * scaleRatio
    g.ty = g.ty * scaleRatio
    applyLightboxTransform(true)
  } else if (g.mode === 'drag' && g.scale > 1) {
    g.tx = g.startTx + (event.clientX - g.startX)
    g.ty = g.startTy + (event.clientY - g.startY)
    applyLightboxTransform(true)
  }
}

function onLightboxPointerUp(event) {
  const g = lightboxGesture
  if (!g.pointers.has(event.pointerId)) return
  g.pointers.delete(event.pointerId)
  if (g.pointers.size === 1) {
    const [p] = [...g.pointers.values()]
    g.mode = 'drag'
    g.startX = p.x
    g.startY = p.y
    g.startTx = g.tx
    g.startTy = g.ty
  } else if (g.pointers.size === 0) {
    if (g.mode === 'pinch' && g.moved) g.suppressClick = true
    g.mode = 'none'
  }
  clampLightboxTransform()
  applyLightboxTransform()
}

function onLightboxImageClick(event) {
  if (!state.imagePreviewOpen) return
  if (!event.target.closest('.image-lightbox img')) return
  const g = lightboxGesture
  const now = Date.now()
  const dt = now - g.lastTap
  const dist = Math.hypot(event.clientX - g.lastTapX, event.clientY - g.lastTapY)
  g.lastTap = now
  g.lastTapX = event.clientX
  g.lastTapY = event.clientY
  if (dt > 0 && dt < 300 && dist < 40) {
    g.lastTap = 0
    if (g.scale > 1.01) {
      resetLightboxZoom()
    } else {
      g.scale = 2.5
      g.tx = 0
      g.ty = 0
      clampLightboxTransform()
      applyLightboxTransform()
    }
  }
}

function pickedContent(desktop = false) {
  if (!state.picks.length) return `<div class="empty cart-empty"><span class="empty-icon">${icons.list}</span><b>还没有点菜</b><span>从菜单里挑几道想吃的吧</span></div>`
  return `<ul class="cart-items">${state.picks.map((item, index) => `<li class="cart-item"><button class="cart-item-main" data-dish="${item.dishId}" aria-label="查看${escapeAttr(item.name)}详情"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.option)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></span><i aria-hidden="true">›</i></button><button class="remove-item" data-action="remove-pick" data-index="${index}" aria-label="移除${escapeAttr(item.name)}">移除</button></li>`).join('')}</ul>`
}

function pickedView() {
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>已点菜单</h1><span></span></header><section class="cart-page">${pickedContent()}</section></main>`
}

function ordersView() {
  const hasPicks = state.picks.length > 0
  const currentMessageBlock = hasPicks
    ? `<button type="button" class="order-message-preview" data-action="messages">${icons.message}<span><b>这单留言</b><em>${currentMessageText()}</em></span></button>`
    : ''
  const currentBlock = hasPicks
    ? `<section class="cart-page history-menu">${pickedContent()}${currentMessageBlock}</section>`
    : `<div class="empty full-empty"><span class="empty-icon">${icons.receipt}</span><b>还没有点菜</b><span>在首页选好想吃的菜，这里会记录结果</span><button class="secondary-button" data-action="menu">去点菜</button></div>`
  const headerAction = hasPicks
    ? `<span class="header-actions"><button type="button" class="icon-button" data-action="toggle-orders-menu" aria-label="更多操作" aria-haspopup="menu" aria-expanded="${state.ordersMenuOpen}">${icons.moreHorizontal}</button><button type="button" class="end-order-btn" data-action="end-order">结束点单</button></span>`
    : '<span></span>'
  const ordersMenu = state.ordersMenuOpen && hasPicks
    ? `<div class="more-menu-dropdown" role="menu" aria-label="已点菜单操作"><button type="button" class="more-menu-item" data-action="clear" role="menuitem">${icons.trash}<span>清空已点菜单</span></button></div><button type="button" class="more-menu-backdrop" data-action="close-orders-menu" aria-label="关闭菜单"></button>`
    : ''
  return `<main class="subpage"><header class="subpage-header"><span></span><h1>当前点单</h1>${headerAction}</header>${ordersMenu}${currentBlock}${bottomBar()}</main>`
}

function orderHistoryCard(order) {
  const items = order.items.map((item) => `<li><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.option)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</span></li>`).join('')
  const message = order.message ? splitMessageContent(order.message) : ''
  const messageBlock = message
    ? `<div class="order-history-message">${icons.message}<p>${escapeHtml(message)}</p></div>`
    : ''
  return `<article class="order-history-card">
    <div class="order-history-head"><time>${formatMessageTime(order.createdAt)}</time></div>
    <ul class="order-history-items">${items || '<li class="order-history-empty">无菜品记录</li>'}</ul>
    ${messageBlock}
    <button class="secondary-button repeat-order-btn" data-action="repeat-order" data-order-id="${order.id}">再来一单</button>
  </article>`
}

function groupOrderHistory() {
  const groups = []
  for (const order of state.orderHistory) {
    const day = dayKey(order.createdAt)
    let group = groups.find((item) => item.day === day)
    if (!group) {
      group = { day, orders: [] }
      groups.push(group)
    }
    group.orders.push(order)
  }
  return groups.map((group) => `<section class="order-day-group" aria-label="${dayLabel(group.orders[0].createdAt)}的点餐记录"><h2>${dayLabel(group.orders[0].createdAt)}</h2>${group.orders.map(orderHistoryCard).join('')}</section>`).join('')
}

function historyView() {
  const content = state.orderHistoryStatus === 'loading'
    ? '<div class="empty" role="status"><b>正在加载记录</b><span>正在读取过去的点餐记录</span></div>'
    : state.orderHistoryStatus === 'error'
      ? '<div class="empty" role="alert"><b>记录加载失败</b><span>无法连接服务器，请检查网络后重试</span><button class="secondary-button" data-action="retry-history">重新加载</button></div>'
      : state.orderHistory.length
        ? groupOrderHistory()
        : `<div class="empty full-empty"><span class="empty-icon">${icons.receipt}</span><b>还没有点餐记录</b><span>点单结束后，这里会按日期保存每一单</span><button class="secondary-button" data-action="menu">去点菜</button></div>`
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回">${icons.back}</button><h1>点餐记录</h1><span></span></header><section class="history-page">${content}</section>${bottomBar()}</main>`
}

function favoritesView() {
  const favorites = dishes.filter((dish) => dish.favorite)
  const content = favorites.length
    ? `<section class="favorites-page" aria-label="收藏的菜品"><div class="section-title"><div><p class="eyebrow">我的收藏</p><h2>收藏的菜</h2></div><span>${favorites.length} 道菜</span></div><div class="dish-grid">${favorites.map(dishCard).join('')}</div><p class="favorites-hint">点开菜品可在详情页取消收藏</p></section>`
    : `<div class="empty full-empty"><span class="empty-icon">${icons.heart}</span><b>还没有收藏</b><span>点开喜欢的菜品，在详情页点「收藏」即可加入这里</span><button class="secondary-button" data-action="menu">去逛逛</button></div>`
  return `<main class="subpage"><header class="subpage-header"><span></span><h1>收藏的菜</h1><span></span></header>${content}${bottomBar()}</main>`
}

function formatMessageTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDiff = Math.round((todayStart - dayStart) / 86400000)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (dayDiff === 0) return `今天 ${time}`
  if (dayDiff === 1) return `昨天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function dayKey(value) {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayDiff = Math.round((todayStart - dayStart) / 86400000)
  if (dayDiff === 0) return '今天'
  if (dayDiff === 1) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function currentMessage() {
  // 留言只跟随当前这单；没有进行中的订单则没有活动留言
  if (!state.currentOrderId) return null
  return messages.find((m) => m.orderId === state.currentOrderId) || null
}

function historyGroups() {
  const current = currentMessage()
  const byDay = new Map()
  for (const m of messages) {
    if (current && m.id === current.id) continue
    // 空占位留言（下单自动创建但未填写内容）不进入历史
    if (!splitMessageContent(m.content)) continue
    const key = dayKey(m.order?.createdAt || m.createdAt)
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(m)
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, list]) => ({ day, messages: list }))
}

function rawPicksText() {
  return state.picks.map((item) => {
    const detail = [item.option, item.note].filter(Boolean).join('，')
    return item.name + (detail ? `（${detail}）` : '')
  }).join('、')
}

function picksItems() {
  return escapeHtml(rawPicksText())
}

// —— 已点菜单项左滑显示“移除”按钮（仅触屏） ——
const CART_ACTION_WIDTH = 72
const cartSwipeGesture = { active: false, item: null, main: null, startX: 0, startY: 0, startOffset: 0, swiping: false, suppressClick: false }

function closeCartSwipe(except) {
  document.querySelectorAll('.cart-item.swiped').forEach((item) => {
    if (item !== except) item.classList.remove('swiped')
  })
}

function onCartPointerDown(event) {
  if (event.pointerType === 'mouse') return
  if (state.imagePreviewOpen) return
  if (event.target.closest('.remove-item')) return
  const item = event.target.closest('.cart-item')
  closeCartSwipe(item)
  if (!item) return
  const wasSwiped = item.classList.contains('swiped')
  cartSwipeGesture.active = true
  cartSwipeGesture.item = item
  cartSwipeGesture.main = item.querySelector('.cart-item-main')
  cartSwipeGesture.startX = event.clientX
  cartSwipeGesture.startY = event.clientY
  cartSwipeGesture.startOffset = wasSwiped ? -CART_ACTION_WIDTH : 0
  cartSwipeGesture.swiping = false
  cartSwipeGesture.suppressClick = false
  if (wasSwiped) {
    item.classList.remove('swiped')
    cartSwipeGesture.suppressClick = true
  }
  try { item.setPointerCapture(event.pointerId) } catch { /* 部分浏览器不支持 */ }
}

function onCartPointerMove(event) {
  const g = cartSwipeGesture
  if (!g.active || !g.item || !g.main) return
  const dx = event.clientX - g.startX
  const dy = event.clientY - g.startY
  if (!g.swiping) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    if (Math.abs(dx) > Math.abs(dy)) {
      g.swiping = true
      g.suppressClick = true
      g.item.classList.add('swiping')
    } else {
      g.active = false
      g.item = null
      g.main = null
      return
    }
  }
  const next = Math.max(-CART_ACTION_WIDTH - 20, Math.min(0, g.startOffset + dx))
  g.main.style.transform = `translateX(${next}px)`
}

function onCartPointerUp(event) {
  const g = cartSwipeGesture
  if (!g.active) return
  const { item, main, swiping, startOffset, startX } = g
  g.active = false
  g.item = null
  g.main = null
  if (!item || !main || !swiping) {
    // 纯点击（例如收起已滑开的条目）：保留 suppressClick，让它吞掉随后的 click
    return
  }
  // 真正发生了滑动：浏览器不会产生 click，必须清掉标志，否则会“吞掉”下一次点击
  cartSwipeGesture.suppressClick = false
  item.classList.remove('swiping')
  main.style.transform = ''
  // pointercancel（如系统接管竖向滚动）时坐标被重置为 0，不能用于计算滑动结果
  if (event.type === 'pointercancel') return
  const total = startOffset + (event.clientX - startX)
  item.classList.toggle('swiped', total < -CART_ACTION_WIDTH / 2)
  closeCartSwipe(item)
}

function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
}

let messageSaving = false

// 每个新订单都会有一条专属留言：没有则创建空占位，有了则沿用（迁移到新订单）
async function ensureMessageForOrder(orderId) {
  if (!orderId) return null
  const existing = messages.find((m) => m.orderId === orderId)
  if (existing) return existing
  const message = await apiRequest('/api/messages', { method: 'POST', body: JSON.stringify({ content: '', orderId }) })
  // 同步本地状态：剔除同一订单的旧留言（服务端已保证每单一条）
  if (message?.id) messages = messages.filter((m) => m.id !== message.id && m.orderId !== orderId).concat(message)
  return message || null
}

// 订单快照变化时，把旧订单的留言迁移到新订单；没有旧留言则初始化空占位
async function moveMessageToOrder(orderId) {
  if (!orderId) return
  const previous = currentMessage()
  if (previous) {
    const updated = await apiRequest(`/api/messages/${previous.id}`, { method: 'PUT', body: JSON.stringify({ content: previous.content, orderId }) })
    // 同步本地状态：剔除同一订单的旧留言（服务端已保证每单一条）
    if (updated?.id) messages = messages.filter((m) => m.id !== updated.id && m.orderId !== orderId).concat(updated)
  } else {
    await ensureMessageForOrder(orderId)
  }
}

async function saveMessage(rawOverride) {
  if (messageSaving) return
  const input = document.querySelector('#message-input')
  const raw = rawOverride !== undefined ? rawOverride : (input?.value ?? '')
  const text = raw.trim()
  // 自动附上当前这单所点的菜（若有点餐），并限制长度
  const picksPrefix = state.picks.length
    ? `今天想吃：${state.picks.map((item) => {
      const detail = [item.option, item.note].filter(Boolean).join('，')
      return item.name + (detail ? `（${detail}）` : '')
    }).join('、')}`
    : ''
  let content = picksPrefix ? (text ? `${picksPrefix}\n${text}` : picksPrefix) : text
  if (content.length > 500) {
    if (picksPrefix) {
      const remaining = 500 - picksPrefix.length - 1
      content = remaining > 0 ? `${picksPrefix}\n${text.slice(0, remaining)}` : picksPrefix.slice(0, 500)
    } else {
      content = text.slice(0, 500)
    }
  }
  const existing = currentMessage()
  if (content === (existing?.content || '')) {
    state.editingMessage = false
    state.messageDraft = ''
    render()
    return
  }
  messageSaving = true
  try {
    if (!content) {
      if (existing) {
        await apiRequest(`/api/messages/${existing.id}`, { method: 'DELETE' })
        messages = messages.filter((m) => m.id !== existing.id)
      }
    } else {
      const message = existing
        ? await apiRequest(`/api/messages/${existing.id}`, { method: 'PUT', body: JSON.stringify({ content, orderId: state.currentOrderId ?? null }) })
        : await apiRequest('/api/messages', { method: 'POST', body: JSON.stringify({ content, orderId: state.currentOrderId ?? null }) })
      // 关联订单时剔除同一订单的其他旧留言，保持本地状态与服务端一致
      messages = messages.filter((m) => m.id !== message.id && (message.orderId === null || m.orderId !== message.orderId)).concat(message)
    }
    messagesStatus = 'ready'
    if (rawOverride !== undefined) {
      // 一次性保存（例如结束点单时没有编辑器），直接完成
      state.editingMessage = false
      state.messageDraft = ''
      render()
      showToast('留言已随本单保存')
      return
    }
    const liveDraft = document.querySelector('#message-input')?.value ?? ''
    if (liveDraft === raw) {
      state.editingMessage = false
      state.messageDraft = ''
      render()
      window.requestAnimationFrame(() => document.querySelector('.note-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      showToast('已保存')
    } else {
      state.messageDraft = liveDraft
      render()
    }
  } catch {
    showToast('保存失败，请检查网络后重试')
  } finally {
    messageSaving = false
  }
}

function splitMessageContent(full) {
  // 从已保存的留言里取出纯留言部分（去掉开头的“今天想吃：…”行）
  if (!full.startsWith('今天想吃：')) return full
  const newline = full.indexOf('\n')
  return newline === -1 ? '' : full.slice(newline + 1)
}

function timeOnly(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function buildMessageDraft() {
  // 编辑时把当前这单已保存的留言放进编辑器
  const msg = currentMessage()
  return msg ? splitMessageContent(msg.content) : ''
}

function currentMessageText() {
  // 当前这单留言的纯文本预览（无留言时给提示）
  const msg = currentMessage()
  if (!msg) return '点击写下这单想说的话…'
  const text = splitMessageContent(msg.content)
  return text || '点击写下这单想说的话…'
}

function todayMessagePreview() {
  // 查看态：展示当前这单已保存的留言
  const msg = currentMessage()
  if (!msg) return '<span class="today-empty">点击写下这单想说的话…</span>'
  const text = splitMessageContent(msg.content)
  return text ? `<p>${escapeHtml(text)}</p>` : '<span class="today-empty">点击写下这单想说的话…</span>'
}

function todayMessagesUpdated() {
  const msg = currentMessage()
  if (!msg) return ''
  return `更新于 ${formatMessageTime(msg.updatedAt || msg.createdAt)}`
}

function noteCard() {
  const isEditing = state.editingMessage
  const picksText = state.picks.length ? rawPicksText() : ''
  const picks = picksText ? `<p class="note-picks"><b>今天想吃：</b>${escapeHtml(picksText)}</p>` : ''
  const updated = !isEditing ? `<span class="note-updated">${todayMessagesUpdated()}</span>` : ''
  const body = isEditing
    ? `<div class="message-edit-wrap"><textarea id="message-input" maxlength="2000" rows="12" aria-label="留言内容" placeholder="写下这单想说的话…">${escapeHtml(state.messageDraft)}</textarea></div>`
    : `<button class="today-text" data-action="edit-message" aria-label="点击写下或修改留言">${todayMessagePreview()}</button>${updated}`
  return `<section class="note-card${isEditing ? ' is-editing' : ''}"><p class="note-card-eyebrow">这单留言</p>${picks}<div class="note-message">${body}</div></section>`
}

function historyItem(message) {
  const order = message.order
  const when = order?.createdAt || message.createdAt
  const updated = message.updatedAt && message.updatedAt !== message.createdAt
    ? ` · 更新 ${timeOnly(message.updatedAt)}`
    : ''
  const dishes = order?.dishes
    ? `<small class="history-dishes">${escapeHtml(order.dishes)}</small>`
    : ''
  const orderLabel = order
    ? `<span class="history-order-label">本单 · ${timeOnly(order.createdAt)}</span>`
    : ''
  return `<li class="history-item order-message-item"><time datetime="${escapeAttr(when)}">${dayLabel(when)}${updated}</time><div class="history-message-body">${orderLabel}${dishes}<p>${escapeHtml(splitMessageContent(message.content))}</p></div></li>`
}

function messageHistoryView() {
  const groups = historyGroups()
  const content = groups.length
    ? groups.map((group) => `<section class="order-day-group" aria-label="${dayLabel(group.day)}的留言"><h2>${dayLabel(group.day)}</h2><ul class="history-list">${group.messages.map(historyItem).join('')}</ul></section>`).join('')
    : `<div class="empty full-empty"><span class="empty-icon">${icons.message}</span><b>还没有留言历史</b><span>每单的留言会随订单保存在这里</span><button class="secondary-button" data-action="messages">去留言</button></div>`
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回">${icons.back}</button><h1>留言历史</h1><span></span></header><section class="history-page">${content}</section>${bottomBar()}</main>`
}

function messagesView() {
  const content = messagesStatus === 'loading'
    ? '<div class="empty" role="status"><b>正在加载</b><span>正在从服务器读取留言</span></div>'
    : messagesStatus === 'error'
      ? '<div class="empty" role="alert"><b>留言加载失败</b><span>无法连接服务器，请检查网络后重试</span><button class="secondary-button" data-action="retry-messages">重新加载</button></div>'
      : noteCard()
  const headerAction = state.editingMessage
    ? `<span class="header-action"><button type="button" class="message-save-btn" data-action="save-message" aria-label="保存留言"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg></button></span>`
    : '<span class="header-action"></span>'
  const editing = state.editingMessage ? ' editing' : ''
  return `<main class="subpage messages-page"><header class="subpage-header"><span></span><h1>留言板</h1>${headerAction}</header><section class="messages-content${editing}" aria-label="留言板">${content}</section>${bottomBar()}</main>`
}

function profileView() {
  const favoriteCount = dishes.filter((dish) => dish.favorite).length
  return `<main class="subpage"><header class="subpage-header"><span></span><h1>我的</h1><span></span></header>
    <section class="profile-page" aria-label="个人中心">
      <div class="profile-card"><div class="profile-avatar">${icons.user}</div><div><b>乐梵小灶</b><span>和家人一起点今天想吃的菜</span></div></div>
      <div class="profile-stats">
        <div><b>${dishes.length}</b><span>菜单菜品</span></div>
        <div><b>${favoriteCount}</b><span>收藏菜品</span></div>
        <div><b>${pickCount()}</b><span>已点菜品</span></div>
      </div>
      <div class="profile-actions">
        <button class="profile-action" data-action="favorites">${icons.heart}<span>我的收藏</span></button>
        <button class="profile-action" data-action="history">${icons.list}<span>点餐记录</span></button>
        <button class="profile-action" data-action="message-history">${icons.message}<span>留言历史</span></button>
      </div>
    </section>${bottomBar()}</main>`
}

function ingredientRow(ingredient = {}, key) {
  const idKey = key || Math.random().toString(36).slice(2, 8)
  return `<div class="ingredient-row" data-ingredient-row>
    <label class="sr-only" for="ing-name-${idKey}">食材</label><input id="ing-name-${idKey}" name="ingredientName" maxlength="100" placeholder="食材（选填）" value="${escapeAttr(ingredient.name || '')}">
    <label class="sr-only" for="ing-amount-${idKey}">用量</label><input id="ing-amount-${idKey}" name="ingredientAmount" maxlength="100" placeholder="用量（选填）" value="${escapeAttr(ingredient.amount || '')}">
    <button class="ingredient-remove" type="button" data-action="remove-ingredient" aria-label="删除这条用料">${icons.close}</button>
  </div>`
}

function optionRow(option = '', key) {
  const idKey = key || Math.random().toString(36).slice(2, 8)
  return `<div class="option-row" data-option-row>
    <label class="sr-only" for="dish-option-${idKey}">规格名称</label>
    <input id="dish-option-${idKey}" name="dishOption" maxlength="100" placeholder="例如：小份、微辣、双人份" value="${escapeAttr(option)}">
    <button class="option-remove" type="button" data-action="remove-option" aria-label="删除规格${option ? ` ${escapeAttr(option)}` : ''}">${icons.close}</button>
  </div>`
}

function updateOptionState() {
  const rows = [...document.querySelectorAll('[data-option-row]')]
  const count = document.querySelector('[data-option-count]')
  const addButton = document.querySelector('[data-action="add-option"]')
  if (count) count.textContent = `${rows.length}/6`
  if (addButton) addButton.disabled = rows.length >= 6
  rows.forEach((row, index) => row.querySelector('.option-remove')?.setAttribute('aria-label', `删除规格 ${index + 1}`))
}

function setCategoryDropdownOpen(open, { focusOption = false } = {}) {
  const dropdown = document.querySelector('.category-select-wrap')
  const trigger = document.querySelector('#dish-form-category')
  const listbox = document.querySelector('#dish-category-options')
  if (!dropdown || !trigger || !listbox) return
  dropdown.classList.toggle('is-open', open)
  trigger.setAttribute('aria-expanded', String(open))
  listbox.setAttribute('aria-hidden', String(!open))
  if (open && focusOption) {
    const selected = listbox.querySelector('[aria-selected="true"]')
    ;(selected || listbox.querySelector('[role="option"]'))?.focus()
  }
}

function selectDishCategory(value, label) {
  const input = document.querySelector('input[name="categoryPreset"]')
  const trigger = document.querySelector('#dish-form-category')
  const customField = document.querySelector('.custom-category-field')
  const customInput = document.querySelector('#dish-form-custom-category')
  if (!input || !trigger || !customField || !customInput) return
  input.value = value
  trigger.querySelector('[data-category-label]').textContent = label
  trigger.classList.remove('is-placeholder')
  document.querySelectorAll('#dish-category-options [role="option"]').forEach((option) => {
    option.setAttribute('aria-selected', String(option.dataset.value === value))
  })
  const isCustom = value === '__custom__'
  customField.hidden = !isCustom
  customInput.required = isCustom
  setCategoryDropdownOpen(false)
  saveFormDraft()
  if (isCustom) customInput.focus()
  else trigger.focus()
}

function stepRow(step = {}, key) {
  const normalizedStep = typeof step === 'string' ? { instruction: step, image: null } : step
  const hasDraftFile = Boolean(normalizedStep.hasDraftFile)
  const idKey = key || Math.random().toString(36).slice(2, 8)
  const hasImage = Boolean(normalizedStep.image)
  return `<div class="step-row" data-step-row data-image="${escapeAttr(hasDraftFile ? '' : (normalizedStep.image || ''))}" data-draft-file="${hasDraftFile ? 'true' : ''}">
    <div class="step-row-heading"><span data-step-number data-step-index="${Number(key) + 1 || 1}">步骤 ${Number(key) + 1 || 1}</span><button class="step-remove" type="button" data-action="remove-step" aria-label="删除这个制作步骤">${icons.trash}</button></div>
    <label class="sr-only" for="step-instruction-${idKey}">步骤说明</label><textarea id="step-instruction-${idKey}" name="stepInstruction" maxlength="1000" placeholder="填写这一步的做法（选填）">${escapeHtml(normalizedStep.instruction || '')}</textarea>
    <input id="step-image-${idKey}" class="upload-input step-image-input" name="stepImage" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
    <label class="step-image-upload ${hasImage ? 'has-image' : ''}" for="step-image-${idKey}">
      <span class="step-image-preview">${hasImage ? `<img src="${escapeAttr(normalizedStep.image)}" alt="当前步骤图片">` : `${icons.upload}<span>添加图片 <small>选填</small></span>`}</span>
    </label>
    ${hasImage ? '<button class="step-image-clear" type="button" data-action="clear-step-image">移除图片</button>' : ''}
  </div>`
}

function updateStepNumbers() {
  document.querySelectorAll('[data-step-row]').forEach((row, index) => {
    const number = row.querySelector('[data-step-number]')
    if (number) {
      number.textContent = `步骤 ${index + 1}`
      number.dataset.stepIndex = index + 1
    }
    row.querySelector('.step-remove')?.setAttribute('aria-label', `删除步骤 ${index + 1}`)
  })
}

function dishFormView() {
  const dish = state.editingDish
  const editing = Boolean(dish)
  const draft = getFormDraft(dish)
  revokeDraftUrls()
  const categoryOptions = [...new Set(['招牌推荐', '热菜', '凉菜', '主食', '汤品', '饮品', '甜品', ...dishes.map((dish) => dish.category)].filter(Boolean))]
  const draftCoverFile = draft?.imageFile || null
  const hasExistingCover = Boolean(dish?.image && dish.image !== '/icons/icon.svg' && !draft?.coverRemoved)
  if (draftCoverFile) draftCoverUrl = URL.createObjectURL(draftCoverFile)
  const hasCover = Boolean(draftCoverFile || hasExistingCover)
  const coverSrc = draftCoverFile ? draftCoverUrl : (hasExistingCover ? dish.image : null)
  const coverStatus = draftCoverFile ? '已选择图片' : (hasExistingCover ? '更换封面' : '尚未选择图片')
  const name = draft?.name ?? dish?.name ?? ''
  const desc = draft?.desc ?? dish?.desc ?? ''
  const ingredients = draft ? (draft.ingredients.length ? draft.ingredients : [{}]) : (dish?.ingredients?.length ? dish.ingredients : [{}])
  const options = draft ? (draft.options.filter(Boolean).length ? draft.options : ['标准份']) : (dish?.options?.length ? dish.options : ['标准份'])
  const rawSteps = draft ? (draft.steps.length ? draft.steps : [{}]) : (dish?.steps?.length ? dish.steps : [{}])
  const steps = rawSteps.map((step, index) => {
    if (step.file) {
      const url = URL.createObjectURL(step.file)
      draftStepUrls.push(url)
      return { ...step, image: url, hasDraftFile: true }
    }
    return step
  })
  const selectedCategory = draft?.categoryPreset || dish?.category || ''
  const isCustomCategory = selectedCategory === '__custom__'
  const categoryLabel = isCustomCategory ? '＋ 新增自定义分类' : (selectedCategory ? escapeHtml(selectedCategory) : '请选择分类')
  const customCategory = draft?.customCategory || ''
  return `<main class="subpage form-page"><header class="subpage-header"><button class="icon-button" data-action="close-form" aria-label="${editing ? '返回菜品详情' : '返回菜单'}">${icons.back}</button><h1>${editing ? '编辑菜品' : '新增菜品'}</h1><button class="icon-button form-save-button" type="submit" form="dish-form" aria-label="${editing ? '保存菜品修改' : '保存菜品'}">${icons.send}</button></header>
    <form id="dish-form" class="dish-form" data-mode="${editing ? 'edit' : 'create'}">
      <input id="dish-form-image" class="upload-input" name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-describedby="dish-image-status" aria-required="true">
      <div class="dish-cover-wrap">
        <label class="dish-cover-upload ${hasCover ? 'has-image' : ''}" for="dish-form-image">
          <span id="dish-image-preview" class="dish-image-preview">${hasCover ? `<img src="${escapeAttr(coverSrc)}" alt="当前菜品封面">` : `<span class="dish-cover-placeholder">${icons.upload}<strong>添加菜品封面</strong><small>支持 JPG、PNG、WebP 或 GIF，最大 15MB</small></span>`}</span>
          <span class="dish-cover-change" id="dish-image-status">${icons.upload} ${coverStatus}</span>
        </label>
        ${hasCover ? '<button class="dish-cover-clear" type="button" data-action="clear-cover">移除封面</button>' : ''}
      </div>
      <label class="sr-only" for="dish-form-name">菜品名称</label><input id="dish-form-name" name="name" maxlength="20" required placeholder="菜品名称（必填）" value="${escapeAttr(name)}" autofocus>
      <label class="sr-only" for="dish-form-desc">菜品描述</label><textarea id="dish-form-desc" name="desc" maxlength="60" placeholder="菜品描述：介绍食材、口味或特色（选填）">${escapeHtml(desc)}</textarea>
      <section class="category-section" aria-labelledby="category-heading">
        <div class="form-section-copy"><h2 id="category-heading">菜品分类</h2><p>选择分类后，菜品会自动归入首页对应栏目</p></div>
        <div class="category-select-wrap">
          <input type="hidden" name="categoryPreset" value="${escapeAttr(selectedCategory)}">
          <button id="dish-form-category" class="category-select-trigger ${selectedCategory ? '' : 'is-placeholder'}" type="button" data-action="toggle-category-dropdown" aria-haspopup="listbox" aria-expanded="false" aria-controls="dish-category-options">
            <span data-category-label>${categoryLabel}</span>${icons.chevronDown}
          </button>
          <div id="dish-category-options" class="category-select-options" role="listbox" aria-label="菜品分类" aria-hidden="true">
            ${categoryOptions.map((category) => `<button type="button" role="option" data-action="select-category" data-value="${escapeAttr(category)}" aria-selected="${selectedCategory === category}">${escapeHtml(category)}</button>`).join('')}
            <button class="category-option-custom" type="button" role="option" data-action="select-category" data-value="__custom__" aria-selected="false">＋ 新增自定义分类</button>
          </div>
        </div>
        <div class="custom-category-field" ${isCustomCategory ? '' : 'hidden'}>
          <label for="dish-form-custom-category">自定义分类名称</label>
          <input id="dish-form-custom-category" name="customCategory" maxlength="10" placeholder="最多 10 个字" autocomplete="off" value="${escapeAttr(customCategory)}">
        </div>
      </section>
      <section class="options-section" aria-labelledby="options-heading">
        <div class="form-section-heading"><div><h2 id="options-heading">菜品规格</h2><p>顾客点菜时可选择一项</p></div><div class="form-section-tools"><span data-option-count>${options.length}/6</span><button type="button" data-action="add-option" aria-label="添加菜品规格" ${options.length >= 6 ? 'disabled' : ''}>${icons.plus}</button></div></div>
        <div id="option-list">${options.map((option, index) => optionRow(option, index)).join('')}</div>
      </section>
      <section class="ingredients-section" aria-labelledby="ingredients-heading">
        <div class="form-section-heading"><h2 id="ingredients-heading">用料</h2><button type="button" data-action="add-ingredient" aria-label="添加一条用料">${icons.plus}</button></div>
        <div id="ingredient-list">${ingredients.map((ing, idx) => ingredientRow(ing, idx)).join('')}</div>
      </section>
      <section class="steps-section" aria-labelledby="steps-heading">
        <div class="form-section-heading"><h2 id="steps-heading">制作步骤</h2><button type="button" data-action="add-step" aria-label="添加一个制作步骤">${icons.plus}</button></div>
        <div id="step-list">${steps.map((step, index) => stepRow(step, index)).join('')}</div>
      </section>
    </form></main>`
}

function successModal() {
  if (!state.showSuccessModal) return ''
  return `<div class="modal-overlay" data-action="close-success-modal" role="dialog" aria-modal="true" aria-label="点餐成功"><div class="success-modal"><div class="success-mark">✓</div><p class="eyebrow">今天的菜单定好啦</p><h1>点菜完成</h1><p>都是想吃的，准备一起好好吃饭吧</p><div class="order-ticket"><span>已选菜品 <b>${state.confirmedCount} 道</b></span></div><button class="primary-button" data-action="orders-from-modal">查看今天的菜单</button><button class="secondary-button" data-action="close-success-modal">继续加菜</button></div></div>`
}

function closeSuccessModal() {
  state.showSuccessModal = false
  render()
}

function render() {
  const categoryScrollLeft = document.querySelector('.categories')?.scrollLeft
  const messagesScrollTop = state.view === 'messages' ? window.scrollY : 0
  const views = { menu: menuView, detail: detailView, picks: pickedView, orders: ordersView, dishForm: dishFormView, favorites: favoritesView, profile: profileView, messages: messagesView, history: historyView, messageHistory: messageHistoryView }
  document.querySelector('#app').innerHTML = `${views[state.view]()}${imagePreview()}${successModal()}`
  document.body.classList.toggle('image-preview-open', state.imagePreviewOpen)
  document.body.classList.toggle('modal-open', state.showSuccessModal)
  if (state.view === 'menu' && categoryScrollLeft !== undefined) document.querySelector('.categories').scrollLeft = categoryScrollLeft
  if (state.view === 'messages') restoreScroll(messagesScrollTop)
  if (state.imagePreviewOpen) document.querySelector('.image-lightbox-close')?.focus()
  else if (state.view === 'detail') document.querySelector('.floating-back')?.focus()
}

function showToast(message) {
  const region = document.querySelector('#toast-region'); region.innerHTML = `<div class="toast">${message}</div>`
  window.setTimeout(() => { region.innerHTML = '' }, 2200)
}

function openDish(id) {
  state.selectedDish = dishes.find((dish) => dish.id === Number(id)); const existing = state.picks.find((item) => item.dishId === state.selectedDish.id); state.selectedOption = existing?.option || state.selectedDish.options[0]; state.note = existing?.note || ''; state.moreMenuOpen = false; navigate('detail')
}

function addDish(dish, option = dish.options[0], note = '') {
  const item = { key: String(dish.id), dishId: dish.id, name: dish.name, option, note }
  const index = state.picks.findIndex((pick) => pick.dishId === dish.id)
  if (index >= 0) state.picks[index] = item
  else state.picks.push(item)
  markMenuAsDraft()
}

async function syncOrder() {
  if (!state.picks.length) {
    await apiRequest('/api/orders/current', { method: 'DELETE' })
    state.orderNumber = ''
    state.confirmed = false
    state.confirmedCount = 0
    state.currentOrderId = null
    return
  }
  // 订单号由服务端生成，客户端只提交菜品，避免多设备撞号串单
  const order = { items: state.picks.map((item) => ({ dishId: item.dishId, name: item.name, option: item.option, note: item.note })) }
  const result = await apiRequest('/api/orders', { method: 'POST', body: JSON.stringify(order) })
  const newOrderId = result?.id ?? state.currentOrderId
  if (newOrderId && newOrderId !== state.currentOrderId) {
    try {
      await moveMessageToOrder(newOrderId)
    } catch {
      // 留言迁移失败不阻塞点单
    }
  }
  state.currentOrderId = newOrderId
  state.confirmedCount = pickCount()
  state.confirmed = true
  state.orderNumber = result?.orderNumber || ''
}

document.addEventListener('click', async (event) => {
  if (cartSwipeGesture.suppressClick) { cartSwipeGesture.suppressClick = false; return }
  const button = event.target.closest('button'); if (!button) return
  if (button.dataset.category) { state.category = button.dataset.category; render(); return }
  const action = button.dataset.action
  if (action === 'toggle-category-dropdown') {
    const open = button.getAttribute('aria-expanded') !== 'true'
    setCategoryDropdownOpen(open)
    return
  }
  if (action === 'select-category') {
    selectDishCategory(button.dataset.value, button.textContent.trim())
    return
  }
  if (action === 'preview-image') { if (state.selectedDish?.image) openImagePreview(state.selectedDish.image, `${state.selectedDish.name}图片`, '[data-action="preview-image"]'); return }
  if (action === 'preview-step-image') { const src = button.dataset.imageSrc; if (src) openImagePreview(src, '步骤图片', `[data-step-preview-index="${button.dataset.stepPreviewIndex}"]`); return }
  if (action === 'close-image-preview') { closeImagePreview(); return }
  if (action === 'reset-lightbox-zoom') { resetLightboxZoom(); return }
  if (action === 'toggle-more-menu') { state.moreMenuOpen = !state.moreMenuOpen; render(); return }
  if (action === 'close-more-menu') { state.moreMenuOpen = false; render(); return }
  if (action === 'toggle-orders-menu') { state.ordersMenuOpen = !state.ordersMenuOpen; render(); return }
  if (action === 'close-orders-menu') { state.ordersMenuOpen = false; render(); return }
  if (action === 'add-option') {
    const list = document.querySelector('#option-list')
    if (!list || list.children.length >= 6) { showToast('最多添加 6 个菜品规格'); return }
    const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    list.insertAdjacentHTML('beforeend', optionRow('', key))
    updateOptionState()
    list.lastElementChild.querySelector('input')?.focus()
    saveFormDraft()
    return
  }
  if (action === 'remove-option') {
    const row = button.closest('[data-option-row]')
    if (!row) return
    const list = row.parentElement
    if (list.children.length === 1) {
      row.querySelector('input').value = ''
      row.querySelector('input').focus()
      showToast('至少需要保留一个菜品规格')
    } else {
      row.remove()
      updateOptionState()
    }
    saveFormDraft()
    return
  }
  if (action === 'add-ingredient') {
    const list = document.querySelector('#ingredient-list')
    if (list && list.children.length >= 20) { showToast('最多添加 20 条用料'); return }
    const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    list.insertAdjacentHTML('beforeend', ingredientRow({}, key))
    list.lastElementChild.querySelector('input')?.focus()
    saveFormDraft()
    return
  }
  if (action === 'remove-ingredient') {
    const row = button.closest('[data-ingredient-row]')
    if (!row) return
    const list = row.parentElement
    if (list.children.length === 1) {
      row.querySelectorAll('input').forEach((input) => { input.value = '' })
      row.querySelector('input')?.focus()
    } else {
      row.remove()
    }
    saveFormDraft()
    return
  }
  if (action === 'add-step') {
    const list = document.querySelector('#step-list')
    if (list && list.children.length >= 20) { showToast('最多添加 20 个制作步骤'); return }
    const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    list.insertAdjacentHTML('beforeend', stepRow({}, key))
    updateStepNumbers()
    list.lastElementChild.querySelector('textarea')?.focus()
    saveFormDraft()
    return
  }
  if (action === 'remove-step') {
    const row = button.closest('[data-step-row]')
    if (!row) return
    const list = row.parentElement
    if (list.children.length === 1) {
      row.querySelector('textarea').value = ''
      row.dataset.image = ''
      row.dataset.draftFile = ''
      row.querySelector('.step-image-preview').innerHTML = `${icons.upload}<span>添加图片 <small>选填</small></span>`
      row.querySelector('.step-image-upload').classList.remove('has-image')
      row.querySelector('.step-image-clear')?.remove()
      row.querySelector('textarea')?.focus()
    } else {
      row.remove()
      updateStepNumbers()
    }
    saveFormDraft()
    return
  }
  if (action === 'clear-step-image') {
    const row = button.closest('[data-step-row]')
    row.dataset.image = ''
    row.dataset.draftFile = ''
    row.querySelector('.step-image-input').value = ''
    row.querySelector('.step-image-preview').innerHTML = `${icons.upload}<span>添加图片 <small>选填</small></span>`
    row.querySelector('.step-image-upload').classList.remove('has-image')
    button.remove()
    saveFormDraft()
    return
  }
  if (action === 'clear-cover') {
    const input = document.querySelector('#dish-form-image')
    if (input) input.value = ''
    if (formDraft) formDraft.imageFile = null
    formDraft = { ...(formDraft || {}), coverRemoved: true }
    render()
    saveFormDraft()
    showToast('已移除封面')
    return
  }
  if (action === 'retry-dishes') { await loadDishes(); return }
  if (action === 'retry-messages') { await loadMessages(); return }
  if (action === 'retry-history') { await loadOrderHistory(); return }
  if (action === 'history') {
    await loadOrderHistory()
    navigate('history')
    return
  }
  if (action === 'repeat-order') {
    const id = Number(button.dataset.orderId)
    const order = state.orderHistory.find((item) => item.id === id)
    const items = (order?.items || []).filter((item) => item.dishId).map((item) => ({ ...item, key: String(item.dishId) }))
    if (!order || !items.length) {
      showToast('没有可复制的菜品')
      return
    }
    state.picks = items
    button.disabled = true
    try {
      await syncOrder()
      navigate('menu', { replace: true })
      showToast('已按之前的菜单再点一单')
    } catch {
      button.disabled = false
      showToast('再来一单失败，请检查网络后重试')
    }
    return
  }
  if (action === 'end-order') {
    button.disabled = true
    try {
      // 先保存未完成的留言草稿（若在留言板编辑中切到本页，用草稿保存）
      if (state.editingMessage || state.messageDraft) {
        const input = document.querySelector('#message-input')
        const draft = input ? input.value : state.messageDraft
        if (draft.trim()) await saveMessage(draft)
      }
      const orderId = state.currentOrderId
      if (!orderId) {
        showToast('没有进行中的订单')
        return
      }
      await apiRequest(`/api/orders/${orderId}/complete`, { method: 'PUT' })
      state.picks = []
      state.ordersMenuOpen = false
      state.orderNumber = ''
      state.confirmed = false
      state.confirmedCount = 0
      state.currentOrderId = null
      await loadOrderHistory()
      showToast('点单已结束，已保存到点餐记录')
      navigate('history')
    } catch {
      showToast('结束点单失败，请检查网络后重试')
    }
    return
  }
  if (action === 'save-message') { saveMessage(); return }
  if (action === 'edit-message') {
    if (state.editingMessage && document.querySelector('#message-input')) await saveMessage()
    state.editingMessage = true
    state.messageDraft = buildMessageDraft()
    render()
    window.requestAnimationFrame(() => {
      const input = document.querySelector('#message-input')
      if (input) {
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      }
    })
    return
  }
  if (action === 'message-history') {
    navigate('messageHistory')
    if (messagesStatus !== 'ready') loadMessages({ silent: true })
    return
  }
  if (action === 'edit-dish') { state.moreMenuOpen = false; state.editingDish = state.selectedDish; navigate('dishForm'); return }
  if (action === 'toggle-favorite') {
    const dish = state.selectedDish
    if (!dish) return
    const target = !dish.favorite
    button.disabled = true
    try {
      await apiRequest(`/api/dishes/${dish.id}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite: target }) })
      dish.favorite = target
      render()
      showToast(target ? `已收藏「${dish.name}」` : `已取消收藏「${dish.name}」`)
    } catch {
      button.disabled = false
      showToast('操作失败，请检查网络后重试')
    }
    return
  }
  if (action === 'delete-dish') {
    const dish = state.selectedDish
    state.moreMenuOpen = false
    render()
    if (!window.confirm(`确定删除「${dish.name}」吗？此操作无法撤销。`)) return
    button.disabled = true
    try {
      await apiRequest(`/api/dishes/${dish.id}`, { method: 'DELETE' })
      dishes = dishes.filter((item) => item.id !== dish.id)
      state.picks = state.picks.filter((item) => item.dishId !== dish.id)
      state.selectedDish = null
      state.editingDish = null
      state.category = dishes.some((item) => item.category === state.category) ? state.category : '全部'
      if (!goBack()) navigate('menu', { replace: true })
      showToast(`已删除「${dish.name}」`)
    } catch {
      button.disabled = false
      showToast('删除失败，请检查网络后重试')
    }
    return
  }
  if (button.dataset.dish) {
    const dish = dishes.find((item) => item.id === Number(button.dataset.dish))
    if (button.classList.contains('add-button')) {
      addDish(dish)
      button.disabled = true
      try {
        await syncOrder()
        render()
        showToast(`已经点好「${dish.name}」啦`)
      } catch {
        state.picks = state.picks.filter((item) => item.dishId !== dish.id)
        render()
        showToast('点菜失败，请检查网络后重试')
      }
    } else openDish(button.dataset.dish)
    return
  }
  if (action === 'remove-pick') {
    const index = Number(button.dataset.index)
    const removed = state.picks[index]
    if (!removed) return
    state.picks.splice(index, 1)
    state.ordersMenuOpen = false
    // 乐观更新：先立刻刷新界面，网络同步放后台，失败再回滚
    render()
    showToast(`已移除「${removed.name}」`)
    try {
      await syncOrder()
    } catch {
      if (!state.picks.some((pick) => pick.key === removed.key)) {
        state.picks.splice(Math.min(index, state.picks.length), 0, removed)
        render()
      }
      showToast('移除失败，已恢复，请检查网络后重试')
    }
    return
  }
  if (action === 'close') { goBack() }
  if (action === 'close-success-modal') { closeSuccessModal(); return }
  if (action === 'orders-from-modal') { closeSuccessModal(); state.ordersMenuOpen = false; await loadLatestOrder(); navigate('orders'); return }
  if (action === 'menu') { navigate('menu', { replace: true }) }
  if (action === 'close-form') { state.editingDish = null; goBack() }
  if (action === 'picks') { navigate('picks') }
  if (action === 'orders') { state.ordersMenuOpen = false; await loadLatestOrder(); await loadOrderHistory(); navigate('orders') }
  if (action === 'new-dish') { state.editingDish = null; navigate('dishForm') }
  if (action === 'favorites') { navigate('favorites') }
  if (action === 'messages') {
    await loadMessages({ silent: true })
    navigate('messages')
  }
  if (action === 'profile') { navigate('profile') }
  if (action === 'clear' && window.confirm('确定清空全部已点菜品吗？')) {
    button.disabled = true
    try {
      await apiRequest('/api/orders/current', { method: 'DELETE' })
      state.picks = []
      state.ordersMenuOpen = false
      state.orderNumber = ''
      state.confirmed = false
      state.confirmedCount = 0
      state.currentOrderId = null
      render()
      showToast('已清空菜单')
    } catch {
      button.disabled = false
      showToast('清空失败，请检查网络后重试')
    }
    return
  }
  if (action === 'confirm-add') {
    const dish = state.selectedDish
    const option = document.querySelector('input[name="option"]:checked')?.value || dish.options[0]
    const note = document.querySelector('#dish-note').value.trim()
    const prevIndex = state.picks.findIndex((item) => item.dishId === dish.id)
    const prevPick = prevIndex >= 0 ? state.picks[prevIndex] : null
    addDish(dish, option, note)
    button.disabled = true
    try {
      await syncOrder()
      goBack()
      showToast('已经点好这道菜啦')
    } catch {
      if (prevPick) state.picks[prevIndex] = prevPick
      else state.picks = state.picks.filter((item) => item.dishId !== dish.id)
      button.disabled = false
      showToast('点菜失败，请检查网络后重试')
    }
    return
  }
})

document.addEventListener('click', (event) => {
  if (cartSwipeGesture.suppressClick) { cartSwipeGesture.suppressClick = false; return }
  if (event.target.classList.contains('image-lightbox')) {
    if (lightboxGesture.suppressClick) { lightboxGesture.suppressClick = false; return }
    closeImagePreview()
  }
  if (event.target.closest('.modal-overlay') && !event.target.closest('.success-modal')) closeSuccessModal()
  if (!event.target.closest('.category-select-wrap')) setCategoryDropdownOpen(false)
})

document.addEventListener('pointerdown', onLightboxPointerDown, { passive: false })
document.addEventListener('pointermove', onLightboxPointerMove, { passive: false })
document.addEventListener('pointerup', onLightboxPointerUp, { passive: false })
document.addEventListener('pointercancel', onLightboxPointerUp, { passive: false })
document.addEventListener('click', onLightboxImageClick)
document.addEventListener('pointerdown', onCartPointerDown, { passive: false })
document.addEventListener('pointermove', onCartPointerMove, { passive: false })
document.addEventListener('pointerup', onCartPointerUp, { passive: false })
document.addEventListener('pointercancel', onCartPointerUp, { passive: false })

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.imagePreviewOpen) closeImagePreview()
  if (event.key === 'Escape' && state.ordersMenuOpen) { state.ordersMenuOpen = false; render() }
  if (event.key === 'Escape' && state.showSuccessModal) closeSuccessModal()
  if (event.key === 'Escape' && state.editingMessage) {
    state.messageDraft = buildMessageDraft()
    state.editingMessage = false
    render()
    return
  }
  // 手机端软键盘没有 Shift 键：Enter 用于正常换行，保存交给按钮/失焦触发
  if (event.key === 'Enter' && event.target.id === 'message-input' && !event.shiftKey && !isTouchDevice()) {
    event.preventDefault()
    saveMessage()
    return
  }
  const trigger = event.target.closest('#dish-form-category')
  const option = event.target.closest('#dish-category-options [role="option"]')
  if (trigger && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
    event.preventDefault()
    setCategoryDropdownOpen(true, { focusOption: true })
    return
  }
  if (option) {
    const options = [...option.parentElement.querySelectorAll('[role="option"]')]
    const index = options.indexOf(option)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus()
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      options[event.key === 'Home' ? 0 : options.length - 1].focus()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setCategoryDropdownOpen(false)
      document.querySelector('#dish-form-category')?.focus()
    }
  }
})

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'dish-form') return
  event.preventDefault()
  const editingDish = state.editingDish
  const formData = new FormData(event.target)
  const rawImageFile = formData.get('imageFile')
  const imageFile = rawImageFile?.size ? rawImageFile : (formDraft?.imageFile || null)
  const hasExistingCover = Boolean(editingDish?.image && editingDish.image !== '/icons/icon.svg' && !formDraft?.coverRemoved)
  if (!imageFile?.size && !hasExistingCover) {
    showToast('请添加菜品封面')
    document.querySelector('.dish-cover-upload')?.focus()
    return
  }
  let image = editingDish?.image || '/icons/icon.svg'
  if (imageFile?.size) {
    try {
      image = await uploadDishImage(imageFile)
    } catch (error) {
      showToast(error.message || '图片上传失败，请检查网络后重试')
      return
    }
  }
  const ingredientNames = formData.getAll('ingredientName')
  const ingredientAmounts = formData.getAll('ingredientAmount')
  const ingredients = ingredientNames.map((name, index) => ({
    name: name.trim(),
    amount: (ingredientAmounts[index] || '').trim(),
  })).filter((item) => item.name || item.amount)
  const options = formData.getAll('dishOption').map((option) => option.trim()).filter(Boolean)
  if (!options.length) {
    showToast('请至少填写一个菜品规格')
    event.target.querySelector('[name="dishOption"]')?.focus()
    return
  }
  if (new Set(options).size !== options.length) {
    showToast('菜品规格不能重复')
    const duplicate = options.find((option, index) => options.indexOf(option) !== index)
    ;[...event.target.querySelectorAll('[name="dishOption"]')].find((input) => input.value.trim() === duplicate)?.focus()
    return
  }
  const categoryPreset = formData.get('categoryPreset')
  const category = categoryPreset === '__custom__' ? formData.get('customCategory').trim() : categoryPreset.trim()
  if (!category) {
    showToast(categoryPreset === '__custom__' ? '请填写自定义分类名称' : '请选择菜品分类')
    event.target.querySelector(categoryPreset === '__custom__' ? '#dish-form-custom-category' : '#dish-form-category')?.focus()
    return
  }
  const stepRows = [...event.target.querySelectorAll('[data-step-row]')]
  const steps = []
  for (const [stepIndex, row] of stepRows.entries()) {
    const instruction = row.querySelector('[name="stepInstruction"]').value.trim()
    const draftStepFile = row.dataset.draftFile === 'true' ? formDraft?.steps?.[stepIndex]?.file : null
    const stepImageFile = row.querySelector('[name="stepImage"]').files[0] || draftStepFile || null
    let stepImage = row.dataset.draftFile === 'true' ? null : (row.dataset.image || null)
    if (!instruction && !stepImageFile && !stepImage) continue
    if (stepImageFile) {
      try {
        stepImage = await uploadDishImage(stepImageFile)
      } catch (error) {
        showToast(error.message || '步骤图片上传失败，请检查网络后重试')
        return
      }
    }
    steps.push({ instruction, image: stepImage })
  }
  let dish = {
    category,
    name: formData.get('name').trim(),
    desc: formData.get('desc').trim(),
    sales: 0,
    spicy: editingDish?.spicy || 0,
    image,
    options,
    ingredients,
    steps,
  }
  if (editingDish) {
    try {
      dish = await apiRequest(`/api/dishes/${editingDish.id}`, { method: 'PUT', body: JSON.stringify(dish) })
    } catch {
      showToast('修改失败，请检查网络后重试')
      return
    }
    dishes = dishes.map((item) => item.id === dish.id ? dish : item)
    state.picks = state.picks.map((item) => item.dishId === dish.id ? { ...item, name: dish.name, option: dish.options.includes(item.option) ? item.option : dish.options[0] } : item)
    state.picks = [...new Map(state.picks.map((item) => [item.dishId, { ...item, key: String(item.dishId) }])).values()]
    state.selectedDish = dish
  } else {
    try {
      dish = await apiRequest('/api/dishes', { method: 'POST', body: JSON.stringify(dish) })
    } catch {
      showToast('新增失败，数据未保存，请检查网络后重试')
      return
    }
    dishes.push(dish)
  }
  state.category = dish.category
  state.search = ''
  state.editingDish = null
  clearFormDraft()
  navigate('menu', { replace: true })
  showToast(`${editingDish ? '已更新' : '已新增'}「${dish.name}」`)
})

document.addEventListener('input', (event) => {
  if (event.target.id === 'dish-search') {
    if (shouldSkipSearchRender(event)) return
    state.search = event.target.value
    render()
    return
  }
  if (event.target.id === 'message-input') { state.messageDraft = event.target.value; return }
  if (event.target.closest('#dish-form')) saveFormDraft()
})

document.addEventListener('compositionend', (event) => {
  if (event.target.id !== 'dish-search') return
  state.search = event.target.value
  render()
})

document.addEventListener('focusout', (event) => {
  if (event.target.id === 'message-input' && state.editingMessage) saveMessage()
})

document.addEventListener('change', (event) => {
  if (event.target.classList.contains('step-image-input')) {
    const file = event.target.files[0]
    if (!file) return
    if (file.size > 15 * 1024 * 1024) {
      event.target.value = ''
      showToast('图片不能超过 15MB')
      return
    }
    const row = event.target.closest('[data-step-row]')
    const preview = row.querySelector('.step-image-preview')
    const image = document.createElement('img')
    image.src = URL.createObjectURL(file)
    image.alt = '待上传的步骤图片预览'
    image.addEventListener('load', () => URL.revokeObjectURL(image.src), { once: true })
    preview.replaceChildren(image)
    row.querySelector('.step-image-upload').classList.add('has-image')
    if (!row.querySelector('.step-image-clear')) {
      row.insertAdjacentHTML('beforeend', '<button class="step-image-clear" type="button" data-action="clear-step-image">移除图片</button>')
    }
    saveFormDraft()
    return
  }
  if (event.target.id !== 'dish-form-image') return
  const file = event.target.files[0]
  const preview = document.querySelector('#dish-image-preview')
  const status = document.querySelector('#dish-image-status')
  if (!file) {
    return
  }
  if (file.size > 15 * 1024 * 1024) {
    event.target.value = ''
    showToast('图片不能超过 15MB')
    return
  }
  const image = document.createElement('img')
  image.src = URL.createObjectURL(file)
  image.alt = '待上传的菜品图片预览'
  image.addEventListener('load', () => URL.revokeObjectURL(image.src), { once: true })
  preview.replaceChildren(image)
  preview.closest('.dish-cover-upload').classList.add('has-image')
  if (status) status.textContent = file.name
  if (formDraft) formDraft.coverRemoved = false
  saveFormDraft()
})

registerSW({ onOfflineReady: () => showToast('应用已可离线使用'), onNeedRefresh: () => showToast('发现新版本，将自动更新') })
window.history.replaceState(navigationState(window.scrollY), '')
window.addEventListener('popstate', (event) => {
  const entry = event.state?.app === historyKey ? event.state : navigationState(0)
  restoreNavigationState(entry)
  render()
  restoreScroll(entry.scrollY)
})
App.addListener('backButton', ({ canGoBack }) => {
  if (goBack()) return
  if (canGoBack) window.history.back()
  else App.exitApp()
})
render()
loadDishes()
loadMessages()
loadLatestOrder()
loadOrderHistory()
window.setInterval(() => {
  if (!document.hidden && !isFormView()) {
    loadLatestOrder({ notify: true })
    if (state.view === 'messages' && document.activeElement?.id !== 'message-input') loadMessages({ silent: true })
  }
}, orderRefreshInterval)
window.addEventListener('online', () => {
  if (isFormView()) return
  loadDishes()
  loadLatestOrder({ notify: true })
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !isFormView()) {
    loadDishes()
    loadLatestOrder({ notify: true })
  }
})
