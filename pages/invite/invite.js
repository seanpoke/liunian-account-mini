// pages/invite/invite.js —— 旧深链入口，统一转发到 confirm 落地页（保持旧链接/二维码兼容）。
Page({
  onLoad(query) {
    const q = query || {}
    let url = '/pages/invite/confirm'
    if (q.token) url += '?token=' + encodeURIComponent(q.token)
    wx.redirectTo({ url })
  }
})
