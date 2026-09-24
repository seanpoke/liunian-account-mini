// pages/privacy/privacy.js
const store = require('../../utils/store')
function statusBar() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  return info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20)
}
Page({
  data: { statusBarHeight: 20, mode: 'settings' },
  onLoad(q) { this.setData({ statusBarHeight: statusBar(), mode: q.mode || 'settings' }) },
  agree() {
    store.setPrivacyAgreed(1)
    wx.navigateBack()
  }
})
