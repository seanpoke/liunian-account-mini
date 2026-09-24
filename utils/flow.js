// utils/flow.js
// 登录与会话路由的通用流程。
const api = require('./api')
const store = require('./store')
const mock = require('./mock')

// 静默登录：wx.login 拿 code -> 服务端换 openid -> 写入本地会话
async function ensureLogin() {
  const code = await api.wxLogin()
  const data = await api.login(code)
  const prev = store.getSession() || {}
  const s = Object.assign({}, prev, {
    token: data.token,
    openid: data.openid,
    isMember: data.isMember,
    familyId: data.familyId,
    role: data.role,
    nickname: data.nickname
  })
  store.setSession(s)
  return s
}

// 演示：切换当前登录身份（仅 mock 模式有效）
function switchIdentity(openid) {
  mock.state.me = openid
  return ensureLogin()
}

// 根据登录态决定去往首页还是落地页
function routeAfterLogin() {
  const s = store.getSession()
  if (s && s.isMember && s.familyId) {
    wx.switchTab({ url: '/pages/index/index' })
  } else {
    wx.redirectTo({ url: '/pages/start/start' })
  }
}

// 演示：播种一份示例家庭（含邀请），便于体验「加入/审批」流程
function demoSeed() {
  mock.seedDemo()
  return ensureLogin()
}

module.exports = { ensureLogin, switchIdentity, routeAfterLogin, demoSeed }
