import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { defaultDishes } from './menu-data.js'

const saved = JSON.parse(localStorage.getItem('hewei-order-state') || '{}')
let dishes = [...defaultDishes, ...(Array.isArray(saved.customDishes) ? saved.customDishes : [])].map(({ price: _price, ...dish }) => ({
  ...dish,
  options: (dish.options || ['标准份']).map((option) => option.replace(/\s*\+¥\d+(?:\.\d+)?$/, '')),
}))
const savedPicks = [...new Map((saved.picks || saved.cart || []).map(({ price: _price, quantity: _quantity, ...item }) => [
  Number(item.dishId),
  { ...item, key: String(item.dishId), option: (item.option || '标准份').replace(/\s*\+¥\d+(?:\.\d+)?$/, '') },
])).values()]
const state = {
  category: '全部', search: '', picks: savedPicks,
  selectedDish: null, editingDish: null, selectedOption: '', note: '', view: 'menu', orderNumber: '', confirmed: saved.confirmed || false, confirmedCount: 0,
}

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const pendingOrdersKey = 'hewei-pending-orders'

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

async function uploadDishImage(file) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15000)
  const body = new FormData()
  body.append('image', file)
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
  try {
    const remoteDishes = await apiRequest('/api/dishes')
    if (Array.isArray(remoteDishes)) {
      const localOnlyDishes = dishes.filter((dish) => dish.localOnly)
      dishes = [...remoteDishes, ...localOnlyDishes]
      render()
    }
  } catch {
    showToast('当前使用离线菜单')
  }
}

function getPendingOrders() {
  try {
    const pendingOrders = JSON.parse(localStorage.getItem(pendingOrdersKey) || '[]')
    return Array.isArray(pendingOrders) ? pendingOrders : []
  } catch {
    return []
  }
}

function savePendingOrders(orders) {
  localStorage.setItem(pendingOrdersKey, JSON.stringify(orders))
}

async function syncPendingOrders() {
  const pendingOrders = getPendingOrders()
  if (!pendingOrders.length) return
  const remainingOrders = []
  for (const order of pendingOrders) {
    try {
      await apiRequest('/api/orders', { method: 'POST', body: JSON.stringify(order) })
    } catch {
      remainingOrders.push(order)
    }
  }
  savePendingOrders(remainingOrders)
  if (remainingOrders.length < pendingOrders.length) showToast('离线订单已同步')
}

const icons = {
  search: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m21 21-4.4-4.4m2.4-5.1A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z"/></svg>',
  back: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  list: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 7 2 2 4-4M12 7h8M4 14l2 2 4-4m2 2h8"/></svg>',
  home: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m3 11 9-8 9 8v9H8v-7h8v7"/></svg>',
  receipt: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6"/></svg>',
  plus: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
}

