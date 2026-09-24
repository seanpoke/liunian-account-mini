// pages/profile/profile.js
const store = require('../../utils/store')
const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: { initial: '', bg: '', nickname: '', roleText: '' },
  onShow() {
    const s = store.getSession()
    if (!s) return
    this.setData({
      nickname: s.nickname || '我',
      initial: (s.nickname || '?').slice(0, 1),
      bg: fmt.avGrad(s.color || '#07C160'),
      roleText: s.role === 'owner' ? '家庭创建者' : '家庭成员'
    })
  },
  editName() {
    wx.showModal({
      title: '修改昵称', editable: true, placeholderText: '输入新昵称', content: this.data.nickname,
      success: (r) => {
        if (r.confirm && r.content.trim()) {
          this.setData({ nickname: r.content.trim(), initial: r.content.trim().slice(0, 1) })
        }
      }
    })
  },
  save() {
    if (!this.data.nickname.trim()) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return }
    api.updateMe({ nickname: this.data.nickname.trim() })
      .then(() => { wx.showToast({ title: '已保存', icon: 'success' }) })
      .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
  }
})
