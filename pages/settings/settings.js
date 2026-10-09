// pages/settings/settings.js —— 完全对照 doc/家庭记账小程序原型.html「我的」页
const api = require('../../utils/api')
const store = require('../../utils/store')
const flow = require('../../utils/flow')
const fmt = require('../../utils/format')

const SHEET_EMPTY = { memberId: '', openid: '', nickname: '', initial: '', bg: '', role: '', roleText: '', joinText: '', monthCount: 0, totalCount: 0 }

function statusBar() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  return info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20)
}

// 由文档 §8 的 expireAt(ISO) 推导剩余有效天数；后端若直接返回 expireDays 则优先使用
function expireDaysAt(expireAt) {
  if (!expireAt) return 7
  const t = new Date(String(expireAt).replace(' ', 'T')).getTime()
  if (isNaN(t)) return 7
  return Math.max(1, Math.round((t - Date.now()) / 86400000))
}

// 原型中的线条图标（小程序不支持内联 svg，用 image + data-uri 还原）
function svgUri(svg) {
  const bytes = new Uint8Array(svg.length)
  for (let i = 0; i < svg.length; i++) bytes[i] = svg.charCodeAt(i)
  return 'data:image/svg+xml;base64,' + wx.arrayBufferToBase64(bytes.buffer)
}
const ICONS = {
  house: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 10.4 12 4.2l8 6.2V19a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 19z" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.6 20.4v-5.2h4.8v5.2" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>'),
  share: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 8.4h14M5 8.4v9.2a1.6 1.6 0 0 0 1.6 1.6h10.8a1.6 1.6 0 0 0 1.6-1.6V8.4M5 8.4l1.5-3.2A1.6 1.6 0 0 1 8 4.2h8a1.6 1.6 0 0 1 1.5 1l1.5 3.2" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/><circle cx="15.6" cy="13.6" r="1.1" fill="#fff"/></svg>'),
  circle: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#c0c0c0" stroke-width="2"/></svg>')
}

