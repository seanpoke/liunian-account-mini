// pages/start/start.js
const store = require('../../utils/store')
const flow = require('../../utils/flow')
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const { ENABLE_MOCK } = require('../../utils/config')

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
    nickName: '',
    createSheet: false,
    createName: '',
    creating: false,
    inputFocused: false,
    famList: [],
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
  loginExtra() {
    const n = (this.data.nickName || '').trim()
    return n ? { nickname: n } : undefined
  },
  enter() {
    this.setData({ loading: true })
    flow.ensureLogin(this.loginExtra())
      .then(() => this.routeByFamilies())
      .catch(() => this.setData({ landing: true, loading: false }))
  },
  // 首次进入统一路由：查 /families —— 0 个→落地页；1 个→直接进入；多个→列表选择（接口文档 §35）
  routeByFamilies() {
    return api.getFamilies().then((list) => {
      list = list || []
      if (!list.length) {
        this.setData({ landing: true, loading: false })
        return
      }
      if (list.length === 1) {
        this.pickFamily(list[0].familyId)
        return
      }
      this.setData({
        loading: false,
        famList: list.map((f) => Object.assign({}, f, {
          initial: (f.name || '?').slice(0, 1),
          avatarUrl: fmt.imgUrl(f.avatar),
          sub: (f.memberCount || 0) + ' 位成员' + (f.role === 'owner' ? ' · 我是创建者' : '')
        }))
      })
    }).catch(() => this.setData({ landing: true, loading: false }))
  },
  // 选定家庭：写入会话后进入账本
  pickFamily(fid) {
    const s = store.getSession() || {}
    store.setSession(Object.assign({}, s, { isMember: true, familyId: fid }))
    flow.routeAfterLogin()
  },
  tapFamily(e) {
    const fid = e.currentTarget.dataset.id
    if (!fid) return
    this.setData({ loading: true })
    this.pickFamily(fid)
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
  onNickInput(e) {
    this.setData({ nickName: e.detail.value })
  },
  onNameFocus() { this.setData({ inputFocused: true }) },
  onNameBlur() { this.setData({ inputFocused: false }) },
  confirmCreate() {
    if (this.data.creating) return
    const name = (this.data.createName || '').trim() || '流年小账'
    this.setData({ creating: true })
    api.createFamily(name)
      .then(() => flow.ensureLogin(this.loginExtra()))
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
    if (ENABLE_MOCK) {
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
      return
    }
    // 真实环境：加入家庭需由家人在微信会话中分享邀请卡片，点击卡片进入确认页
    wx.showToast({ title: '请打开家人分享的邀请卡片加入', icon: 'none' })
  }
})
