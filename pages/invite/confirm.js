// pages/invite/confirm.js —— 扫码落地页（深链）。严格对照 doc/邀请确认页落地动效.html 五阶段：
// ① 校验中 loader → ② 邀请确认页 → ③ 等待创建者确认 → ④ 通过后进入欢迎页（welcome）。
const api = require('../../utils/api')
const store = require('../../utils/store')
const flow = require('../../utils/flow')
const fmt = require('../../utils/format')

function statusBar() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  return info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20)
}
function svgUri(svg) {
  const bytes = new Uint8Array(svg.length)
  for (let i = 0; i < svg.length; i++) bytes[i] = svg.charCodeAt(i)
  return 'data:image/svg+xml;base64,' + wx.arrayBufferToBase64(bytes.buffer)
}
const ICONS = {
  clock: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#07C160" stroke-width="1.8" opacity=".3"/><path d="M12 7.6V12l3.1 1.9" fill="none" stroke="#07C160" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')
}

Page({
  data: {
    statusBarHeight: 20,
    token: '', familyName: '', familyInitial: '账',
    inviterNickname: '', inviterInitial: '?', inviterAvatarUrl: '', inviterBg: 'linear-gradient(135deg,#07C160,#0aa85a)',
    invalid: false, applied: false, alreadyMember: false,
    mask: true, loading: false, members: [], memberCount: 0, applyNickname: '',
    clockIcon: ICONS.clock
  },
  onLoad(query) {
    const q = query || {}
    let token = q.token
    if (!token && q.scene) {
      // 小程序码（getwxacodeunlimit）经 scene 传参，需解码
      token = decodeURIComponent(q.scene)
    }
    if (token === 'undefined') token = ''
    console.log('confirm options =', q, 'token =', token)
    this.setData({ statusBarHeight: statusBar(), token: token || '' })

    // 经小程序码进入时 start 页不会执行，需在此静默登录拿 JWT，
    // 否则后续「提交加入申请」会因无 Authorization 被后端判 401 未登录。
    const s = store.getSession()
    if (!s || !s.token) {
      flow.ensureLogin().then(() => this._enter(token)).catch(() => this._enter(token))
    } else {
      this._enter(token)
    }
  },
  _enter(token) {
    // 有多家庭：即使已属于某个家庭，扫新家庭的邀请码也应允许申请，
    // 因此只要带 token 就必须走校验，由 applicationStatus 决定去向。
    if (!token) {
      const s = store.getSession()
      if (s && s.isMember && s.familyId) {
        this.setData({ mask: false, alreadyMember: true, familyName: '流年小账', familyInitial: '账' })
      } else {
        this.setData({ mask: false, invalid: true })
      }
      return
    }
    this.verify()
  },
  // 阶段①：校验 token（有效性 / 是否已加入）
  verify() {
    this.setData({ mask: true })
    api.getInvitation(this.data.token)
      .then((d) => {
        this.setData({
          mask: false,
          familyName: d.familyName,
          familyInitial: (d.familyName || '账').slice(0, 1),
          inviterNickname: d.inviterNickname,
          inviterInitial: (d.inviterNickname || '?').slice(0, 1),
          inviterAvatarUrl: fmt.imgUrl(d.inviterAvatar),
          inviterBg: fmt.avGrad('#07C160'),
          // 邀请响应不含成员列表，这里只展示邀请人头像
          members: d.inviterNickname ? [{
            openid: 'inviter',
            initial: (d.inviterNickname || '?').slice(0, 1),
            url: fmt.imgUrl(d.inviterAvatar),
            bg: fmt.avGrad('#07C160')
          }] : []
        })
        // 四态分支：依据「当前用户对该邀请的申请状态」决定去向
        // applicationStatus: none(未申请) | pending(待审批) | approved(已通过) | rejected(已拒绝)
        const appStatus = d.applicationStatus || 'none'
        if (appStatus === 'approved') {
          // 已审批通过 → 已是成员，写入会话并跳首页（状态①等价）
          const s = store.getSession() || {}
          store.setSession(Object.assign({}, s, { isMember: true, familyId: d.familyId }))
          this.setData({ alreadyMember: true })
          // 若会话已有昵称，同步回成员资料，保证家庭各视图一致
          if (s.nickname) api.updateMe({ nickname: s.nickname }).catch(() => {})
          this.enterHome()
          return
        }
        if (appStatus === 'pending') {
          // 已递交且未审批 → 直接进入等待审批页（状态③）
          this.setData({ applied: true })
        }
        // none / rejected → 邀请确认页（状态②），rejected 可重新提交申请
      })
      .catch(() => this.setData({ mask: false, invalid: true }))
  },
  // 阶段② → ③：提交加入申请（不等于立即加入）
  submitApply() {
    const s = store.getSession()
    // 昵称必填：优先用申请页填写的昵称，其次会话已存昵称；都不填则拦截
    const name = (this.data.applyNickname && this.data.applyNickname.trim()) ||
      (s && s.nickname && s.nickname.trim())
    if (!name) {
      wx.showToast({ title: '请先填写昵称', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    // avatar 可选：有全局头像就一并带上，后端会写入 join_request / 审批后的成员资料
    api.applyInvitation(this.data.token, name, (s && s.avatar) || undefined)
      .then(() => {
        // 把昵称写入会话并同步回成员资料，避免家庭其他视图显示默认名
        const sess = store.getSession() || {}
        store.setSession(Object.assign({}, sess, { nickname: name }))
        api.updateMe({ nickname: name }).catch(() => {})
        this.setData({ applied: true, loading: false })
      })
      .catch((e) => { this.setData({ loading: false }); wx.showToast({ title: e.message, icon: 'none' }) })
  },
  // 演示：模拟创建者已在另一设备审批通过，申请人进入欢迎页（阶段④）
  demoApprove() {
    const applicant = (store.getSession() && store.getSession().openid) || 'o_guest'
    const famName = this.data.familyName
    this.setData({ mask: true })
    flow.switchIdentity('o_owner')
      .then(() => {
        const fid = store.getSession().familyId
        return api.getJoinRequests(fid).then(list => {
          const pend = (list || []).find(p => p.applicantOpenid === applicant)
          if (!pend) throw new Error('未找到待审批申请')
          return api.approveJoinRequest(fid, pend.requestId)
        })
      })
      .then(() => flow.switchIdentity(applicant))
      .then(() => { this.setData({ mask: false }); wx.redirectTo({ url: '/pages/welcome/welcome?family=' + encodeURIComponent(famName) }) })
      .catch((e) => { this.setData({ mask: false }); wx.showToast({ title: e.message, icon: 'none' }) })
  },
  onApplyNickInput(e) {
    this.setData({ applyNickname: e.detail.value })
  },
  backHome() {
    // 经小程序码冷启动时页面栈只有 confirm 一页，navigateBack 无效，回到应用首页
    const pages = getCurrentPages()
    if (pages && pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/start/start' })
  },
  enterHome() { wx.switchTab({ url: '/pages/index/index' }) }
})
