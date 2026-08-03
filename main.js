import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { App } from '@capacitor/app'

let dishes = []
let dishesStatus = 'loading'
const state = {
  category: '全部', search: '', picks: [],
  selectedDish: null, editingDish: null, selectedOption: '', note: '', view: 'menu', orderNumber: '', confirmed: false, confirmedCount: 0, imagePreviewOpen: false, showSuccessModal: false, moreMenuOpen: false,
}

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const orderRefreshInterval = 10000
const historyKey = 'order-app'

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
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`API request failed: ${response.status}`)
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

async function loadLatestOrder({ notify = false, force = false } = {}) {
  if (!force && !state.confirmed) return
  try {
    const order = await apiRequest('/api/orders/latest', { cache: 'no-store' })
    if (!order) {
      if (state.confirmed) {
        state.picks = []
        state.orderNumber = ''
        state.confirmed = false
        state.confirmedCount = 0
        render()
        if (notify) showToast('已同步清空菜单')
      }
      return
    }
    if (!order?.orderNumber || order.orderNumber === state.orderNumber || !Array.isArray(order.items)) return
    state.picks = order.items.map((item) => ({ ...item, key: String(item.dishId) }))
    state.orderNumber = order.orderNumber
    state.confirmed = true
    state.confirmedCount = state.picks.length
    render()
    if (notify) showToast('已同步最新菜单')
  } catch {
    if (notify) showToast('菜单同步失败，请检查网络后重试')
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
  close: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  heart: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21C12 21 3 14 3 8a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-9 13-9 13Z"/></svg>',
  user: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/><path d="M4 22a8 8 0 0 1 16 0"/></svg>',
  more: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
  edit: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  trash: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>',
}

function markMenuAsDraft() {
  state.confirmed = false
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
    <button class="nav-item ${active === 'favorites' ? 'active' : ''}" data-action="favorites">${icons.heart}<span>收藏</span></button>
    <button class="nav-item ${active === 'profile' ? 'active' : ''}" data-action="profile">${icons.user}<span>我的</span></button>
  </nav>`
}

function detailView() {
  const dish = state.selectedDish
  const ingredients = (dish.ingredients || []).filter((ingredient) => ingredient?.name || ingredient?.amount)
  const steps = (dish.steps || []).map((step) => typeof step === 'string' ? { instruction: step, image: null } : step)
  const ingredientList = ingredients.length ? `<section class="detail-ingredients" aria-labelledby="detail-ingredients-heading"><h2 id="detail-ingredients-heading">用料</h2><dl>${ingredients.map((ingredient) => `<div><dt>${escapeHtml(ingredient.name || '')}</dt><dd>${escapeHtml(ingredient.amount || '')}</dd></div>`).join('')}</dl></section>` : ''
  const recipe = steps.length ? `<section class="recipe-section" aria-labelledby="recipe-heading"><h2 id="recipe-heading">制作步骤</h2><ol class="recipe-steps">${steps.map((step) => `<li>${step.image ? `<img src="${escapeAttr(step.image)}" alt="" loading="lazy">` : ''}<div><b>${escapeHtml(step.instruction)}</b></div></li>`).join('')}</ol></section>` : ''
  return `<main class="detail-view"><button class="icon-button floating-back" data-action="close" aria-label="返回菜单">${icons.back}</button><button class="icon-button floating-more" data-action="toggle-more-menu" aria-label="更多操作" aria-expanded="${state.moreMenuOpen}">${icons.more}</button>${state.moreMenuOpen ? `<div class="more-menu-dropdown" role="menu" aria-label="菜品管理"><button class="more-menu-item" data-action="edit-dish" role="menuitem">${icons.edit}<span>编辑菜品</span></button><button class="more-menu-item more-menu-item--danger" data-action="delete-dish" role="menuitem">${icons.trash}<span>删除菜品</span></button></div>` : ''}${state.moreMenuOpen ? '<button class="more-menu-backdrop" data-action="close-more-menu" aria-label="关闭菜单"></button>' : ''}<button class="dish-image-preview-button" data-action="preview-image" aria-label="放大预览${escapeAttr(dish.name)}图片">${imageMarkup(dish, true)}<span class="preview-hint" aria-hidden="true">点击查看大图</span></button><section class="detail-sheet"><p class="eyebrow">${escapeHtml(dish.category)}</p><h1>${escapeHtml(dish.name)}</h1><p class="detail-desc">${escapeHtml(dish.desc)}</p><div class="detail-meta"><strong>今天就吃这个</strong></div>${ingredientList}${recipe}<fieldset><legend>选择规格 <em>必选</em></legend><div class="option-list">${dish.options.map((option, index) => `<label><input type="radio" name="option" value="${escapeAttr(option)}" ${state.selectedOption === option || (!state.selectedOption && index === 0) ? 'checked' : ''}><span>${escapeHtml(option)}</span></label>`).join('')}</div></fieldset><label class="note-label" for="dish-note">口味备注 <span>选填</span></label><textarea id="dish-note" maxlength="50" placeholder="例如：不要香菜、少盐">${escapeHtml(state.note)}</textarea><button class="primary-button" data-action="confirm-add">${state.picks.some((item) => item.dishId === dish.id) ? '更新选择' : '就点这道菜'}</button></section></main>`
}

function imagePreview() {
  if (!state.imagePreviewOpen || !state.selectedDish) return ''
  const dish = state.selectedDish
  return `<div class="image-lightbox" role="dialog" aria-modal="true" aria-label="${escapeAttr(dish.name)}图片预览" data-action="close-image-preview"><button class="image-lightbox-close" data-action="close-image-preview" aria-label="关闭图片预览">${icons.close}</button><img src="${escapeAttr(dish.image)}" alt="${escapeAttr(dish.name)}的大图" data-lightbox-image></div>`
}

function closeImagePreview() {
  state.imagePreviewOpen = false
  render()
  document.querySelector('[data-action="preview-image"]')?.focus()
}

function pickedContent(desktop = false) {
  if (!state.picks.length) return `<div class="cart-heading"><div><p class="eyebrow">今天想吃</p><h2>已点菜单</h2></div></div><div class="empty cart-empty"><span class="empty-icon">${icons.list}</span><b>还没有点菜</b><span>从菜单里挑几道她喜欢的吧</span></div>`
  return `<div class="cart-heading"><div><p class="eyebrow">今天想吃</p><h2>已点菜单</h2></div><button data-action="clear">清空</button></div><div class="cart-items">${state.picks.map((item, index) => `<div class="cart-item"><button class="cart-item-main" data-dish="${item.dishId}" aria-label="查看${escapeAttr(item.name)}详情"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.option)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></span><i aria-hidden="true">›</i></button><button class="remove-item" data-action="remove-pick" data-index="${index}" aria-label="移除${escapeAttr(item.name)}">移除</button></div>`).join('')}</div>${desktop ? '<button class="primary-button" data-action="confirm-menu">确认点菜</button>' : ''}`
}

function pickedView() {
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>确认菜单</h1><span></span></header><section class="cart-page">${pickedContent()}</section>${state.picks.length ? `<footer class="checkout-bar"><span>共选 <strong>${pickCount()} 道菜</strong></span><button class="primary-button" data-action="confirm-menu">确认点菜</button></footer>` : ''}</main>`
}

function ordersView() {
  if (!state.picks.length) return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>今天吃什么</h1><span></span></header><div class="empty full-empty"><span class="empty-icon">${icons.receipt}</span><b>还没有点菜</b><span>选好想吃的菜后，这里会记录结果</span><button class="secondary-button" data-action="menu">去点菜</button></div>${bottomBar()}</main>`
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>今天吃什么</h1><span></span></header><section class="cart-page history-menu"><div class="menu-status"><span class="success-mark success-mark--small">✓</span><div><b>${state.confirmed ? '菜单已经选好啦' : '还差最后确认'}</b><span>一共 ${pickCount()} 道菜，都是今天想吃的</span></div></div>${pickedContent()}</section><div class="history-actions"><button class="secondary-button" data-action="menu">继续点菜</button></div>${bottomBar()}</main>`
}

function favoritesView() {
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>收藏的菜</h1><span></span></header><div class="empty full-empty"><span class="empty-icon">${icons.heart}</span><b>还没有收藏</b><span>点开喜欢的菜品，长按即可收藏</span><button class="secondary-button" data-action="menu">去逛逛</button></div>${bottomBar()}</main>`
}

function profileView() {
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>我的</h1><span></span></header><div class="empty full-empty"><span class="empty-icon">${icons.user}</span><b>个人中心</b><span>账户设置与偏好</span></div>${bottomBar()}</main>`
}

function ingredientRow(ingredient = {}, key) {
  const idKey = key || Math.random().toString(36).slice(2, 8)
  return `<div class="ingredient-row" data-ingredient-row>
    <label class="sr-only" for="ing-name-${idKey}">食材</label><input id="ing-name-${idKey}" name="ingredientName" maxlength="100" placeholder="食材（选填）" value="${escapeAttr(ingredient.name || '')}">
    <label class="sr-only" for="ing-amount-${idKey}">用量</label><input id="ing-amount-${idKey}" name="ingredientAmount" maxlength="100" placeholder="用量（选填）" value="${escapeAttr(ingredient.amount || '')}">
    <button class="ingredient-remove" type="button" data-action="remove-ingredient" aria-label="删除这条用料">${icons.close}</button>
  </div>`
}

function stepRow(step = {}, key) {
  const normalizedStep = typeof step === 'string' ? { instruction: step, image: null } : step
  const idKey = key || Math.random().toString(36).slice(2, 8)
  const hasImage = Boolean(normalizedStep.image)
  return `<div class="step-row" data-step-row data-image="${escapeAttr(normalizedStep.image || '')}">
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
  const categoryOptions = [...new Set(dishes.map((dish) => dish.category))]
  const hasCover = dish?.image && dish.image !== '/icons/icon.svg'
  const ingredients = dish?.ingredients?.length ? dish.ingredients : [{}]
  const steps = dish?.steps?.length ? dish.steps : [{}]
  return `<main class="subpage form-page"><header class="subpage-header"><button class="icon-button" data-action="close-form" aria-label="${editing ? '返回菜品详情' : '返回菜单'}">${icons.back}</button><h1>${editing ? '编辑菜品' : '新增菜品'}</h1><button class="icon-button form-save-button" type="submit" form="dish-form" aria-label="${editing ? '保存菜品修改' : '保存菜品'}">${icons.send}</button></header>
    <form id="dish-form" class="dish-form" data-mode="${editing ? 'edit' : 'create'}">
      <input id="dish-form-image" class="upload-input" name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-describedby="dish-image-status" aria-required="true">
      <label class="dish-cover-upload ${hasCover ? 'has-image' : ''}" for="dish-form-image">
        <span id="dish-image-preview" class="dish-image-preview">${hasCover ? `<img src="${escapeAttr(dish.image)}" alt="当前菜品封面">` : `<span class="dish-cover-placeholder">${icons.upload}<strong>添加菜品封面</strong><small>支持 JPG、PNG、WebP 或 GIF，最大 15MB</small></span>`}</span>
        <span class="dish-cover-change" id="dish-image-status">${icons.upload} ${hasCover ? '更换封面' : '尚未选择图片'}</span>
      </label>
      <label class="sr-only" for="dish-form-name">菜品名称</label><input id="dish-form-name" name="name" maxlength="20" required placeholder="菜品名称（必填）" value="${escapeAttr(dish?.name || '')}" autofocus>
      <label class="sr-only" for="dish-form-desc">菜品描述</label><textarea id="dish-form-desc" name="desc" maxlength="60" placeholder="菜品描述：介绍食材、口味或特色（选填）">${escapeHtml(dish?.desc || '')}</textarea>
      <section class="ingredients-section" aria-labelledby="ingredients-heading">
        <div class="form-section-heading"><h2 id="ingredients-heading">用料</h2><button type="button" data-action="add-ingredient" aria-label="添加一条用料">${icons.plus}</button></div>
        <div id="ingredient-list">${ingredients.map((ing, idx) => ingredientRow(ing, idx)).join('')}</div>
      </section>
      <label class="sr-only" for="dish-form-category">菜品分类</label><input id="dish-form-category" name="category" list="category-list" maxlength="10" placeholder="菜品分类（选填）" value="${escapeAttr(dish?.category || '')}"><datalist id="category-list">${categoryOptions.map((category) => `<option value="${escapeAttr(category)}"></option>`).join('')}</datalist>
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
  const views = { menu: menuView, detail: detailView, picks: pickedView, orders: ordersView, dishForm: dishFormView, favorites: favoritesView, profile: profileView }
  document.querySelector('#app').innerHTML = `${views[state.view]()}${imagePreview()}${successModal()}`
  document.body.classList.toggle('image-preview-open', state.imagePreviewOpen)
  document.body.classList.toggle('modal-open', state.showSuccessModal)
  if (state.view === 'menu' && categoryScrollLeft !== undefined) document.querySelector('.categories').scrollLeft = categoryScrollLeft
  if (state.imagePreviewOpen) document.querySelector('.image-lightbox-close')?.focus()
  else if (state.view === 'detail') document.querySelector('.floating-back')?.focus()
}

function showToast(message) {
  const region = document.querySelector('#toast-region'); region.innerHTML = `<div class="toast">${message}</div>`
  window.setTimeout(() => { region.innerHTML = '' }, 2200)
}

function openDish(id) {
  state.selectedDish = dishes.find((dish) => dish.id === Number(id)); const existing = state.picks.find((item) => item.dishId === state.selectedDish.id); state.selectedOption = existing?.option || state.selectedDish.options[0]; state.note = existing?.note || ''; navigate('detail')
}

function addDish(dish, option = dish.options[0], note = '') {
  const item = { key: String(dish.id), dishId: dish.id, name: dish.name, option, note }
  const index = state.picks.findIndex((pick) => pick.dishId === dish.id)
  if (index >= 0) state.picks[index] = item
  else state.picks.push(item)
  markMenuAsDraft()
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button'); if (!button) return
  if (button.dataset.category) { state.category = button.dataset.category; render(); return }
  const action = button.dataset.action
  if (action === 'preview-image') { state.imagePreviewOpen = true; render(); return }
  if (action === 'close-image-preview') { closeImagePreview(); return }
  if (action === 'toggle-more-menu') { state.moreMenuOpen = !state.moreMenuOpen; render(); return }
  if (action === 'close-more-menu') { state.moreMenuOpen = false; render(); return }
  if (action === 'add-ingredient') {
    const list = document.querySelector('#ingredient-list')
    if (list && list.children.length >= 20) { showToast('最多添加 20 条用料'); return }
    const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    list.insertAdjacentHTML('beforeend', ingredientRow({}, key))
    list.lastElementChild.querySelector('input')?.focus()
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
    return
  }
  if (action === 'add-step') {
    const list = document.querySelector('#step-list')
    if (list && list.children.length >= 20) { showToast('最多添加 20 个制作步骤'); return }
    const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    list.insertAdjacentHTML('beforeend', stepRow({}, key))
    updateStepNumbers()
    list.lastElementChild.querySelector('textarea')?.focus()
    return
  }
  if (action === 'remove-step') {
    const row = button.closest('[data-step-row]')
    if (!row) return
    const list = row.parentElement
    if (list.children.length === 1) {
      row.querySelector('textarea').value = ''
      row.dataset.image = ''
      row.querySelector('.step-image-preview').innerHTML = `${icons.upload}<span>添加图片 <small>选填</small></span>`
      row.querySelector('.step-image-upload').classList.remove('has-image')
      row.querySelector('.step-image-clear')?.remove()
      row.querySelector('textarea')?.focus()
    } else {
      row.remove()
      updateStepNumbers()
    }
    return
  }
  if (action === 'clear-step-image') {
    const row = button.closest('[data-step-row]')
    row.dataset.image = ''
    row.querySelector('.step-image-input').value = ''
    row.querySelector('.step-image-preview').innerHTML = `${icons.upload}<span>添加图片 <small>选填</small></span>`
    row.querySelector('.step-image-upload').classList.remove('has-image')
    button.remove()
    return
  }
  if (action === 'retry-dishes') { await loadDishes(); return }
  if (action === 'edit-dish') { state.editingDish = state.selectedDish; navigate('dishForm'); return }
  if (action === 'delete-dish') {
    const dish = state.selectedDish
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
    if (button.classList.contains('add-button')) { addDish(dish); showToast(`已添加「${dish.name}」`); render() } else openDish(button.dataset.dish)
    return
  }
  if (action === 'remove-pick') { state.picks.splice(Number(button.dataset.index), 1); markMenuAsDraft(); render(); return }
  if (action === 'close') { goBack() }
  if (action === 'close-success-modal') { closeSuccessModal(); return }
  if (action === 'orders-from-modal') { closeSuccessModal(); await loadLatestOrder(); navigate('orders'); return }
  if (action === 'menu') { navigate('menu', { replace: true }) }
  if (action === 'close-form') { state.editingDish = null; goBack() }
  if (action === 'picks') { navigate('picks') }
  if (action === 'orders') { await loadLatestOrder(); navigate('orders') }
  if (action === 'new-dish') { state.editingDish = null; navigate('dishForm') }
  if (action === 'favorites') { navigate('favorites') }
  if (action === 'profile') { navigate('profile') }
  if (action === 'clear' && window.confirm('确定清空全部已点菜品吗？')) {
    button.disabled = true
    try {
      await apiRequest('/api/orders/current', { method: 'DELETE' })
      state.picks = []
      state.orderNumber = ''
      state.confirmed = false
      state.confirmedCount = 0
      render()
      showToast('已清空菜单')
    } catch {
      button.disabled = false
      showToast('清空失败，请检查网络后重试')
    }
    return
  }
  if (action === 'confirm-add') { const option = document.querySelector('input[name="option"]:checked')?.value || state.selectedDish.options[0]; const note = document.querySelector('#dish-note').value.trim(); addDish(state.selectedDish, option, note); goBack(); showToast('已经点好这道菜啦') }
  if (action === 'confirm-menu') {
    if (!state.picks.length) return
    const order = { orderNumber: `ORD${Date.now()}`, items: state.picks }
    button.disabled = true
    try {
      await apiRequest('/api/orders', {
        method: 'POST',
        body: JSON.stringify(order),
      })
      state.confirmedCount = pickCount()
      state.confirmed = true
      state.orderNumber = order.orderNumber
    } catch {
      button.disabled = false
      showToast('确认失败，数据未保存，请检查网络后重试')
      return
    }
    state.showSuccessModal = true
    render()
  }
})