function persist() {
  localStorage.setItem('hewei-order-state', JSON.stringify({ picks: state.picks, confirmed: state.confirmed, customDishes: dishes.filter((dish) => dish.custom) }))
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
  return `
    <header class="app-header">
      <div><p class="eyebrow">欢迎光临</p><h1>禾味小馆</h1><p class="status"><span></span> 营业中 · 约 20 分钟出餐</p></div>
    </header>
    <main class="menu-layout">
      <section class="menu-panel" aria-labelledby="menu-heading">
        <div class="search-wrap">${icons.search}<label class="sr-only" for="dish-search">搜索菜品</label><input id="dish-search" type="search" placeholder="搜索想吃的菜" value="${escapeHtml(state.search)}" autocomplete="off"></div>
        <nav class="categories" aria-label="菜品分类">${categories.map((category) => `<button class="category ${category === state.category ? 'active' : ''}" data-category="${escapeAttr(category)}" aria-pressed="${category === state.category}">${escapeHtml(category)}</button>`).join('')}</nav>
        <div class="section-title"><div><p class="eyebrow">今日菜单</p><h2 id="menu-heading">${state.category === '全部' ? '人气菜品' : escapeHtml(state.category)}</h2></div><div class="section-actions"><span>${filtered.length} 道菜</span><button data-action="new-dish">${icons.plus} 新增菜品</button></div></div>
        <div class="dish-grid">${filtered.length ? filtered.map(dishCard).join('') : '<div class="empty"><b>没有找到相关菜品</b><span>换个关键词或分类试试</span></div>'}</div>
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
  return `<nav class="bottom-nav" aria-label="主导航"><button class="nav-item active" data-action="menu">${icons.home}<span>点菜</span></button><button class="cart-summary" data-action="picks" aria-label="查看已点菜单，共${count}道菜"><span class="cart-icon">${icons.list}${count ? `<b>${count}</b>` : ''}</span><span><strong>${count ? `已经点了 ${count} 道菜` : '还没有点菜'}</strong><small>${count ? '看看有没有漏掉想吃的' : '喜欢什么就点什么吧'}</small></span></button><button class="nav-item" data-action="orders">${icons.receipt}<span>已点</span></button></nav>`
}

function detailView() {
  const dish = state.selectedDish
  return `<main class="detail-view"><button class="icon-button floating-back" data-action="close" aria-label="返回菜单">${icons.back}</button>${imageMarkup(dish, true)}<section class="detail-sheet"><p class="eyebrow">${escapeHtml(dish.category)}</p><h1>${escapeHtml(dish.name)}</h1><p class="detail-desc">${escapeHtml(dish.desc)}</p><div class="detail-meta"><strong>今天就吃这个</strong></div><div class="management-actions" aria-label="菜品管理"><button class="secondary-button" data-action="edit-dish">编辑菜品</button><button class="danger-button" data-action="delete-dish">删除菜品</button></div><fieldset><legend>选择规格 <em>必选</em></legend><div class="option-list">${dish.options.map((option, index) => `<label><input type="radio" name="option" value="${escapeAttr(option)}" ${state.selectedOption === option || (!state.selectedOption && index === 0) ? 'checked' : ''}><span>${escapeHtml(option)}</span></label>`).join('')}</div></fieldset><label class="note-label" for="dish-note">口味备注 <span>选填</span></label><textarea id="dish-note" maxlength="50" placeholder="例如：不要香菜、少盐">${escapeHtml(state.note)}</textarea><button class="primary-button" data-action="confirm-add">${state.picks.some((item) => item.dishId === dish.id) ? '更新选择' : '就点这道菜'}</button></section></main>`
}

function pickedContent(desktop = false) {
  if (!state.picks.length) return `<div class="cart-heading"><div><p class="eyebrow">今天想吃</p><h2>已点菜单</h2></div></div><div class="empty cart-empty"><span class="empty-icon">${icons.list}</span><b>还没有点菜</b><span>从菜单里挑几道她喜欢的吧</span></div>`
  return `<div class="cart-heading"><div><p class="eyebrow">今天想吃</p><h2>已点菜单</h2></div><button data-action="clear">清空</button></div><div class="cart-items">${state.picks.map((item, index) => `<div class="cart-item"><button class="cart-item-main" data-dish="${item.dishId}" aria-label="查看${escapeAttr(item.name)}详情"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.option)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></span><i aria-hidden="true">›</i></button><button class="remove-item" data-action="remove-pick" data-index="${index}" aria-label="移除${escapeAttr(item.name)}">移除</button></div>`).join('')}</div>${desktop ? '<button class="primary-button" data-action="confirm-menu">确认点菜</button>' : ''}`
}

function pickedView() {
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>确认菜单</h1><span></span></header><section class="cart-page">${pickedContent()}</section>${state.picks.length ? `<footer class="checkout-bar"><span>共选 <strong>${pickCount()} 道菜</strong></span><button class="primary-button" data-action="confirm-menu">确认点菜</button></footer>` : ''}</main>`
}

function ordersView() {
  if (!state.picks.length) return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>今天吃什么</h1><span></span></header><div class="empty full-empty"><span class="empty-icon">${icons.receipt}</span><b>还没有点菜</b><span>选好想吃的菜后，这里会记录结果</span><button class="secondary-button" data-action="menu">去点菜</button></div></main>`
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>今天吃什么</h1><span></span></header><section class="cart-page history-menu"><div class="menu-status"><span class="success-mark success-mark--small">✓</span><div><b>${state.confirmed ? '菜单已经选好啦' : '还差最后确认'}</b><span>一共 ${pickCount()} 道菜，都是今天想吃的</span></div></div>${pickedContent()}</section><div class="history-actions"><button class="secondary-button" data-action="menu">继续点菜</button></div></main>`
}

