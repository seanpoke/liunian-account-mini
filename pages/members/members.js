// pages/members/members.js
const store = require('../../utils/store')
const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: { members: [], pending: [], isOwner: false, me: '' },
  onShow() { this.load() },
  load() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    this.setData({ isOwner: s.role === 'owner', me: s.openid })
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
          : (jd ? '加入于 ' + jd : '家庭成员')
        return Object.assign({}, m, {
          initial: (m.nickname || '?').slice(0, 1),
          bg: fmt.avGrad(m.color || '#07C160'),
          displayName: isSelf ? m.nickname + '（我）' : m.nickname,
          sub
        })
      })
      const pending = (pend || []).map(p => {
        const at = (p.applyAt || '').slice(0, 16)
        return Object.assign({}, p, {
          initial: (p.nickname || '?').slice(0, 1),
          bg: fmt.avGrad(p.color || '#bfbfbf'),
          sub: '来自「' + (ownerName || '家人') + '」的邀请 · ' + at.replace('T', ' ')
        })
      })
      this.setData({ members, pending })
    }).catch(() => {})
  },
  tapMember(e) {
    const id = e.currentTarget.dataset.id
    const m = this.data.members.find(x => x.memberId === id)
    if (!m) return
    const isSelf = m.openid === this.data.me
    if (isSelf) {
      wx.navigateTo({ url: '/pages/profile/profile' })
      return
    }
    if (!this.data.isOwner) { wx.showToast({ title: '无管理权限', icon: 'none' }); return }
    const itemList = ['转让创建者', '移出家庭']
    wx.showActionSheet({
      itemList,
      success: (r) => {
        if (r.tapIndex === 0) this.transfer(m)
        else if (r.tapIndex === 1) this.remove(m)
      }
    })
  },
  transfer(m) {
    wx.showModal({
      title: '转让创建者', content: '将创建者身份转让给「' + m.nickname + '」？',
      success: (r) => {
        if (!r.confirm) return
        api.transferOwner(store.getSession().familyId, m.openid)
          .then(() => { this.load(); wx.showToast({ title: '已转让', icon: 'success' }) })
          .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },
  remove(m) {
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
  approve(e) {
    const id = e.currentTarget.dataset.id
    api.approveMember(store.getSession().familyId, id)
      .then(() => { this.load(); wx.showToast({ title: '已通过', icon: 'success' }) })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  reject(e) {
    const id = e.currentTarget.dataset.id
    api.rejectMember(store.getSession().familyId, id)
      .then(() => { this.load(); wx.showToast({ title: '已拒绝', icon: 'success' }) })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  invite() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    wx.showLoading({ title: '生成中' })
    api.createInvitation(s.familyId, 'share').then((res) => {
      wx.hideLoading()
      wx.setClipboardData({
        data: '/pages/invite/confirm?token=' + res.token,
        success: () => wx.showToast({ title: '邀请链接已复制', icon: 'success' })
      })
    }).catch((e) => {
      wx.hideLoading()
      wx.showToast({ title: e.message, icon: 'none' })
    })
  }
})
