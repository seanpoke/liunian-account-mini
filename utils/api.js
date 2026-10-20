// utils/api.js
// 统一接口层：一律走真实后端（基址见 config.getApiBase，业务代码不写死 IP/端口）。
// 所有方法在成功时返回 data，失败时 throw Error(msg)，并在 error 上附带 code / statusCode。
const { getServerConfig } = require('./config')
const store = require('./store')

// 从当前会话取家庭 ID（缺失时返回 undefined，由调用方/后端处理）
function currentFamilyId() {
  const s = store.getSession()
  return s ? s.familyId : undefined
}

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

// 原始请求：不做 401 自愈，供 request / relogin 复用
function requestRaw(method, path, opts) {
  opts = opts || {}
  return getServerConfig().then((cfg) => new Promise((resolve, reject) => {
    wx.request({
      url: cfg.apiBaseUrl + path + buildQuery(opts.query),
      method,
      data: opts.data,
      header: (function () {
        const h = { 'content-type': 'application/json' }
        const t = token()
        if (t) h['Authorization'] = 'Bearer ' + t
        return h
      })(),
      success(r) {
        const d = r.data
        if (d && d.code === 0) return resolve(d.data)
        const err = new Error((d && d.msg) || ('HTTP ' + r.statusCode))
        err.code = d && d.code
        err.statusCode = r.statusCode
        reject(err)
      },
      fail(e) { reject(new Error((e && e.errMsg) || '网络错误')) }
    })
  }))
}

// 401 静默重登：清 token → wx.login → /login → 重放原请求（同一个请求只重试一次）
let _relogin = null
function relogin() {
  if (_relogin) return _relogin
  _relogin = new Promise((resolve, reject) => {
    wx.login({
      success(r) {
        requestRaw('POST', '/login', { data: { code: r.code } })
          .then((data) => {
            const prev = store.getSession() || {}
            store.setSession(Object.assign({}, prev, {
              token: data.token,
              openid: data.openid,
              isMember: data.isMember,
              familyId: data.familyId
            }))
            resolve()
          })
          .catch(reject)
      },
      fail(e) { reject(new Error((e && e.errMsg) || '登录失败')) }
    })
  })
  _relogin.then(() => { _relogin = null }, () => { _relogin = null })
  return _relogin
}

async function request(method, path, opts, retried) {
  try {
    return await requestRaw(method, path, opts)
  } catch (e) {
    const is401 = e && (e.code === 401 || e.statusCode === 401)
    if (is401 && !retried && path !== '/login') {
      await relogin()
      return request(method, path, opts, true)
    }
    throw e
  }
}

// 真实的 wx.login（前端永远只拿到临时 code，换 openid 由服务端用 AppSecret 完成）
function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({ success: r => resolve(r.code), fail: reject })
  })
}

// 图片上传：multipart/form-data，返回 { key, url, fullUrl, size, contentType }
function upload(filePath, familyId) {
  return getServerConfig().then((cfg) => new Promise((resolve, reject) => {
    const send = (retried) => {
      wx.uploadFile({
        url: cfg.apiBaseUrl + '/upload',
        filePath,
        name: 'file',
        header: token() ? { Authorization: 'Bearer ' + token() } : {},
        formData: (familyId !== undefined && familyId !== null && familyId !== '')
          ? { familyId }
          : {},
        success(r) {
          let body = null
          try { body = JSON.parse(r.data) } catch (e) {}
          if (body && body.code === 0) {
            // 线上返回 CDN 绝对地址；本地返回 /api/files/...。url 与 fullUrl 通常一致，
            // 这里互相兜底，调用方统一存/用 url 即可。
            const data = body.data || {}
            if (!data.url && data.fullUrl) data.url = data.fullUrl
            if (!data.fullUrl && data.url) data.fullUrl = data.url
            return resolve(data)
          }
          if (!retried && (r.statusCode === 401 || (body && body.code === 401))) {
            return relogin().then(() => send(true)).catch(reject)
          }
          const err = new Error((body && body.msg) || ('HTTP ' + r.statusCode))
          err.code = body && body.code
          err.statusCode = r.statusCode
          reject(err)
        },
        fail(e) { reject(new Error((e && e.errMsg) || '上传失败')) }
      })
    }
    send(false)
  }))
}