function dishFormView() {
  const dish = state.editingDish
  const editing = Boolean(dish)
  const categoryOptions = [...new Set(dishes.map((dish) => dish.category))]
  return `<main class="subpage form-page"><header class="subpage-header"><button class="icon-button" data-action="close-form" aria-label="${editing ? '返回菜品详情' : '返回菜单'}">${icons.back}</button><h1>${editing ? '编辑菜品' : '新增菜品'}</h1><span></span></header>
    <form id="dish-form" class="dish-form" data-mode="${editing ? 'edit' : 'create'}">
      <div class="form-intro"><p class="eyebrow">菜单管理</p><h2>${editing ? '更新菜品信息' : '录入一道新菜'}</h2><p>${editing ? '保存后将同步更新数据库和当前菜单。' : '保存后会立即显示在点菜菜单中，并保存在当前设备。'}</p></div>
      <label for="dish-form-name">菜品名称 <em>必填</em></label><input id="dish-form-name" name="name" maxlength="20" required placeholder="例如：蒜蓉粉丝虾" value="${escapeAttr(dish?.name || '')}" autofocus>
      <label for="dish-form-category">菜品分类 <em>必填</em></label><input id="dish-form-category" name="category" list="category-list" maxlength="10" required placeholder="选择或输入分类" value="${escapeAttr(dish?.category || '')}"><datalist id="category-list">${categoryOptions.map((category) => `<option value="${escapeAttr(category)}"></option>`).join('')}</datalist>
      <label for="dish-form-desc">菜品描述 <em>必填</em></label><textarea id="dish-form-desc" name="desc" maxlength="60" required placeholder="介绍食材、口味或特色">${escapeHtml(dish?.desc || '')}</textarea>
      <label for="dish-form-image">菜品图片 <span>选填</span></label><input id="dish-form-image" name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif"><small class="field-hint">支持 JPG、PNG、WebP 或 GIF，图片不能超过 5MB；不选择时${editing ? '保留原图' : '使用默认餐厅图标'}。</small>
      <div id="dish-image-preview" class="dish-image-preview ${dish?.image && dish.image !== '/icons/icon.svg' ? '' : 'hidden'}">${dish?.image && dish.image !== '/icons/icon.svg' ? `<img src="${escapeAttr(dish.image)}" alt="当前菜品图片">` : ''}</div>
      <fieldset><legend>辣度</legend><div class="option-list">${[0, 1, 2, 3].map((spicy) => `<label><input type="radio" name="spicy" value="${spicy}" ${(dish?.spicy || 0) === spicy ? 'checked' : ''}><span>${['不辣', '微辣 🌶', '中辣 🌶🌶', '重辣 🌶🌶🌶'][spicy]}</span></label>`).join('')}</div></fieldset>
      <label for="dish-form-options">可选规格 <span>选填</span></label><input id="dish-form-options" name="options" maxlength="60" placeholder="用逗号分隔，例如：小份, 大份" value="${escapeAttr(dish?.options?.join(', ') || '')}"><small class="field-hint">留空时使用“标准份”，最多可以填写 6 种规格。</small>
      <button class="primary-button" type="submit">${editing ? '保存修改' : '保存并加入菜单'}</button>
    </form></main>`
}

function successView() {
  return `<main class="success-view"><div class="success-mark">✓</div><p class="eyebrow">今天的菜单定好啦</p><h1>点菜完成</h1><p>都是想吃的，准备一起好好吃饭吧</p><div class="order-ticket"><span>已选菜品 <b>${state.confirmedCount} 道</b></span></div><button class="primary-button" data-action="orders">查看今天的菜单</button><button class="secondary-button" data-action="menu">继续加菜</button></main>`
}

function render() {
  const views = { menu: menuView, detail: detailView, picks: pickedView, orders: ordersView, success: successView, dishForm: dishFormView }
  document.querySelector('#app').innerHTML = views[state.view]()
  if (state.view === 'detail') document.querySelector('.floating-back')?.focus()
}

function showToast(message) {
  const region = document.querySelector('#toast-region'); region.innerHTML = `<div class="toast">${message}</div>`
  window.setTimeout(() => { region.innerHTML = '' }, 2200)
}

function openDish(id) {
  state.selectedDish = dishes.find((dish) => dish.id === Number(id)); const existing = state.picks.find((item) => item.dishId === state.selectedDish.id); state.selectedOption = existing?.option || state.selectedDish.options[0]; state.note = existing?.note || ''; state.view = 'detail'; render()
}

