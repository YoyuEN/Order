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
    const triggers = []
    cards.forEach((card) => {
      const st = ScrollTrigger.create({
        trigger: card,
        start: 'top 92%',
        once: true,
        onEnter: () =>
          gsap.to(card, {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.55,
            ease: 'power3.out',
            overwrite: 'auto',
          }),
      })
      triggers.push(st)
    })
    return () => triggers.forEach((st) => st.kill())
  })

  // —— 桌面端（精确指针）—— 菜单已改为平面列表（细线分隔），不再做卡片式 3D 倾斜 ——

  return () => media.revert()
}
