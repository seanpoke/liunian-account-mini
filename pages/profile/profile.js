// pages/profile/profile.js
const store = require('../../utils/store')
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const { chooseAvatarImage } = require('../../utils/upload')

Page({
  data: { initial: '', bg: '', avatarUrl: '', nickname: '', roleText: '', nameEditShow: false, nameEditValue: '' },
  onShow() {
    const s = store.getSession()
    if (!s) return
    this.setData({
      nickname: s.nickname || '我',
      initial: (s.nickname || '?').slice(0, 1),
      bg: fmt.avGrad('#07C160'),
      avatarUrl: fmt.imgUrl(s.avatar),
      roleText: s.role === 'owner' ? '家庭创建者' : '家庭成员'
    })
    // 以服务端全局资料为准刷新一次（头像/昵称可能在其他设备改过）
    api.getUserMe().then((me) => {
      if (!me) return
      const cur = store.getSession() || {}
      store.setSession(Object.assign({}, cur, {
        nickname: me.nickname || cur.nickname,
        avatar: me.avatar || ''
      }))
      const name = me.nickname || this.data.nickname
      this.setData({
        nickname: name,
        initial: (name || '?').slice(0, 1),
        avatarUrl: fmt.imgUrl(me.avatar)
      })
    }).catch(() => {})
  },
  // 头像：选图 → 压到 200px → POST /upload → PATCH /user/me
  changeAvatar() {
    const s = store.getSession()
    chooseAvatarImage((path) => {
      if (!path) { wx.showToast({ title: '头像处理失败，请重试', icon: 'none' }); return }
      let uploaded = ''
      wx.showLoading({ title: '上传中' })
      api.upload(path, s && s.familyId)
        .then(d => { uploaded = d.url; return api.updateMe({ avatar: uploaded }) })
        .then(() => api.getUserMe().catch(() => null))
        .then((me) => {
          // 服务端回读优先；回读失败时用刚上传的地址兜底
          const av = (me && me.avatar) || uploaded
          const cur = store.getSession() || {}
          store.setSession(Object.assign({}, cur, { avatar: av }))
          this.setData({ avatarUrl: fmt.imgUrl(av) })
          wx.hideLoading()
          wx.showToast({ title: '已更新', icon: 'success' })
        })
        .catch((e) => { wx.hideLoading(); wx.showToast({ title: e.message || '上传失败', icon: 'none' }) })
    })
  },
  // 昵称最多 10 个字符，由 prompt-dialog 的 maxlength 硬限制
  editName() {
    this.setData({ nameEditShow: true, nameEditValue: this.data.nickname })
  },
  onNameCancel() {
    this.setData({ nameEditShow: false })
  },
  onNameConfirm(e) {
    const name = e.detail.value
    this.setData({ nameEditShow: false, nickname: name, initial: name.slice(0, 1) })
  },
  save() {
    if (!this.data.nickname.trim()) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return }
    const name = this.data.nickname.trim()
    api.updateMe({ nickname: name })
      .then(() => {
        const s = store.getSession() || {}
        store.setSession(Object.assign({}, s, { nickname: name }))
        wx.showToast({ title: '已保存', icon: 'success' })
      })
      .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
  }
})
