// pages/settings/settings.js —— 完全对照 doc/家庭记账小程序原型.html「我的」页
const api = require('../../utils/api')
const store = require('../../utils/store')
const flow = require('../../utils/flow')
const fmt = require('../../utils/format')
const recordFlow = require('../../utils/record-flow')
const { chooseAvatarImage } = require('../../utils/upload')

const SHEET_EMPTY = { memberId: '', openid: '', nickname: '', avatarUrl: '', initial: '', bg: '', role: '', roleText: '', joinText: '', monthCount: 0, totalCount: 0 }

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
    familyId: '', familyAvatarUrl: '', familyAvatarError: false, memberAvatarUrl: '',
    members: [], pending: [], memberCount: 0, monthCount: 0, curIdentity: '',
    sheetShow: false,
    sheetMember: SHEET_EMPTY,
    sheetActions: { editSelf: false, transfer: false, remove: false, note: false },
    inviteShow: false,
    qrToken: '', qrImageUrl: '',
    qrMeta: { expireDays: 7, memberLimit: 10 },
    iconHouse: ICONS.house,
    iconShare: ICONS.share,
    iconCircle: ICONS.circle,
    sheetVisible: false, sheetEditId: '', sheetPreset: null,
    nameEditShow: false, nameEditTitle: '', nameEditValue: '', nameEditType: ''
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
      curIdentity: s.openid, familyId: s.familyId || '',
      memberAvatarUrl: fmt.imgUrl(s.avatar)
    })
    if (!s.familyId) return
    api.getFamily(s.familyId).then(f => this.setData({
      familyName: f.name,
      familyAvatarUrl: fmt.imgUrl(f.avatar),
      familyAvatarError: false
    })).catch(() => {})
    this.loadMembers()
  },
  loadMembers() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    const p1 = api.getMembers(s.familyId)
    const p2 = s.role === 'owner' ? api.getJoinRequests(s.familyId).catch(() => []) : Promise.resolve([])
    Promise.all([p1, p2]).then(([list, pend]) => {
      list = list || []
      const owner = list.find(m => m.role === 'owner')
      const ownerName = owner ? owner.nickname : ''
      // 新接口只返回真实成员，不再有 status 字段
      const members = list.map(m => {
        const isSelf = m.openid === s.openid
        const jd = m.joinedAt ? m.joinedAt.slice(0, 10) : ''
        const sub = m.role === 'owner'
          ? '家庭创建者 · ' + (jd ? jd + ' 创建家庭' : '')
          : (jd ? '加入于 ' + jd + ' · ' : '') + '本月记账 ' + (m.monthCount || 0) + ' 笔'
        return Object.assign({}, m, {
          initial: (m.nickname || '?').slice(0, 1),
          avatarUrl: fmt.imgUrl(m.avatar),
          bg: fmt.avGrad(m.color || '#07C160'),
          displayName: isSelf ? m.nickname + '（我）' : m.nickname,
          sub
        })
      })
      // 待审批：接口字段为 requestId（不再是 memberId）
      const pendList = (pend || []).map(p => {
        const at = (p.applyAt || '').slice(0, 16)
        const when = fmt.friendDate(at.slice(0, 10)) + ' ' + at.slice(11, 16)
        return Object.assign({}, p, {
          initial: (p.nickname || '?').slice(0, 1),
          avatarUrl: fmt.imgUrl(p.avatar),
          bg: fmt.avGrad(p.color || '#bfbfbf'),
          sub: (p.channel === 'self' ? '主动申请' : '邀请加入') + ' · ' + when
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
  // 多家庭：回到启动页重新选择（1 个家庭会自动进入）
  switchFamily() { wx.reLaunch({ url: '/pages/start/start' }) },

  // ---------- 家庭头像（仅创建者） ----------
  // 头像加载失败（CDN 403 / 图片已被删除等）→ 回落到默认家庭图标
  onFamilyAvatarError() {
    if (this.data.familyAvatarError) return
    this.setData({ familyAvatarError: true })
  },
  // 点击家庭头像：修改家庭名称 / 修改头像（与个人头像同一套交互）
  changeFamilyAvatar() {
    if (!this.data.isOwner) { wx.showToast({ title: '仅创建者可修改家庭信息', icon: 'none' }); return }
    wx.showActionSheet({
      itemList: ['修改家庭名称', '修改头像'],
      success: (r) => {
        if (r.tapIndex === 0) this._editFamilyName()
        else if (r.tapIndex === 1) this._pickFamilyAvatar()
      }
    })
  },
  // 家庭名称最多 10 个字符，由 prompt-dialog 的 maxlength 硬限制
  _editFamilyName() {
    if (!this.data.isOwner) { wx.showToast({ title: '仅创建者可修改家庭信息', icon: 'none' }); return }
    this.setData({
      nameEditShow: true,
      nameEditType: 'family',
      nameEditTitle: '修改家庭名称',
      nameEditValue: this.data.familyName || ''
    })
  },
  onNameCancel() {
    this.setData({ nameEditShow: false })
  },
  onNameConfirm(e) {
    const name = e.detail.value
    const type = this.data.nameEditType
    this.setData({ nameEditShow: false })
    if (type === 'family') this._saveFamilyName(name)
    else this._saveMyNickname(name)
  },
  _saveFamilyName(name) {
    const s = store.getSession()
    if (!s || !s.familyId) return
    if (name === this.data.familyName) return
    wx.showLoading({ title: '保存中' })
    api.updateFamily(s.familyId, { name })
      .then((f) => {
        wx.hideLoading()
        this.setData({ familyName: (f && f.name) || name })
        wx.showToast({ title: '已更新', icon: 'success' })
      })
      .catch((e) => { wx.hideLoading(); wx.showToast({ title: e.message || '操作失败', icon: 'none' }) })
  },
  _saveMyNickname(name) {
    if (name === this.data.nickname) return
    wx.showLoading({ title: '保存中' })
    api.updateMe({ nickname: name })
      .then(() => {
        const s = store.getSession() || {}
        store.setSession(Object.assign({}, s, { nickname: name }))
        wx.hideLoading()
        this.load()
        wx.showToast({ title: '已更新', icon: 'success' })
      })
      .catch((e) => { wx.hideLoading(); wx.showToast({ title: e.message, icon: 'none' }) })
  },
  _pickFamilyAvatar() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    chooseAvatarImage((path) => {
      if (!path) { wx.showToast({ title: '头像处理失败，请重试', icon: 'none' }); return }
      wx.showLoading({ title: '上传中' })
      api.upload(path, s.familyId)
        .then(d => api.updateFamily(s.familyId, { avatar: d.url }).then(f => (f && f.avatar) || d.url))
        .then((avatar) => {
          wx.hideLoading()
          this.setData({ familyAvatarUrl: fmt.imgUrl(avatar), familyAvatarError: false })
          wx.showToast({ title: '已更新', icon: 'success' })
        })
        .catch((e) => { wx.hideLoading(); wx.showToast({ title: e.message || '上传失败', icon: 'none' }) })
    })
  },
  // ---------- 成员操作弹层 ----------
  tapMember(e) {
    const id = e.currentTarget.dataset.id
    const m = this.data.members.find(x => x.memberId === id || String(x.memberId) === String(id))
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
    wx.showActionSheet({
      itemList: ['修改昵称', '修改头像'],
      success: (r) => {
        if (r.tapIndex === 0) this._editMyNickname(m)
        else if (r.tapIndex === 1) this._changeMyAvatar()
      }
    })
  },
  _editMyNickname(m) {
    this.setData({
      nameEditShow: true,
      nameEditType: 'member',
      nameEditTitle: '修改我的昵称',
      nameEditValue: (m && m.nickname) || this.data.nickname || ''
    })
  },
  // 头像走 /upload → PATCH /user/me（全局同步到所有家庭的成员资料）
  _changeMyAvatar() {
    const s = store.getSession()
    if (!s) return
    chooseAvatarImage((path) => {
      if (!path) { wx.showToast({ title: '头像处理失败，请重试', icon: 'none' }); return }
      let uploaded = ''
      wx.showLoading({ title: '上传中' })
      api.upload(path, s.familyId)
        .then(d => { uploaded = d.url; return api.updateMe({ avatar: uploaded }) })
        .then(() => {
          // 以服务端返回地址为准（线上是 CDN 绝对地址），回读失败时用上传地址兜底
          return api.getUserMe().catch(() => null).then((me) => {
            const cur = store.getSession() || {}
            store.setSession(Object.assign({}, cur, { avatar: (me && me.avatar) || uploaded }))
          })
        })
        .then(() => {
          wx.hideLoading()
          this.load()
          this.loadMembers()
          wx.showToast({ title: '已更新', icon: 'success' })
        })
        .catch((e) => { wx.hideLoading(); wx.showToast({ title: e.message || '上传失败', icon: 'none' }) })
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
      title: '移出家庭',
      content: '将「' + m.nickname + '」移出家庭？其在该家庭的账目将作废（数据保留但不计入统计）。',
      success: (r) => {
        if (!r.confirm) return
        api.removeMember(store.getSession().familyId, m.memberId)
          .then(() => { this.loadMembers(); wx.showToast({ title: '已移出', icon: 'success' }) })
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
  // 退出家庭（接口文档 §16）：
  // 仅剩本人 → 整户解散；还有其他成员 → 本人流水作废 + 成员行物理删除；创建者自动转让
  tapQuit() {
    const alone = this.data.memberCount <= 1
    const content = this.data.isOwner
      ? (alone
        ? '家庭仅你一人，退出后该家庭及全部账单数据将被删除，不可恢复'
        : '你是创建者，退出后创建者身份将自动转让给最早加入的成员；你本人在该家庭的账目将作废（不计入统计）')
      : '退出后你本人在该家庭的账目将作废（不计入统计），需重新被邀请才能加入'
    wx.showModal({
      title: '退出家庭', content,
      success: (r) => {
        if (!r.confirm) return
        api.quitFamily(store.getSession().familyId)
          .then(() => {
            wx.showToast({ title: '已退出', icon: 'success' })
            setTimeout(() => wx.reLaunch({ url: '/pages/start/start' }), 600)
          })
          .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },
  // 解散家庭：仅创建者（接口文档 §36），删除家庭及全部关联数据
  tapDissolve() {
    if (!this.data.isOwner) { wx.showToast({ title: '仅创建者可解散家庭', icon: 'none' }); return }
    wx.showModal({
      title: '解散家庭',
      content: '解散后「' + (this.data.familyName || '该家庭') + '」的全部账单、成员、邀请、分类与预算数据将被永久删除，不可恢复。确定解散？',
      confirmColor: '#fa5151',
      success: (r) => {
        if (!r.confirm) return
        api.dissolveFamily(store.getSession().familyId)
          .then(() => {
            wx.showToast({ title: '已解散', icon: 'success' })
            setTimeout(() => wx.reLaunch({ url: '/pages/start/start' }), 600)
          })
          .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },
  // 审批：新接口路径 /join-request/{requestId}/approve|reject
  approve(e) {
    const id = e.currentTarget.dataset.id
    api.approveJoinRequest(store.getSession().familyId, id)
      .then(() => { this.loadMembers(); wx.showToast({ title: '已通过', icon: 'success' }) })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  reject(e) {
    const id = e.currentTarget.dataset.id
    api.rejectJoinRequest(store.getSession().familyId, id)
      .then(() => { this.loadMembers(); wx.showToast({ title: '已拒绝', icon: 'success' }) })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  // ---------- 邀请弹层 ----------
  invite() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    wx.showLoading({ title: '生成中' })
    // type=qr：返回小程序码 qrImageUrl（当前仅支持扫码加入，不返回 urlLink）
    api.createInvitation(s.familyId, 'qr').then((d) => {
      wx.hideLoading()
      this._shareToken = d.token
      const expireDays = d.expireDays != null ? d.expireDays : expireDaysAt(d.expireAt)
      this.setData({
        inviteShow: true,
        qrToken: d.token, qrImageUrl: d.qrImageUrl || '',
        qrMeta: { expireDays, memberLimit: d.memberLimit || 10 }
      })
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ hidden: true })
      }
    }).catch((e) => {
      wx.hideLoading()
      wx.showToast({ title: e.message, icon: 'none' })
    })
  },
  closeInvite() {
    this.setData({ inviteShow: false })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ hidden: false })
    }
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
      const m = url.match(/^data:image\/(png|jpe?g|svg\+xml);base64,(.*)/)
      if (!m) { wx.showToast({ title: '二维码格式不支持保存', icon: 'none' }); return }
      const type = m[1]
      const b64 = m[2]
      // 该 data URI 实际可能是 JPEG 体（头部 /9j/），按内容推断真实扩展名，避免保存后打不开
      const realExt = /^(\/9j\/|ffd8ff)/i.test(b64) ? 'jpg' : (type.indexOf('svg') > -1 ? 'svg' : 'png')
      if (realExt === 'svg') {
        wx.showToast({ title: '演示二维码不支持保存', icon: 'none' })
        return
      }
      const fs = wx.getFileSystemManager()
      const filePath = wx.env.USER_DATA_PATH + '/qr_' + Date.now() + '.' + realExt
      fs.writeFile({
        filePath, data: b64, encoding: 'base64',
        success: () => save(filePath),
        fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
      })
      return
    }
    wx.downloadFile({
      url,
      success: (r) => save(r.tempFilePath),
      fail: () => wx.showToast({ title: '下载失败', icon: 'none' })
    })
  },
  onShareAppMessage() {
    if (this._shareToken) {
      return { title: '「流年小账」邀请你一起记账', path: '/pages/invite/confirm?token=' + this._shareToken }
    }
    return { title: '流年小账', path: '/pages/start/start' }
  },
  // 新建：先到全屏分类选择页；编辑：直接打开弹层
  showRecordSheet(id) { recordFlow.start(this, id) },
  onSheetClose() {
    this.setData({ sheetVisible: false })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  },
  onSheetSaved() {
    this.setData({ sheetVisible: false }); this.load(); this.loadMembers()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  }
})