document.addEventListener('click', (event) => {
  if (event.target.classList.contains('image-lightbox')) closeImagePreview()
  if (event.target.closest('.modal-overlay') && !event.target.closest('.success-modal')) closeSuccessModal()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.imagePreviewOpen) closeImagePreview()
  if (event.key === 'Escape' && state.showSuccessModal) closeSuccessModal()
})

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'dish-form') return
  event.preventDefault()
  const editingDish = state.editingDish
  const formData = new FormData(event.target)
  const imageFile = formData.get('imageFile')
  const hasExistingCover = editingDish?.image && editingDish.image !== '/icons/icon.svg'
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
  const stepRows = [...event.target.querySelectorAll('[data-step-row]')]
  const steps = []
  for (const row of stepRows) {
    const instruction = row.querySelector('[name="stepInstruction"]').value.trim()
    const stepImageFile = row.querySelector('[name="stepImage"]').files[0]
    let stepImage = row.dataset.image || null
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
    category: formData.get('category').trim(),
    name: formData.get('name').trim(),
    desc: formData.get('desc').trim(),
    sales: 0,
    spicy: editingDish?.spicy || 0,
    image,
    options: editingDish?.options?.length ? editingDish.options : ['标准份'],
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
  navigate('menu', { replace: true })
  showToast(`${editingDish ? '已更新' : '已新增'}「${dish.name}」`)
})

document.addEventListener('input', (event) => {
  if (event.target.id === 'dish-search') { state.search = event.target.value; const position = event.target.selectionStart; render(); const input = document.querySelector('#dish-search'); input.focus(); input.setSelectionRange(position, position) }
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
loadLatestOrder({ force: true })
window.setInterval(() => {
  if (!document.hidden) loadLatestOrder({ notify: true })
}, orderRefreshInterval)
window.addEventListener('online', () => {
  loadDishes()
  loadLatestOrder({ notify: true })
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    loadDishes()
    loadLatestOrder({ notify: true })
  }
})
