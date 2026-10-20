// pages/privacy/privacy.js
const store = require('../../utils/store')
const api = require('../../utils/api')

function statusBar() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  return info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20)
}
Page({
  data: { statusBarHeight: 20, mode: 'settings' },
  onLoad(q) { this.setData({ statusBarHeight: statusBar(), mode: q.mode || 'settings' }) },
  agree() {
    store.setPrivacyAgreed(1)
    // 已登录时同步服务端（POST /user/privacy），避免换设备后又弹一次
    const s = store.getSession()
    if (s && s.token) api.submitPrivacy(true).catch(() => {})
    wx.navigateBack()
  }
})