Page({
  data: {
    statusBarHeight: 20,
    nickname: '', role: '', isOwner: false, familyName: '', ownerName: '',
    members: [], pending: [], memberCount: 0, monthCount: 0, curIdentity: '',
    sheetShow: false,
    sheetMember: SHEET_EMPTY,
    sheetActions: { editSelf: false, transfer: false, remove: false, note: false },
    inviteShow: false,
    inviteTab: 'share',
    inviteSent: false,
    shareToken: '', qrToken: '', qrImageUrl: '',
    shareMeta: { expireDays: 1 },
    qrMeta: { expireDays: 7, memberLimit: 10 },
    iconHouse: ICONS.house,
    iconShare: ICONS.share,
    iconCircle: ICONS.circle,
    sheetVisible: false, sheetEditId: ''
  },
  onLoad() {
    this.setData({ statusBarHeight: statusBar() })
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    this.load()
  },
  load() {
    const s = store.getSession()
    if (!s) return
    this.setData({
      nickname: s.nickname || '我', role: s.role, isOwner: s.role === 'owner',
      curIdentity: s.openid
    })
    if (!s.familyId) return
    api.getFamily(s.familyId).then(f => this.setData({ familyName: f.name })).catch(() => {})
    this.loadMembers()
  },
  loadMembers() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    const p1 = api.getMembers(s.familyId)
    const p2 = s.role === 'owner' ? api.getPending(s.familyId).catch(() => []) : Promise.resolve([])
    Promise.all([p1, p2]).then(([list, pend]) => {
      const owner = list.find(m => m.role === 'owner')
      const ownerName = owner ? owner.nickname : ''
      const members = list.filter(m => m.status === 'active').map(m => {
        const isSelf = m.openid === s.openid
        const jd = m.joinedAt ? m.joinedAt.slice(0, 10) : ''
        const sub = m.role === 'owner'
          ? '家庭创建者 · ' + (jd ? jd + ' 创建家庭' : '')
          : (jd ? '加入于 ' + jd + ' · ' : '') + '本月记账 ' + m.monthCount + ' 笔'
        return Object.assign({}, m, {
          initial: (m.nickname || '?').slice(0, 1),
          bg: fmt.avGrad(m.color || '#07C160'),
          displayName: isSelf ? m.nickname + '（我）' : m.nickname,
          sub
        })
      })
      const pendList = (pend || []).map(p => {
        const at = (p.applyAt || '').slice(0, 16)
        const when = fmt.friendDate(at.slice(0, 10)) + ' ' + at.slice(11, 16)
        return Object.assign({}, p, {
          initial: (p.nickname || '?').slice(0, 1),
          bg: fmt.avGrad(p.color || '#bfbfbf'),
          sub: '来自「' + (ownerName || '家人') + '」的邀请 · ' + when
        })
      })
      const monthCount = members.reduce((a, m) => a + (m.monthCount || 0), 0)
      this.setData({
        members, pending: pendList, memberCount: members.length, monthCount,
        ownerName
      })
    }).catch(() => {})
  },
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy?mode=settings' }) },
  // ---------- 成员操作弹层 ----------
  tapMember(e) {
    const id = e.currentTarget.dataset.id
    const m = this.data.members.find(x => x.memberId === id)
    if (!m) return
    const isSelf = m.openid === this.data.curIdentity
    const roleText = m.role === 'owner' ? '家庭创建者' : '家庭成员'
    const jd = m.joinedAt ? m.joinedAt.slice(0, 10) : ''
    const joinText = m.role === 'owner'
      ? (jd ? ' · ' + jd + ' 创建家庭' : '')
      : (jd ? ' · ' + jd + ' 加入' : '')
    const sheetMember = Object.assign({}, m, { roleText, joinText })
    const actions = { editSelf: false, transfer: false, remove: false, note: false }
    if (isSelf) actions.editSelf = true
    else if (this.data.isOwner) { actions.transfer = true; actions.remove = true }
    else actions.note = true
    this.setData({ sheetShow: true, sheetMember, sheetActions: actions })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ hidden: true })
    }
  },
  closeMemberSheet() {
    this.setData({ sheetShow: false })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ hidden: false })
    }
  },
  editSelf() {
    const m = this.data.sheetMember
    this.closeMemberSheet()
    wx.showModal({
      title: '修改我的昵称', editable: true, placeholderText: '输入新昵称', content: m.nickname,
      success: (r) => {
        if (!r.confirm || !r.content.trim()) return
        api.updateMe({ nickname: r.content.trim() })
          .then(() => { this.load(); wx.showToast({ title: '已更新', icon: 'success' }) })
          .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },
  transfer() {
    const m = this.data.sheetMember
    this.closeMemberSheet()
    wx.showModal({
      title: '转让创建者', content: '将创建者身份转让给「' + m.nickname + '」？',
      success: (r) => {
        if (!r.confirm) return
        api.transferOwner(store.getSession().familyId, m.openid)
          .then(() => flow.ensureLogin())
          .then(() => { this.load(); wx.showToast({ title: '已转让', icon: 'success' }) })
          .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },
  remove() {
    const m = this.data.sheetMember
    this.closeMemberSheet()
    wx.showModal({
      title: '移出家庭', content: '将「' + m.nickname + '」移出，其历史记录保留',
      success: (r) => {
        if (!r.confirm) return
        api.removeMember(store.getSession().familyId, m.memberId)
          .then(() => { this.load(); wx.showToast({ title: '已移出', icon: 'success' }) })
          .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },
  // ---------- 家庭设置：转让 / 退出 ----------
  tapTransfer() {
    if (!this.data.isOwner) { wx.showToast({ title: '仅创建者可转让', icon: 'none' }); return }
    const others = this.data.members.filter(m => m.role !== 'owner')
    if (!others.length) { wx.showToast({ title: '没有其他成员可接收', icon: 'none' }); return }
    wx.showActionSheet({
      itemList: others.map(m => m.nickname),
      success: (r) => {
        const m = others[r.tapIndex]
        wx.showModal({
          title: '转让创建者', content: '将创建者身份转让给「' + m.nickname + '」？',
          success: (rr) => {
            if (!rr.confirm) return
            api.transferOwner(store.getSession().familyId, m.openid)
              .then(() => flow.ensureLogin())
              .then(() => { this.load(); wx.showToast({ title: '已转让', icon: 'success' }) })
              .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
          }
        })
      }
    })
  },
  tapQuit() {
    if (this.data.isOwner) {
      wx.showToast({ title: '请先转让创建者再退出', icon: 'none' })
      return
    }
    wx.showModal({
      title: '退出家庭', content: '退出后你将无法查看账本，需重新被邀请',
      success: (r) => {
        if (!r.confirm) return
        api.quitFamily(store.getSession().familyId)
          .then(() => flow.ensureLogin())
          .then(() => { wx.showToast({ title: '已退出', icon: 'success' }); setTimeout(() => flow.routeAfterLogin(), 500) })
          .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },
  approve(e) {
    const id = e.currentTarget.dataset.id
    api.approveMember(store.getSession().familyId, id)
      .then(() => { this.loadMembers(); wx.showToast({ title: '已通过', icon: 'success' }) })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  reject(e) {
    const id = e.currentTarget.dataset.id
    api.rejectMember(store.getSession().familyId, id)
      .then(() => { this.loadMembers(); wx.showToast({ title: '已拒绝', icon: 'success' }) })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  // ---------- 邀请弹层 ----------
  invite() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    wx.showLoading({ title: '生成中' })
    Promise.all([
      api.createInvitation(s.familyId, 'share'),
      api.createInvitation(s.familyId, 'qr')
    ]).then(([share, qr]) => {
      wx.hideLoading()
      this._shareToken = share.token
      this._qrToken = qr.token
      this.setData({
        inviteShow: true, inviteTab: 'share', inviteSent: false,
        shareToken: share.token, qrToken: qr.token, qrImageUrl: qr.qrImageUrl || '',
        shareMeta: { expireDays: share.expireDays != null ? share.expireDays : expireDaysAt(share.expireAt) },
        qrMeta: { expireDays: qr.expireDays != null ? qr.expireDays : expireDaysAt(qr.expireAt), memberLimit: qr.memberLimit || 10 }
      })
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ hidden: true })
      }
    }).catch((e) => {
      wx.hideLoading()
      wx.showToast({ title: e.message, icon: 'none' })
    })
  },
  switchInviteTab(e) {
    this.setData({ inviteTab: e.currentTarget.dataset.tab })
  },
  closeInvite() {
    this.setData({ inviteShow: false })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ hidden: false })
    }
  },
  sendInvite() {
    if (this.data.inviteSent) { this.closeInvite(); return }
    this.setData({ inviteSent: true })
    wx.showToast({ title: '邀请卡片已发送给微信好友', icon: 'success' })
    setTimeout(() => this.closeInvite(), 1700)
  },
  copyInviteLink() {
    const token = this.data.inviteTab === 'share' ? this.data.shareToken : this.data.qrToken
    wx.setClipboardData({
      data: '/pages/invite/invite?token=' + token,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },
  saveQr() {
    const url = this.data.qrImageUrl
    if (!url) { wx.showToast({ title: '二维码无效', icon: 'none' }); return }
    const save = (filePath) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => wx.showToast({ title: '已保存', icon: 'success' }),
        fail: (e) => {
          if (e.errMsg && e.errMsg.indexOf('auth deny') > -1) {
            wx.showModal({ title: '授权提示', content: '需要保存图片权限', showCancel: false })
          } else {
            wx.showToast({ title: '保存失败', icon: 'none' })
          }
        }
      })
    }
    if (url.indexOf('data:image') === 0) {
      const match = url.match(/^data:image\/svg\+xml;base64,(.*)/)
      if (match) {
        const fs = wx.getFileSystemManager()
        const filePath = wx.env.USER_DATA_PATH + '/qr_' + Date.now() + '.svg'
        fs.writeFile({
          filePath, data: match[1], encoding: 'base64',
          success: () => save(filePath),
          fail: () => wx.showToast({ title: '演示二维码不支持保存', icon: 'none' })
        })
        return
      }
    }
    wx.downloadFile({
      url,
      success: (r) => save(r.tempFilePath),
      fail: () => wx.showToast({ title: '下载失败', icon: 'none' })
    })
  },
  onShareAppMessage() {
    if (this._shareToken) {
      return { title: '「流年小账」邀请你一起记账', path: '/pages/invite/invite?token=' + this._shareToken }
    }
    return { title: '流年小账', path: '/pages/start/start' }
  },
  // 底部「＋」记账弹层（与首页/明细一致的就地弹层效果）
  showRecordSheet(id) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: true })
    this.setData({ sheetVisible: true, sheetEditId: id || '' })
  },
  onSheetClose() {
    this.setData({ sheetVisible: false })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  },
  onSheetSaved() {
    this.setData({ sheetVisible: false }); this.load(); this.loadMembers()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  }
})