function addDish(dish, option = dish.options[0], note = '') {
  const item = { key: String(dish.id), dishId: dish.id, name: dish.name, option, note }
  const index = state.picks.findIndex((pick) => pick.dishId === dish.id)
  if (index >= 0) state.picks[index] = item
  else state.picks.push(item)
  persist()
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button'); if (!button) return
  if (button.dataset.category) { state.category = button.dataset.category; render(); return }
  const action = button.dataset.action
  if (action === 'edit-dish') { state.editingDish = state.selectedDish; state.view = 'dishForm'; render(); return }
  if (action === 'delete-dish') {
    const dish = state.selectedDish
    if (!window.confirm(`确定删除「${dish.name}」吗？此操作无法撤销。`)) return
    button.disabled = true
    try {
      if (!dish.localOnly) await apiRequest(`/api/dishes/${dish.id}`, { method: 'DELETE' })
      dishes = dishes.filter((item) => item.id !== dish.id)
      state.picks = state.picks.filter((item) => item.dishId !== dish.id)
      state.selectedDish = null
      state.editingDish = null
      state.category = dishes.some((item) => item.category === state.category) ? state.category : '全部'
      state.view = 'menu'
      persist()
      render()
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
  if (action === 'remove-pick') { state.picks.splice(Number(button.dataset.index), 1); persist(); render(); return }
  if (action === 'close' || action === 'menu') { state.view = 'menu'; render() }
  if (action === 'close-form') { state.view = state.editingDish ? 'detail' : 'menu'; state.editingDish = null; render() }
  if (action === 'picks') { state.view = 'picks'; render() }
  if (action === 'orders') { state.view = 'orders'; render() }
  if (action === 'new-dish') { state.editingDish = null; state.view = 'dishForm'; render() }
  if (action === 'clear' && window.confirm('确定清空全部已点菜品吗？')) { state.picks = []; persist(); render() }
  if (action === 'confirm-add') { const option = document.querySelector('input[name="option"]:checked')?.value || state.selectedDish.options[0]; const note = document.querySelector('#dish-note').value.trim(); addDish(state.selectedDish, option, note); state.view = 'menu'; render(); showToast('已经点好这道菜啦') }
  if (action === 'confirm-menu') {
    if (!state.picks.length) return
    state.confirmedCount = pickCount()
    state.confirmed = true
    state.orderNumber = `ORD${Date.now()}`
    persist()
    const order = { orderNumber: state.orderNumber, items: state.picks }
    try {
      await apiRequest('/api/orders', {
        method: 'POST',
        body: JSON.stringify(order),
      })
    } catch {
      const pendingOrders = getPendingOrders().filter((item) => item.orderNumber !== order.orderNumber)
      savePendingOrders([...pendingOrders, order])
      showToast('订单已暂存，联网后自动同步')
    }
    state.view = 'success'
    render()
  }
})

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'dish-form') return
  event.preventDefault()
  const editingDish = state.editingDish
  const formData = new FormData(event.target)
  const imageFile = formData.get('imageFile')
  let image = editingDish?.image || '/icons/icon.svg'
  if (imageFile?.size) {
    try {
      image = await uploadDishImage(imageFile)
    } catch (error) {
      showToast(error.message || '图片上传失败，请检查网络后重试')
      return
    }
  }
  const options = formData.get('options').split(/[,，]/).map((option) => option.trim()).filter(Boolean).slice(0, 6)
  const uniqueOptions = [...new Set(options)]
  let dish = {
    category: formData.get('category').trim(),
    name: formData.get('name').trim(),
    desc: formData.get('desc').trim(),
    sales: 0,
    spicy: Number(formData.get('spicy')),
    image,
    options: uniqueOptions.length ? uniqueOptions : ['标准份'],
  }
  if (editingDish) {
    if (editingDish.localOnly) {
      dish = { ...editingDish, ...dish }
    } else {
      try {
        dish = await apiRequest(`/api/dishes/${editingDish.id}`, { method: 'PUT', body: JSON.stringify(dish) })
      } catch {
        showToast('修改失败，请检查网络后重试')
        return
      }
    }
    dishes = dishes.map((item) => item.id === dish.id ? dish : item)
    state.picks = state.picks.map((item) => item.dishId === dish.id ? { ...item, name: dish.name, option: dish.options.includes(item.option) ? item.option : dish.options[0] } : item)
    state.picks = [...new Map(state.picks.map((item) => [item.dishId, { ...item, key: String(item.dishId) }])).values()]
    state.selectedDish = dish
  } else {
    try {
      dish = await apiRequest('/api/dishes', { method: 'POST', body: JSON.stringify(dish) })
    } catch {
      dish = { ...dish, id: Date.now(), custom: true, localOnly: true }
      showToast('菜品暂时只保存在当前设备')
    }
    dishes.push(dish)
  }
  state.category = dish.category
  state.search = ''
  state.view = 'menu'
  state.editingDish = null
  persist()
  render()
  showToast(`${editingDish ? '已更新' : '已新增'}「${dish.name}」`)
})

document.addEventListener('input', (event) => {
  if (event.target.id === 'dish-search') { state.search = event.target.value; const position = event.target.selectionStart; render(); const input = document.querySelector('#dish-search'); input.focus(); input.setSelectionRange(position, position) }
})

document.addEventListener('change', (event) => {
  if (event.target.id !== 'dish-form-image') return
  const file = event.target.files[0]
  const preview = document.querySelector('#dish-image-preview')
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    event.target.value = ''
    showToast('图片不能超过 5MB')
    return
  }
  const image = document.createElement('img')
  image.src = URL.createObjectURL(file)
  image.alt = '待上传的菜品图片预览'
  image.addEventListener('load', () => URL.revokeObjectURL(image.src), { once: true })
  preview.replaceChildren(image)
  preview.classList.remove('hidden')
})

registerSW({ onOfflineReady: () => showToast('应用已可离线使用'), onNeedRefresh: () => showToast('发现新版本，将自动更新') })
render()
loadDishes()
syncPendingOrders()
window.addEventListener('online', syncPendingOrders)
