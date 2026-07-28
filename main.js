import './style.css'
import { registerSW } from 'virtual:pwa-register'

const defaultDishes = [
  { id: 1, category: '招牌推荐', name: '金汤酸菜鱼', desc: '鲜活黑鱼，酸香金汤，配菜入味', sales: 328, spicy: 1, badge: '店长推荐', image: 'https://images.unsplash.com/photo-1569058242253-92a9c755a0ec?auto=format&fit=crop&w=800&q=80', options: ['微辣', '中辣', '重辣'] },
  { id: 2, category: '招牌推荐', name: '果木烤鸭', desc: '皮酥肉嫩，配手工薄饼与甜面酱', sales: 216, badge: '招牌', image: 'https://images.unsplash.com/photo-1518492104633-130d0cc84637?auto=format&fit=crop&w=800&q=80', options: ['半只', '整只'] },
  { id: 3, category: '热菜', name: '农家小炒肉', desc: '青椒现炒，锅气十足，下饭首选', sales: 453, spicy: 2, image: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=800&q=80', options: ['少辣', '正常辣', '加辣'] },
  { id: 4, category: '热菜', name: '板栗红烧肉', desc: '慢火煨制，肥而不腻，板栗软糯', sales: 189, image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80', options: ['标准份', '大份'] },
  { id: 5, category: '热菜', name: '清炒时蔬', desc: '当日新鲜绿叶菜，清爽少油', sales: 127, image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80', options: ['少油', '正常'] },
  { id: 6, category: '凉菜', name: '藤椒口水鸡', desc: '鲜麻爽口，鸡肉嫩滑', sales: 264, spicy: 2, image: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=800&q=80', options: ['微麻', '正常麻'] },
  { id: 7, category: '凉菜', name: '桂花糖藕', desc: '糯米香甜，桂花清香', sales: 98, soldOut: true, image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=80', options: ['标准份'] },
  { id: 8, category: '主食', name: '扬州炒饭', desc: '粒粒分明，虾仁、鸡蛋与时蔬', sales: 356, image: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=800&q=80', options: ['小份', '大份'] },
  { id: 9, category: '汤品', name: '松茸菌菇汤', desc: '多种菌菇慢炖，鲜美清润', sales: 142, image: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=800&q=80', options: ['2-3人份', '4-6人份'] },
  { id: 10, category: '饮品', name: '手作酸梅汤', desc: '古法熬制，冰爽解腻', sales: 514, image: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=800&q=80', options: ['常温', '少冰', '正常冰'] },
]

const saved = JSON.parse(localStorage.getItem('hewei-order-state') || '{}')
const dishes = [...defaultDishes, ...(Array.isArray(saved.customDishes) ? saved.customDishes : [])].map(({ price: _price, ...dish }) => ({
  ...dish,
  options: (dish.options || ['标准份']).map((option) => option.replace(/\s*\+¥\d+(?:\.\d+)?$/, '')),
}))
const savedPicks = (saved.picks || saved.cart || []).map(({ price: _price, ...item }) => ({
  ...item,
  option: (item.option || '标准份').replace(/\s*\+¥\d+(?:\.\d+)?$/, ''),
}))
const state = {
  category: '全部', search: '', picks: savedPicks, table: saved.table || 'A08', guests: saved.guests || 2,
  selectedDish: null, selectedOption: '', note: '', view: 'menu', orderNumber: '', confirmed: saved.confirmed || false, confirmedCount: 0,
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
  localStorage.setItem('hewei-order-state', JSON.stringify({ picks: state.picks, table: state.table, guests: state.guests, confirmed: state.confirmed, customDishes: dishes.filter((dish) => dish.custom) }))
}

function pickCount() { return state.picks.reduce((sum, item) => sum + item.quantity, 0) }
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
      <button class="table-pill" data-action="table" aria-label="修改桌号和人数"><strong>${escapeHtml(state.table)}桌</strong><span>${state.guests}人用餐 ›</span></button>
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
  const itemCount = state.picks.filter((item) => item.dishId === dish.id).reduce((sum, item) => sum + item.quantity, 0)
  return `<article class="dish-card ${dish.soldOut ? 'sold-out' : ''}">
    <button class="dish-open" data-dish="${dish.id}" ${dish.soldOut ? 'disabled' : ''} aria-label="查看${escapeAttr(dish.name)}详情">${imageMarkup(dish)}<span class="dish-info">${dish.badge ? `<small>${escapeHtml(dish.badge)}</small>` : ''}<b>${escapeHtml(dish.name)}</b><span>${escapeHtml(dish.desc)}</span><span class="sales">月售 ${dish.sales}${dish.spicy ? ` · ${'🌶'.repeat(dish.spicy)}` : ''}</span></span></button>
    <div class="dish-footer"><span>${dish.soldOut ? '暂时售罄' : itemCount ? `已点 ${itemCount} 份` : '想吃就点它'}</span>${dish.soldOut ? '' : `<button class="add-button" data-dish="${dish.id}" aria-label="点选${escapeAttr(dish.name)}">${itemCount ? `<span>${itemCount}</span>` : ''}+</button>`}</div>
  </article>`
}

function bottomBar() {
  const count = pickCount()
  return `<nav class="bottom-nav" aria-label="主导航"><button class="nav-item active" data-action="menu">${icons.home}<span>点菜</span></button><button class="cart-summary" data-action="picks" aria-label="查看已点菜单，共${count}份"><span class="cart-icon">${icons.list}${count ? `<b>${count}</b>` : ''}</span><span><strong>${count ? `已经点了 ${count} 份` : '还没有点菜'}</strong><small>${count ? '看看有没有漏掉想吃的' : '喜欢什么就点什么吧'}</small></span></button><button class="nav-item" data-action="orders">${icons.receipt}<span>已点</span></button></nav>`
}

function detailView() {
  const dish = state.selectedDish
  return `<main class="detail-view"><button class="icon-button floating-back" data-action="close" aria-label="返回菜单">${icons.back}</button>${imageMarkup(dish, true)}<section class="detail-sheet"><p class="eyebrow">${escapeHtml(dish.category)}</p><h1>${escapeHtml(dish.name)}</h1><p class="detail-desc">${escapeHtml(dish.desc)}</p><div class="detail-meta"><strong>今天就吃这个</strong><span>人气 ${dish.sales}</span></div><fieldset><legend>选择规格 <em>必选</em></legend><div class="option-list">${dish.options.map((option, index) => `<label><input type="radio" name="option" value="${escapeAttr(option)}" ${state.selectedOption === option || (!state.selectedOption && index === 0) ? 'checked' : ''}><span>${escapeHtml(option)}</span></label>`).join('')}</div></fieldset><label class="note-label" for="dish-note">口味备注 <span>选填</span></label><textarea id="dish-note" maxlength="50" placeholder="例如：不要香菜、少盐">${escapeHtml(state.note)}</textarea><button class="primary-button" data-action="confirm-add">就点这道菜</button></section></main>`
}

function pickedContent(desktop = false) {
  if (!state.picks.length) return `<div class="cart-heading"><div><p class="eyebrow">今天想吃</p><h2>已点菜单</h2></div></div><div class="empty cart-empty"><span class="empty-icon">${icons.list}</span><b>还没有点菜</b><span>从菜单里挑几道她喜欢的吧</span></div>`
  return `<div class="cart-heading"><div><p class="eyebrow">今天想吃</p><h2>已点菜单</h2></div><button data-action="clear">清空</button></div><div class="cart-items">${state.picks.map((item, index) => `<div class="cart-item"><div><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.option)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</span><strong>${item.quantity} 份</strong></div><div class="stepper"><button data-index="${index}" data-delta="-1" aria-label="减少${escapeAttr(item.name)}">−</button><span>${item.quantity}</span><button data-index="${index}" data-delta="1" aria-label="增加${escapeAttr(item.name)}">+</button></div></div>`).join('')}</div>${desktop ? '<button class="primary-button" data-action="confirm-menu">确认点菜</button>' : ''}`
}

function pickedView() {
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>确认菜单</h1><span></span></header><section class="order-info"><button data-action="table"><span><small>桌号</small><b>${escapeHtml(state.table)}桌</b></span><span><small>一起吃饭</small><b>${state.guests}人 ›</b></span></button></section><section class="cart-page">${pickedContent()}</section>${state.picks.length ? `<footer class="checkout-bar"><span>共选 <strong>${pickCount()} 份</strong></span><button class="primary-button" data-action="confirm-menu">确认点菜</button></footer>` : ''}</main>`
}

function ordersView() {
  if (!state.picks.length) return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>今天吃什么</h1><span></span></header><div class="empty full-empty"><span class="empty-icon">${icons.receipt}</span><b>还没有点菜</b><span>选好想吃的菜后，这里会记录结果</span><button class="secondary-button" data-action="menu">去点菜</button></div></main>`
  return `<main class="subpage"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>今天吃什么</h1><span></span></header><section class="cart-page history-menu"><div class="menu-status"><span class="success-mark success-mark--small">✓</span><div><b>${state.confirmed ? '菜单已经选好啦' : '还差最后确认'}</b><span>一共 ${pickCount()} 份，都是今天想吃的</span></div></div>${pickedContent()}</section><div class="history-actions"><button class="secondary-button" data-action="menu">继续点菜</button></div></main>`
}

function newDishView() {
  const categoryOptions = [...new Set(dishes.map((dish) => dish.category))]
  return `<main class="subpage form-page"><header class="subpage-header"><button class="icon-button" data-action="close" aria-label="返回菜单">${icons.back}</button><h1>新增菜品</h1><span></span></header>
    <form id="new-dish-form" class="dish-form">
      <div class="form-intro"><p class="eyebrow">菜单管理</p><h2>录入一道新菜</h2><p>保存后会立即显示在点菜菜单中，并保存在当前设备。</p></div>
      <label for="new-dish-name">菜品名称 <em>必填</em></label><input id="new-dish-name" name="name" maxlength="20" required placeholder="例如：蒜蓉粉丝虾" autofocus>
      <label for="new-dish-category">菜品分类 <em>必填</em></label><input id="new-dish-category" name="category" list="category-list" maxlength="10" required placeholder="选择或输入分类"><datalist id="category-list">${categoryOptions.map((category) => `<option value="${escapeAttr(category)}"></option>`).join('')}</datalist>
      <label for="new-dish-desc">菜品描述 <em>必填</em></label><textarea id="new-dish-desc" name="desc" maxlength="60" required placeholder="介绍食材、口味或特色"></textarea>
      <label for="new-dish-image">图片网址 <span>选填</span></label><input id="new-dish-image" name="image" type="url" inputmode="url" placeholder="https://example.com/dish.jpg"><small class="field-hint">不填写时使用默认餐厅图标；仅支持 http 或 https 图片。</small>
      <fieldset><legend>辣度</legend><div class="option-list"><label><input type="radio" name="spicy" value="0" checked><span>不辣</span></label><label><input type="radio" name="spicy" value="1"><span>微辣 🌶</span></label><label><input type="radio" name="spicy" value="2"><span>中辣 🌶🌶</span></label><label><input type="radio" name="spicy" value="3"><span>重辣 🌶🌶🌶</span></label></div></fieldset>
      <label for="new-dish-options">可选规格 <span>选填</span></label><input id="new-dish-options" name="options" maxlength="60" placeholder="用逗号分隔，例如：小份, 大份"><small class="field-hint">留空时使用“标准份”，最多可以填写 6 种规格。</small>
      <button class="primary-button" type="submit">保存并加入菜单</button>
    </form></main>`
}

function successView() {
  return `<main class="success-view"><div class="success-mark">✓</div><p class="eyebrow">今天的菜单定好啦</p><h1>点菜完成</h1><p>都是想吃的，准备一起好好吃饭吧</p><div class="order-ticket"><span>已选菜品 <b>${state.confirmedCount} 份</b></span><span>桌号 <b>${escapeHtml(state.table)}桌</b></span><span>一起吃饭 <b>${state.guests} 人</b></span></div><button class="primary-button" data-action="orders">查看今天的菜单</button><button class="secondary-button" data-action="menu">继续加菜</button></main>`
}

function render() {
  const views = { menu: menuView, detail: detailView, picks: pickedView, orders: ordersView, success: successView, newDish: newDishView }
  document.querySelector('#app').innerHTML = views[state.view]()
  if (state.view === 'detail') document.querySelector('.floating-back')?.focus()
}

function showToast(message) {
  const region = document.querySelector('#toast-region'); region.innerHTML = `<div class="toast">${message}</div>`
  window.setTimeout(() => { region.innerHTML = '' }, 2200)
}

function openDish(id) {
  state.selectedDish = dishes.find((dish) => dish.id === Number(id)); state.selectedOption = state.selectedDish.options[0]; state.note = ''; state.view = 'detail'; render()
}

function addDish(dish, option = dish.options[0], note = '') {
  const key = `${dish.id}-${option}-${note}`; const existing = state.picks.find((item) => item.key === key)
  if (existing) existing.quantity += 1
  else state.picks.push({ key, dishId: dish.id, name: dish.name, option, note, quantity: 1 })
  persist()
}

function editTable() {
  const table = window.prompt('请输入桌号', state.table)
  if (table === null) return
  const guests = window.prompt('请输入用餐人数（1-20）', state.guests)
  if (guests === null) return
  state.table = table.trim().slice(0, 8) || state.table; state.guests = Math.max(1, Math.min(20, Number.parseInt(guests, 10) || state.guests)); persist(); render()
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button) return
  if (button.dataset.category) { state.category = button.dataset.category; render(); return }
  if (button.dataset.dish) {
    const dish = dishes.find((item) => item.id === Number(button.dataset.dish))
    if (button.classList.contains('add-button')) { addDish(dish); showToast(`已添加「${dish.name}」`); render() } else openDish(button.dataset.dish)
    return
  }
  if (button.dataset.delta) {
    const index = Number(button.dataset.index); state.picks[index].quantity += Number(button.dataset.delta); if (state.picks[index].quantity <= 0) state.picks.splice(index, 1); persist(); render(); return
  }
  const action = button.dataset.action
  if (action === 'close' || action === 'menu') { state.view = 'menu'; render() }
  if (action === 'picks') { state.view = 'picks'; render() }
  if (action === 'orders') { state.view = 'orders'; render() }
  if (action === 'new-dish') { state.view = 'newDish'; render() }
  if (action === 'table') editTable()
  if (action === 'clear' && window.confirm('确定清空全部已点菜品吗？')) { state.picks = []; persist(); render() }
  if (action === 'confirm-add') { const option = document.querySelector('input[name="option"]:checked')?.value || state.selectedDish.options[0]; const note = document.querySelector('#dish-note').value.trim(); addDish(state.selectedDish, option, note); state.view = 'menu'; render(); showToast('已经点好这道菜啦') }
  if (action === 'confirm-menu') { if (!state.picks.length) return; state.confirmedCount = pickCount(); state.confirmed = true; state.orderNumber = String(Date.now()).slice(-6); persist(); state.view = 'success'; render() }
})

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'new-dish-form') return
  event.preventDefault()
  const formData = new FormData(event.target)
  const imageInput = formData.get('image').trim()
  let image = '/icons/icon.svg'
  if (imageInput) {
    try {
      const url = new URL(imageInput)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
      image = url.href
    } catch {
      document.querySelector('#new-dish-image').setCustomValidity('请输入有效的 http 或 https 图片网址')
      document.querySelector('#new-dish-image').reportValidity()
      return
    }
  }
  const options = formData.get('options').split(/[,，]/).map((option) => option.trim()).filter(Boolean).slice(0, 6)
  const dish = {
    id: Date.now(),
    custom: true,
    category: formData.get('category').trim(),
    name: formData.get('name').trim(),
    desc: formData.get('desc').trim(),
    sales: 0,
    spicy: Number(formData.get('spicy')),
    image,
    options: options.length ? options : ['标准份'],
  }
  dishes.push(dish)
  state.category = dish.category
  state.search = ''
  state.view = 'menu'
  persist()
  render()
  showToast(`已新增「${dish.name}」`)
})

document.addEventListener('input', (event) => {
  if (event.target.id === 'dish-search') { state.search = event.target.value; const position = event.target.selectionStart; render(); const input = document.querySelector('#dish-search'); input.focus(); input.setSelectionRange(position, position) }
})

registerSW({ onOfflineReady: () => showToast('应用已可离线使用'), onNeedRefresh: () => showToast('发现新版本，将自动更新') })
render()
