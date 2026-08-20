import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

let renderAnimations = null

const PARTICLE_COUNT = 8

/**
 * 环境光背景（仿 Cursor Origin 风格）：
 * 三团缓慢漂移的柔光光球 + 漂浮粒子，纯 CSS、仅 transform/opacity，GPU 友好。
 * 由视图模板插入 #app 顶层（位于内容之下，pointer-events: none，不遮挡交互）。
 */
export function ambientMarkup() {
  const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => `<i class="ambient-particle" style="--i:${i}"></i>`).join('')
  return `
    <div class="ambient" aria-hidden="true">
      <div class="ambient-orb ambient-orb--a"></div>
      <div class="ambient-orb ambient-orb--b"></div>
      <div class="ambient-orb ambient-orb--c"></div>
      ${particles}
    </div>
  `
}

/**
 * 每次 render() 后调用：按当前视图编排入场动画，
 * 并挂载滚动入场（ScrollTrigger）与桌面端 3D 倾斜交互。
 * 所有实例都挂在 gsap.matchMedia 上，下次 render 时统一 revert 清理；
 * prefers-reduced-motion 下整体跳过，保证无障碍。
 */
export function animateRenderedView() {
  renderAnimations?.revert()
  const media = gsap.matchMedia()
  renderAnimations = media

  // —— 入场动画（prefers-reduced-motion 时整体跳过） ——
  media.add({ reduceMotion: '(prefers-reduced-motion: reduce)' }, ({ conditions }) => {
    if (conditions.reduceMotion) return undefined

    const root = document.querySelector('.menu-layout, .subpage, .detail-view, .login-screen, .success-view')
    if (!root) return undefined

    // 点餐成功弹窗：勾号回弹（modal 独立于视图根节点）
    const successMark = document.querySelector('.success-modal .success-mark')
    if (successMark) {
      gsap.from(successMark, { scale: 0, rotation: -24, duration: 0.55, ease: 'back.out(2.2)' })
    }

    const isLogin = root.classList.contains('login-screen')
    const isMenu = root.classList.contains('menu-layout')
    const isDetail = root.classList.contains('detail-view')

    const tl = gsap.timeline({ defaults: { duration: 0.45, ease: 'power3.out' } })
    tl.from(root, { autoAlpha: 0, y: 16 })

    if (isLogin) {
      // 表单字段依次滑入，页脚提示文案淡入
      tl.from(root.querySelectorAll('.login-field, .login-submit, .login-error'), { autoAlpha: 0, y: 14, stagger: 0.07 }, '<0.16')
        .from(root.querySelector('.login-hint'), { autoAlpha: 0, y: 8 }, '<0.1')
      return () => tl.kill()
    }

    if (isMenu) {
      // 顶部区域入场；菜品卡片交给 ScrollTrigger 滚动分批浮现
      tl.from(root.querySelectorAll('.search-wrap, .categories, .section-title'), { autoAlpha: 0, y: 16, stagger: 0.06 }, '<0.08')
        .from(root.querySelector('.bottom-nav'), { yPercent: 100, duration: 0.34 }, '<0.15')
    } else {
      tl.from(root.querySelectorAll('.subpage-header, .section-title, .search-wrap, .categories, .note-card'), { autoAlpha: 0, y: 16, stagger: 0.055 }, '<0.08')
        .from(root.querySelectorAll('.dish-card, .cart-item, .profile-card, .profile-stats, .profile-actions, .order-day-group, .messages-content > *, .menu-assignment-list, .option-list label, .recipe-steps li, .detail-ingredients dl div'), {
          autoAlpha: 0,
          y: 18,
          scale: 0.98,
          stagger: { each: 0.045, from: 'start' },
          clearProps: 'transform',
        }, '<0.08')
      if (root.querySelector('.bottom-nav')) {
        tl.from(root.querySelector('.bottom-nav'), { yPercent: 100, duration: 0.34 }, '<0.18')
      }
    }

    if (isDetail) {
      // 底部信息弹层上滑
      tl.from(root.querySelector('.detail-sheet'), { autoAlpha: 0, y: 46, duration: 0.55, ease: 'power4.out' }, '<0.05')
      // 大图轻微视差：滚动时图片缓动，预放大兜底避免露边
      const heroImg = root.querySelector('.dish-image--large img')
      if (heroImg) {
        gsap.fromTo(
          heroImg,
          { yPercent: -5, scale: 1.1 },
          {
            yPercent: 5,
            scale: 1.1,
            ease: 'none',
            scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: 0.5 },
          }
        )
      }
    }

    return () => tl.kill()
  })

  // —— 菜单菜品卡片：滚动进入视口时逐张浮现（once，避免重复播放） ——
  media.add({ reveal: '(prefers-reduced-motion: no-preference)' }, () => {
    const cards = document.querySelectorAll('.menu-layout .dish-card')
    if (!cards.length) return undefined
    gsap.set(cards, { autoAlpha: 0, y: 26, scale: 0.97 })
    const cleanupTimers = []
    const reveal = (card) => {
      gsap.to(card, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.55,
        ease: 'power3.out',
        overwrite: 'auto',
      })
      // 硬兜底：某些环境（后台标签页 / 低端机）requestAnimationFrame 被节流甚至冻结，
      // tween 不会推进。延迟后若卡片仍处于隐藏状态，直接强制落到最终可见状态，
      // 保证「最后一行菜品」在任何情况下都能显示出来。
      const id = setTimeout(() => {
        const cs = getComputedStyle(card)
        console.log('[DBG2] fallback, opacity:', cs.opacity, 'card:', card.querySelector('h3')?.textContent)
        if (cs.opacity === '0' || cs.visibility === 'hidden') {
          gsap.set(card, { autoAlpha: 1, y: 0, scale: 1 })
        }
      }, 650)
      cleanupTimers.push(id)
    }
    // 兜底：把「已经处于视口内」的卡片立即浮现。
    // 解决从详情页返回菜单恢复滚动位置、或懒加载图片后布局变化时，
    // 最后一行卡片因 onEnter 未触发而永远卡在 opacity:0 的问题。
    const revealIfVisible = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight
      cards.forEach((card) => {
        if (card.getBoundingClientRect().top < vh * 0.92) reveal(card)
      })
    }
    const triggers = []
    cards.forEach((card) => {
      const st = ScrollTrigger.create({
        trigger: card,
        start: 'top 92%',
        once: true,
        onEnter: () => {
          console.log('[DBG2] onEnter:', card.querySelector('h3')?.textContent)
          reveal(card)
        },
        onRefresh: (self) => {
          // 位置刷新时若卡片已越过触发线（滚动恢复 / 图片加载后重排），立即显示
          if (self.progress > 0 || self.isActive) reveal(card)
        },
      })
      triggers.push(st)
    })
    // 立即检查一次 + 等两帧与定时器再各检查一次，覆盖各种渲染/滚动时序
    revealIfVisible()
    const raf = requestAnimationFrame(() => requestAnimationFrame(revealIfVisible))
    const timer = setTimeout(revealIfVisible, 800)
    return () => {
      console.log('[DBG2] cleanup')
      triggers.forEach((st) => st.kill())
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      cleanupTimers.forEach(clearTimeout)
    }
  })

  // —— 桌面端（精确指针）—— 菜单已改为平面列表（细线分隔），不再做卡片式 3D 倾斜 ——

  return () => media.revert()
}
