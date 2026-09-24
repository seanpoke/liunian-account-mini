// pages/about/about.js
Page({
  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy?mode=settings' })
  },
  goRate() {
    wx.showToast({ title: '感谢支持，请在应用商店评分', icon: 'none' })
  }
})