// ---------- 命名接口 ----------
const api = {
  wxLogin,
  login: (code, extra) => request('POST', '/login', { data: Object.assign({ code }, extra || {}) }),
  createFamily: (name) => request('POST', '/family', { data: { name } }),
  getFamily: (id) => request('GET', '/family/' + id),
  updateFamily: (id, patch) => request('PATCH', '/family/' + id, { data: patch }),

  createInvitation: (familyId, type) => request('POST', '/invitation', { data: { familyId, type } }),
  getInvitation: (token) => request('GET', '/invitation/' + token),
  applyInvitation: (token, nickname, avatar) => request('POST', '/invitation/' + token + '/apply', { data: { nickname, avatar } }),
  revokeInvitation: (token) => request('POST', '/invitation/revoke', { data: { token } }),

  // 待审批申请（旧 /family/{id}/pending 已废弃）
  getJoinRequests: (familyId) => request('GET', '/family/' + familyId + '/join-requests'),
  approveJoinRequest: (familyId, requestId) => request('POST', '/family/' + familyId + '/join-request/' + requestId + '/approve'),
  rejectJoinRequest: (familyId, requestId, remark) => request('POST', '/family/' + familyId + '/join-request/' + requestId + '/reject', { data: remark ? { remark } : {} }),

  createTransaction: (payload) => request('POST', '/transaction', { data: Object.assign({ familyId: currentFamilyId() }, payload) }),
  updateTransaction: (id, payload) => request('PUT', '/transaction/' + id, { data: payload }),
  deleteTransaction: (id) => request('DELETE', '/transaction/' + id),
  getTransaction: (id) => request('GET', '/transaction/' + id),
  getTransactions: (query) => request('GET', '/transactions', { query: Object.assign({ familyId: currentFamilyId() }, query) }),

  getStats: (query) => request('GET', '/stats', { query: Object.assign({ familyId: currentFamilyId() }, query) }),

  getMembers: (familyId) => request('GET', '/family/' + familyId + '/members'),
  removeMember: (familyId, memberId) => request('DELETE', '/family/' + familyId + '/member/' + memberId),
  transferOwner: (familyId, toOpenid) => request('POST', '/family/' + familyId + '/transfer', { data: { toOpenid } }),
  quitFamily: (familyId) => request('POST', '/family/' + familyId + '/quit'),
  // 全局资料（昵称/头像）：会同步刷新该用户所有家庭的成员资料
  getUserMe: () => request('GET', '/user/me'),
  updateMe: (patch) => request('PATCH', '/user/me', { data: patch }),
  updateUserMe: (patch) => request('PATCH', '/user/me', { data: patch }),
  // 仅当前家庭内的昵称/头像
  updateFamilyMemberMe: (familyId, patch) => request('PATCH', '/family/' + familyId + '/member/me', { data: patch }),

  getReminder: (familyId) => request('GET', '/reminder', { query: { familyId: familyId || currentFamilyId() } }),
  updateReminder: (payload) => request('PUT', '/reminder', { data: Object.assign({ familyId: currentFamilyId() }, payload) }),
  getWxacode: (familyId) => request('GET', '/wxacode', { query: { familyId } }),

  addCategory: (payload) => request('POST', '/category', { data: Object.assign({ familyId: currentFamilyId() }, payload) }),
  deleteCategory: (id) => request('DELETE', '/category/' + id),
  getBudget: (familyId) => request('GET', '/budget', { query: { familyId: familyId || currentFamilyId() } }),
  setBudget: (amount, familyId) => request('PUT', '/budget', { data: { amount, familyId: familyId || currentFamilyId() } }),

  getCategories: (familyId, type) => request('GET', '/categories', { query: { familyId, type } }).then((list) => {
    const expense = []
    const income = []
    ;(list || []).forEach((c) => { if (c.type === 'income') income.push(c); else expense.push(c) })
    return { expense, income }
  }),

  upload,

  health: () => request('GET', '/health'),
  getFamilies: () => request('GET', '/families'),
  dissolveFamily: (familyId) => request('POST', '/family/' + familyId + '/dissolve'),
  getTransactionsByDay: (query) => request('GET', '/transactions/by-day', { query: Object.assign({ familyId: currentFamilyId() }, query) }),
  getPrivacy: () => request('GET', '/user/privacy'),
  submitPrivacy: (agreed) => request('POST', '/user/privacy', { data: { agreed } })
}

module.exports = api
