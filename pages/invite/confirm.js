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
    inviterNickname: '', inviterInitial: '?', inviterBg: 'linear-gradient(135deg,#07C160,#0aa85a)',
    invalid: false, applied: false, alreadyMember: false,
    mask: true, loading: false, members: [], memberCount: 0,
    clockIcon: ICONS.clock
  },
  onLoad(query) {
    this.setData({ statusBarHeight: statusBar(), token: query.token || '' })
    const s = store.getSession()
    if (s && s.isMember && s.familyId) {
      this.setData({ mask: false, alreadyMember: true, familyName: '流年小账', familyInitial: '账' })
      return
    }
    if (!this.data.token) { this.setData({ mask: false, invalid: true }); return }
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
          inviterInitial: d.inviterInitial,
          inviterBg: fmt.avGrad(d.inviterColor || '#07C160')
        })
        this.loadMembers()
      })
      .catch(() => this.setData({ mask: false, invalid: true }))
  },
  loadMembers() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    api.getMembers(s.familyId).then(list => {
      const acts = (list || []).filter(m => m.status === 'active').slice(0, 5)
      this.setData({
        members: acts.map(m => ({ openid: m.openid, initial: (m.nickname || '?').slice(0, 1), bg: fmt.avGrad(m.color || '#07C160') })),
        memberCount: list.filter(m => m.status === 'active').length
      })
    }).catch(() => {})
  },
  // 阶段② → ③：提交加入申请（不等于立即加入）
  submitApply() {
    const s = store.getSession()
    const name = (s && s.nickname) ? s.nickname : '新成员'
    this.setData({ loading: true })
    api.applyInvitation(this.data.token, name)
      .then(() => this.setData({ applied: true, loading: false }))
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
        return api.getPending(fid).then(list => {
          const pend = list.find(p => p.applicantOpenid === applicant)
          if (!pend) throw new Error('未找到待审批申请')
          return api.approveMember(fid, pend.memberId)
        })
      })
      .then(() => flow.switchIdentity(applicant))
      .then(() => { this.setData({ mask: false }); wx.redirectTo({ url: '/pages/welcome/welcome?family=' + encodeURIComponent(famName) }) })
      .catch((e) => { this.setData({ mask: false }); wx.showToast({ title: e.message, icon: 'none' }) })
  },
  backHome() { wx.navigateBack() },
  enterHome() { wx.switchTab({ url: '/pages/index/index' }) }
})
