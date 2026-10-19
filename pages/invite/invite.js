// pages/invite/invite.js —— 深链/小程序码统一入口，转发到 confirm 落地页。
// 注意：小程序码（getwxacodeunlimit）走 scene 传参，URL 链接/Scheme 走 token 路径参数，两者都要兼容。
Page({
  onLoad(query) {
    const q = query || {}
    let token = q.token
    if (!token && q.scene) {
      // 小程序码（getwxacodeunlimit）经 scene 传参，需解码
      token = decodeURIComponent(q.scene)
    }
    if (!token || token === 'undefined') {
      wx.showToast({ title: '邀请参数缺失', icon: 'none' })
      return
    }
    wx.redirectTo({ url: '/pages/invite/confirm?token=' + encodeURIComponent(token) })
  }
})
