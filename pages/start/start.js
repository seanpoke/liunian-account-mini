// pages/start/start.js
const store = require('../../utils/store')
const flow = require('../../utils/flow')
const api = require('../../utils/api')

function svgUri(svg) {
  const bytes = new Uint8Array(svg.length)
  for (let i = 0; i < svg.length; i++) bytes[i] = svg.charCodeAt(i)
  return 'data:image/svg+xml;base64,' + wx.arrayBufferToBase64(bytes.buffer)
}
const ICONS = {
  plus: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>'),
  circlePlus: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M9 12h6M12 9v6" fill="none" stroke="#07C160" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="#07C160" stroke-width="1.5"/></svg>')
}

Page({
  data: {
    statusBarHeight: 20,
    privacy: false,
    privacyWarn: false,
    landing: false,
    loading: false,
    familyName: '流年小账',
    createSheet: false,
    createName: '',
    creating: false,
    inputFocused: false,
    icons: ICONS
  },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20) })
    if (!store.isPrivacyAgreed()) {
      this.setData({ privacy: true })
    } else {
      this.enter()
    }
  },
  onShow() {
    // 从「隐私政策」页（gate 态）同意返回后，继续进入
    if (this.data.privacy && store.isPrivacyAgreed()) {
      this.setData({ privacy: false })
      this.enter()
    }
  },
  // 隐私已同意：登录并根据身份路由
  enter() {
    this.setData({ loading: true })
    flow.ensureLogin()
      .then((s) => {
        if (s.isMember && s.familyId) {
          flow.routeAfterLogin()
        } else {
          this.setData({ landing: true, loading: false })
        }
      })
      .catch(() => this.setData({ landing: true, loading: false }))
  },
  onAgreePrivacy() {
    store.setPrivacyAgreed(true)
    this.setData({ privacy: false, privacyWarn: false })
    this.enter()
  },
  onRefusePrivacy() {
    this.setData({ privacyWarn: true })
  },
  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy?mode=gate' })
  },
  noop() {},
  // 创建家庭：对照原型「底部滑出弹层」交互，不用系统 showModal
  onCreate() {
    this.setData({ createSheet: true, createName: '', creating: false })
  },
  closeCreate() {
    if (this.data.creating) return
    this.setData({ createSheet: false })
  },
  onNameInput(e) {
    this.setData({ createName: e.detail.value })
  },
  onNameFocus() { this.setData({ inputFocused: true }) },
  onNameBlur() { this.setData({ inputFocused: false }) },
  confirmCreate() {
    if (this.data.creating) return
    const name = (this.data.createName || '').trim() || '流年小账'
    this.setData({ creating: true })
    api.createFamily(name)
      .then(() => flow.ensureLogin())
      .then(() => flow.routeAfterLogin())
      .catch((e) => {
        this.setData({ creating: false })
        wx.showToast({ title: e.message || '创建失败', icon: 'none' })
      })
  },
  // 演示：直接体验示例账本（以创建者身份）
  onDemo() {
    this.setData({ loading: true })
    flow.demoSeed()
      .then(() => flow.routeAfterLogin())
      .catch((e) => { this.setData({ loading: false }); wx.showToast({ title: e.message || '失败', icon: 'none' }) })
  },
  // 首启页「加入已有家庭」：原型演示逻辑，模拟点开家人发来的邀请卡片
  onJoinDemo() {
    wx.showToast({ title: '已模拟点开家人发来的邀请卡片', icon: 'none' })
    setTimeout(() => {
      this.setData({ loading: true })
      flow.demoSeed()
        .then(() => flow.switchIdentity('o_guest'))
        .then(() => {
          this.setData({ loading: false })
          wx.navigateTo({ url: '/pages/invite/confirm?token=INV_DEMO_TOKEN' })
        })
        .catch((e) => { this.setData({ loading: false }); wx.showToast({ title: e.message || '失败', icon: 'none' }) })
    }, 900)
  }
})
