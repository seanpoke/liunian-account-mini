// utils/api.js
// 统一接口层。后端未就绪时走 mock；接入真实后端只需把 config.enableMock 置 false。
// 所有方法在成功时返回 data，失败时 throw Error(msg)。
const { getServerConfig } = require('./config')
const mock = require('./mock')
const store = require('./store')

function token() {
  const s = store.getSession()
  return s ? s.token : ''
}

function buildQuery(q) {
  if (!q) return ''
  const ks = Object.keys(q).filter(k => q[k] !== undefined && q[k] !== null && q[k] !== '')
  if (!ks.length) return ''
  return '?' + ks.map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&')
}

async function request(method, path, opts) {
  opts = opts || {}
  const cfg = await getServerConfig()
  if (cfg.enableMock) {
    const res = await mock.dispatch(method, path, opts.data, opts.query)
    if (res.code !== 0) throw new Error(res.msg || ('错误码 ' + res.code))
    return res.data
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: cfg.apiBaseUrl + path + buildQuery(opts.query),
      method,
      data: opts.data,
      header: { 'Authorization': 'Bearer ' + token(), 'content-type': 'application/json' },
      success(r) {
        const d = r.data
        if (d && d.code === 0) resolve(d.data)
        else reject(new Error((d && d.msg) || ('HTTP ' + r.statusCode)))
      },
      fail(e) { reject(new Error((e && e.errMsg) || '网络错误')) }
    })
  })
}

// 真实的 wx.login（前端永远只拿到临时 code，换 openid 由服务端用 AppSecret 完成）
function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({ success: r => resolve(r.code), fail: reject })
  })
}

// ---------- 命名接口 ----------
const api = {
  wxLogin,
  login: (code) => request('POST', '/login', { data: { code } }),
  createFamily: (name) => request('POST', '/family', { data: { name } }),
  getFamily: (id) => request('GET', '/family/' + id),
  updateFamily: (id, patch) => request('PATCH', '/family/' + id, { data: patch }),

  createInvitation: (familyId, type) => request('POST', '/invitation', { data: { familyId, type } }),
  getInvitation: (token) => request('GET', '/invitation/' + token),
  applyInvitation: (token, nickname, avatar) => request('POST', '/invitation/' + token + '/apply', { data: { nickname, avatar } }),
  revokeInvitation: (token) => request('POST', '/invitation/revoke', { data: { token } }),
  getPending: (familyId) => request('GET', '/family/' + familyId + '/pending'),
  approveMember: (familyId, memberId) => request('POST', '/family/' + familyId + '/member/' + memberId + '/approve'),
  rejectMember: (familyId, memberId) => request('POST', '/family/' + familyId + '/member/' + memberId + '/reject'),

  createTransaction: (payload) => request('POST', '/transaction', { data: payload }),
  updateTransaction: (id, payload) => request('PUT', '/transaction/' + id, { data: payload }),
  deleteTransaction: (id) => request('DELETE', '/transaction/' + id),
  getTransaction: (id) => request('GET', '/transaction/' + id),
  getTransactions: (query) => request('GET', '/transactions', { query }),

  getStats: (query) => request('GET', '/stats', { query }),

  getMembers: (familyId) => request('GET', '/family/' + familyId + '/members'),
  removeMember: (familyId, memberId) => request('DELETE', '/family/' + familyId + '/member/' + memberId),
  transferOwner: (familyId, toOpenid) => request('POST', '/family/' + familyId + '/transfer', { data: { toOpenid } }),
  quitFamily: (familyId) => request('POST', '/family/' + familyId + '/quit'),
  updateMe: (patch) => request('PATCH', '/family/' + (store.getSession() && store.getSession().familyId) + '/member/me', { data: patch }),

  getReminder: () => request('GET', '/reminder'),
  updateReminder: (payload) => request('PUT', '/reminder', { data: payload }),
  getWxacode: (familyId) => request('GET', '/wxacode', { query: { familyId } }),

  addCategory: (payload) => request('POST', '/category', { data: payload }),
  getBudget: () => request('GET', '/budget'),
  setBudget: (amount) => request('PUT', '/budget', { data: { amount } }),

  getCategories: () => mock.getCategories()
}

module.exports = api
