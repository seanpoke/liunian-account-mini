// pages/welcome/welcome.js
const api = require('../../utils/api')
const store = require('../../utils/store')
const fmt = require('../../utils/format')

function statusBar() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  return info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20)
}
function svgUri(svg) {
  const bytes = new Uint8Array(svg.length)
  for (let i = 0; i < svg.length; i++) bytes[i] = svg.charCodeAt(i)
  return 'data:image/svg+xml;base64,' + wx.arrayBufferToBase64(bytes.buffer)
}
const ICONS = {
  check: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 12.6l4.4 4.4L19 7.4" fill="none" stroke="#07C160" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>')
}

Page({
  data: { statusBarHeight: 20, family: '流年小账', avatars: [], checkIcon: ICONS.check },
  onLoad(q) {
    this.setData({ statusBarHeight: statusBar(), family: (q.family ? decodeURIComponent(q.family) : '流年小账') })
    const s = store.getSession()
    if (s && s.familyId) {
      api.getMembers(s.familyId)
        .then(list => {
          const acts = (list || []).slice(0, 5)
          this.setData({
            avatars: acts.map(m => ({
              openid: m.openid,
              url: fmt.imgUrl(m.avatar),
              initial: (m.nickname || '?').slice(0, 1),
              color: fmt.avGrad(m.color || '#07C160')
            }))
          })
        })
        .catch(() => {})
    }
  },
  enterHome() { wx.switchTab({ url: '/pages/index/index' }) }
})
