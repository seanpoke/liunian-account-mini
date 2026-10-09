// utils/flow.js
// 登录与会话路由的通用流程。
const api = require('./api')
const store = require('./store')
const mock = require('./mock')

// 静默登录：wx.login 拿 code -> 服务端换 openid -> 写入本地会话
// extra: 可选附加字段（如 { nickname }），随 /login 请求体一并传给后端写库
async function ensureLogin(extra) {
  const code = await api.wxLogin()
  const data = await api.login(code, extra)
  const prev = store.getSession() || {}
  const s = Object.assign({}, prev, {
    token: data.token,
    openid: data.openid,
    isMember: data.isMember,
    familyId: data.familyId
  })
  store.setSession(s) // 先持久化 token，便于后续带鉴权请求
  // 真实后端 /login 不返回 role / nickname，需从家庭成员列表补全
  if (data.isMember && data.familyId) {
    try {
      const list = await api.getMembers(data.familyId)
      const me = (list || []).find(m => m.openid === data.openid)
      if (me) {
        s.role = me.role
        s.nickname = me.nickname
        store.setSession(s)
      }
    } catch (e) {}
  } else {
    s.role = undefined
    s.nickname = undefined
    store.setSession(s)
  }
  // 若本次登录带了 nickname（如首次进入时用户填写），额外同步到成员资料，
  // 既保证新建用户落库，也能补填历史空昵称记录。失败不影响登录主流程。
  if (extra && extra.nickname && data.isMember && data.familyId) {
    try {
      await api.updateMe({ nickname: extra.nickname })
      s.nickname = extra.nickname
      store.setSession(s)
    } catch (e) {}
  }
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
