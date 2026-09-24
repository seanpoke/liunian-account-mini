// utils/mock.js
// 模拟后端：内存数据 + REST 路由分发。
// 真实环境下这些逻辑都在服务端；此处仅用于前端独立运行/测试。
// 注意：金额一律以「分」存储（整数）。

const fmt = require('./format')

// ---------- 基础工具 ----------
let _seed = 20260923
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)] }
let _idc = 0
function genId(prefix) { _idc += 1; return prefix + '_' + Date.now().toString(36) + _idc }

const AVATAR_PALETTE = ['#3a6df0', '#f0506e', '#18a058', '#f0a020', '#9254de', '#13c2c2', '#fa8c16']
function avatarColor(openid) {
  let h = 0
  for (let i = 0; i < openid.length; i++) h = (h * 31 + openid.charCodeAt(i)) & 0xffff
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}
function initial(name) { return (name || '?').slice(0, 1) }
function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) }

// 生成一个看起来像二维码的 SVG data URI（mock 演示用；真机由后端返回小程序码 URL）
function qrSvg(text) {
  const size = 25, cell = 6, pad = 8
  const total = size * cell + pad * 2
  function rect(x, y, w, h, fill) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"/>'
  }
  function finder(x, y) {
    let s = ''
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const fill = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) ? '#000' : '#fff'
        s += rect(x + c * cell, y + r * cell, cell, cell, fill)
      }
    }
    return s
  }
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0x7fffffff
  let rects = rect(0, 0, total, total, '#fff')
  rects += finder(pad, pad)
  rects += finder(pad + (size - 7) * cell, pad)
  rects += finder(pad, pad + (size - 7) * cell)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if ((r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7)) continue
      h = (h * 1103515245 + 12345) & 0x7fffffff
      if (h & 1) rects += rect(pad + c * cell, pad + r * cell, cell, cell, '#000')
    }
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + total + '" height="' + total + '">' + rects + '</svg>'
  const bytes = new Uint8Array(svg.length)
  for (let i = 0; i < svg.length; i++) bytes[i] = svg.charCodeAt(i)
  return 'data:image/svg+xml;base64,' + wx.arrayBufferToBase64(bytes.buffer)
}
// 成员头像底色：优先用其自选色（存于 member.avatar），否则按 openid 派生
function memberColor(m) { return (m && isHex(m.avatar)) ? m.avatar : avatarColor(m ? m.openid : '') }

// ---------- 预设分类 ----------
const EXPENSE_CATS = [
  { id: 'cat_food', name: '餐饮', icon: '🍜', color: '#ff7a45' },
  { id: 'cat_traffic', name: '交通', icon: '🚌', color: '#36cfc9' },
  { id: 'cat_shop', name: '购物', icon: '🛍️', color: '#ff85c0' },
  { id: 'cat_home', name: '居家', icon: '🏠', color: '#9254de' },
  { id: 'cat_fun', name: '娱乐', icon: '🎮', color: '#597ef7' },
  { id: 'cat_medical', name: '医疗', icon: '💊', color: '#f5222d' },
  { id: 'cat_edu', name: '教育', icon: '📚', color: '#13c2c2' },
  { id: 'cat_other_e', name: '其他', icon: '📦', color: '#8c8c8c' }
]
const INCOME_CATS = [
  { id: 'cat_salary', name: '工资', icon: '💰', color: '#52c41a' },
  { id: 'cat_bonus', name: '奖金', icon: '🎁', color: '#faad14' },
  { id: 'cat_invest', name: '理财', icon: '📈', color: '#1890ff' },
  { id: 'cat_other_i', name: '其他', icon: '➕', color: '#8c8c8c' }
]
function allCats() { return EXPENSE_CATS.concat(INCOME_CATS).concat(state.customCats) }
function findCat(id) { return allCats().find(c => c.id === id) }

const NOTES = ['午饭', '晚饭', '打车', '超市', '买菜', '奶茶', '电影', '话费', '水电', '衣服', '书籍', '零食', '加油', '聚会']

// ---------- 内存状态 ----------
const state = {
  me: 'o_owner',          // 当前登录 openid（演示可切换）
  family: null,
  members: [],
  transactions: [],
  invitations: [],
  reminders: {},
  customCats: [],         // 用户自定义分类
  budget: 0               // 家庭每月预算（分），0 表示未设置
}

function resetState() {
  state.me = 'o_owner'
  state.family = null
  state.members = []
  state.transactions = []
  state.invitations = []
  state.reminders = {}
  state.customCats = []
  state.budget = 0
}

// 构建一份示例家庭（含成员与近 90 天流水），用于演示与测试
function seedDemo() {
  resetState()
  const familyId = 'FAM_DEMO'
  const famDay = fmt.addDays(fmt.today(), -120)
  state.family = {
    id: familyId, name: '流年小账', creator_openid: 'o_owner',
    currency: 'CNY', avatar: '', member_count: 4, status: 'active',
    created_at: famDay + 'T09:00:00'
  }
  state.members = [
    { id: 'm_owner', family_id: familyId, openid: 'o_owner', nickname: '老李', avatar: '', role: 'owner', status: 'active', source: 'self', joined_at: famDay + 'T09:00:00' },
    { id: 'm_huang', family_id: familyId, openid: 'o_huang', nickname: '阿黄', avatar: '', role: 'member', status: 'active', source: 'invite', joined_at: fmt.addDays(famDay, 10) + 'T10:00:00' },
    { id: 'm_xiao', family_id: familyId, openid: 'o_xiao', nickname: '小晓', avatar: '', role: 'member', status: 'active', source: 'invite', joined_at: fmt.addDays(famDay, 20) + 'T11:00:00' },
    { id: 'm_a', family_id: familyId, openid: 'o_a', nickname: '阿伟', avatar: '', role: 'member', status: 'active', source: 'invite', joined_at: fmt.addDays(famDay, 30) + 'T12:00:00' },
    // 预置一条待审批申请，便于演示审批流程
    { id: 'm_xin', family_id: familyId, openid: 'o_xin', nickname: '小新', avatar: '', role: 'member', status: 'pending', source: 'invite', joined_at: null }
  ]
  state.invitations = [
    { id: 'inv_demo', family_id: familyId, inviter_openid: 'o_owner', token: 'INV_DEMO_TOKEN', type: 'share', used: 0, applicant_openid: null, reviewed_by: null, reviewed_at: null, expire_at: fmt.addDays(fmt.today(), 7) + 'T23:59:59', status: 'pending', created_at: fmt.today() + 'T10:00:00' }
  ]
  seedTransactions()
}

function seedTransactions() {
  const txs = []
  const active = state.members.filter(m => m.status === 'active')
  for (let back = 89; back >= 0; back--) {
    const date = fmt.addDays(fmt.today(), -back)
    const n = rnd() > 0.35 ? 2 : 1
    for (let k = 0; k < n; k++) {
      const cat = pick(EXPENSE_CATS)
      const amount = Math.floor(rnd() * 29500) + 500
      const m = pick(active)
      txs.push(mkTx(m.openid, 'expense', cat, amount, date, pick(NOTES)))
    }
    const dom = parseInt(date.split('-')[2], 10)
    if (dom === 1 || dom === 15) {
      const cat = INCOME_CATS[0]
      txs.push(mkTx('o_owner', 'income', cat, 800000 + Math.floor(rnd() * 400000), date, '月薪'))
    }
  }
  state.transactions = txs
}

function mkTx(openid, type, cat, amount, date, note) {
  return {
    id: genId('tx'), family_id: state.family.id, openid, type, amount,
    category_id: cat.id, category_name: cat.name, category_icon: cat.icon, category_color: cat.color,
    date, note: note || '', images: [],
    created_at: date + 'T' + fmt.pad2(Math.floor(rnd() * 24)) + ':' + fmt.pad2(Math.floor(rnd() * 60)) + ':00',
    updated_at: date + 'T' + fmt.pad2(Math.floor(rnd() * 24)) + ':' + fmt.pad2(Math.floor(rnd() * 60)) + ':00'
  }
}

// ---------- 权限辅助 ----------
function me() { return state.members.find(m => m.openid === state.me) }
function requireOwner() {
  const m = me()
  if (!m || m.role !== 'owner') return { code: 403, msg: '仅创建者可操作' }
  return null
}
function findMemberById(mid) { return state.members.find(m => m.id === mid) }

// ---------- 路由表 ----------
const routes = []
function route(method, pattern, handler) {
  const keys = []
  const re = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)' }) + '$')
  routes.push({ method, re, keys, handler })
}

function dispatch(method, url, data, query) {
  for (const r of routes) {
    if (r.method !== method) continue
    const m = url.match(r.re)
    if (!m) continue
    const params = {}
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) })
    const ctx = { params, data: data || {}, query: query || {}, method, url }
    return Promise.resolve(r.handler(ctx))
  }
  return Promise.resolve({ code: 404, msg: '接口不存在: ' + method + ' ' + url })
}

function ok(data) { return { code: 0, msg: 'ok', data: data === undefined ? null : data } }
function fail(code, msg) { return { code, msg, data: null } }

// ===== 登录与身份 =====
route('POST', '/login', (ctx) => {
  // 真实环境：用 wx.login 的 code 调服务端 code2Session 换 openid。
  // 此处 mock：依据当前演示身份 state.me 返回会话。
  // （role/nickname 为便于前端鉴权演示的附加字段；真实接口可仅返回 isMember + familyId）
  const m = state.members.find(x => x.openid === state.me && x.status === 'active')
  return ok({
    token: 'MOCK_TOKEN_' + state.me,
    openid: state.me,
    isMember: !!m,
    familyId: m ? state.family.id : null,
    role: m ? m.role : null,
    nickname: m ? m.nickname : null,
    color: m ? memberColor(m) : null
  })
})

// ===== 账本 =====
route('POST', '/family', (ctx) => {
  // 创建者创建家庭。演示：同时播种示例成员与流水，便于完整体验。
  const name = (ctx.data.name || '流年小账').trim()
  if (!name) return fail(400, '请填写家庭名称')
  seedDemo()
  state.family.name = name
  return ok({ familyId: state.family.id })
})

route('GET', '/family/:familyId', () => {
  if (!state.family) return fail(404, '账本不存在')
  return ok(Object.assign({}, state.family, { memberCount: state.members.filter(m => m.status === 'active').length }))
})

route('PATCH', '/family/:familyId', (ctx) => {
  const err = requireOwner(); if (err) return err
  if (ctx.data.name) state.family.name = ctx.data.name
  if (ctx.data.currency) state.family.currency = ctx.data.currency
  if (ctx.data.avatar !== undefined) state.family.avatar = ctx.data.avatar
  return ok(Object.assign({}, state.family))
})

// ===== 邀请 =====
route('POST', '/invitation', (ctx) => {
  const err = requireOwner(); if (err) return err
  const fid = ctx.data.familyId || (state.family && state.family.id)
  if (!fid) return fail(404, '账本不存在')
  const type = ctx.data.type || 'share'
  const expireDays = type === 'share' ? 1 : 7
  const memberLimit = type === 'share' ? 1 : 10
  const token = genId('INV').toUpperCase().replace(/_/g, '')
  const inv = {
    id: genId('inv'), family_id: fid, inviter_openid: state.me, token, type,
    used: 0, applicant_openid: null, reviewed_by: null, reviewed_at: null,
    expire_at: fmt.addDays(fmt.today(), expireDays) + 'T23:59:59', status: 'pending', created_at: fmt.today() + 'T10:00:00',
    member_limit: memberLimit
  }
  state.invitations.push(inv)
  const data = { token, expireAt: inv.expire_at, expireDays, memberLimit }
  if (type === 'qr') data.qrImageUrl = qrSvg(token)
  return ok(data)
})

route('GET', '/invitation/:token', (ctx) => {
  const inv = state.invitations.find(i => i.token === ctx.params.token)
  if (!inv) return fail(410, '邀请已失效')
  if (inv.used || inv.status !== 'pending' || inv.expire_at < fmt.today() + 'T00:00:00') {
    return fail(410, '邀请已失效或已被使用')
  }
  const inviter = state.members.find(m => m.openid === inv.inviter_openid)
  const fam = state.family
  // 严格遵守隐私：仅返回家庭名 + 邀请人信息，绝不含任何账目数据
  return ok({
    familyName: fam ? fam.name : '家庭账本',
    inviterNickname: inviter ? inviter.nickname : '家人',
    inviterAvatar: inviter ? inviter.avatar : '',
    inviterColor: inviter ? avatarColor(inviter.openid) : '#3a6df0',
    inviterInitial: inviter ? initial(inviter.nickname) : '?',
    status: inv.status,
    expireAt: inv.expire_at
  })
})

route('POST', '/invitation/:token/apply', (ctx) => {
  const inv = state.invitations.find(i => i.token === ctx.params.token)
  if (!inv) return fail(410, '邀请已失效')
  if (inv.used || inv.status !== 'pending' || inv.expire_at < fmt.today() + 'T00:00:00') return fail(410, '邀请已失效或已被使用')
  const exist = state.members.find(m => m.openid === state.me)
  if (exist && exist.status === 'active') return fail(409, '你已是家庭成员')
  const pending = state.members.find(m => m.openid === state.me && m.status === 'pending')
  if (pending) return fail(409, '申请审核中，请勿重复提交')
  // 写入 pending 成员 + 标记邀请已用
  inv.used = 1
  inv.applicant_openid = state.me
  inv.status = 'pending'
  if (!exist) {
    state.members.push({
      id: genId('m'), family_id: inv.family_id, openid: state.me,
      nickname: ctx.data.nickname || '新成员', avatar: ctx.data.avatar || '',
      role: 'member', status: 'pending', source: 'invite', joined_at: null
    })
  } else {
    exist.status = 'pending'
  }
  return ok({ status: 'pending' })
})

route('POST', '/invitation/revoke', (ctx) => {
  const err = requireOwner(); if (err) return err
  const inv = state.invitations.find(i => i.token === ctx.data.token)
  if (inv) { inv.status = 'expired' }
  return ok(null)
})

route('GET', '/family/:familyId/pending', () => {
  const err = requireOwner(); if (err) return err
  const list = state.members.filter(m => m.status === 'pending').map(m => {
    const inv = state.invitations.find(i => i.applicant_openid === m.openid && i.status === 'pending')
    const inviter = inv ? state.members.find(x => x.openid === inv.inviter_openid) : null
    return {
      memberId: m.id, nickname: m.nickname, avatar: m.avatar,
      applicantOpenid: m.openid,
      applyAt: (inv && inv.created_at) || m.joined_at || fmt.today() + 'T00:00:00',
      inviterNickname: inviter ? inviter.nickname : '',
      source: m.source, color: memberColor(m)
    }
  })
  return ok(list)
})

route('POST', '/family/:familyId/member/:memberId/approve', (ctx) => {
  const err = requireOwner(); if (err) return err
  const m = findMemberById(ctx.params.memberId)
  if (!m) return fail(404, '成员不存在')
  m.status = 'active'; m.joined_at = fmt.today() + 'T00:00:00'
  const inv = state.invitations.find(i => i.applicant_openid === m.openid)
  if (inv) { inv.status = 'approved'; inv.reviewed_by = state.me; inv.reviewed_at = fmt.today() + 'T00:00:00' }
  state.family.member_count = state.members.filter(x => x.status === 'active').length
  return ok(null)
})

route('POST', '/family/:familyId/member/:memberId/reject', (ctx) => {
  const err = requireOwner(); if (err) return err
  const m = findMemberById(ctx.params.memberId)
  if (!m) return fail(404, '成员不存在')
  m.status = 'removed'
  const inv = state.invitations.find(i => i.applicant_openid === m.openid)
  if (inv) { inv.status = 'rejected'; inv.reviewed_by = state.me; inv.reviewed_at = fmt.today() + 'T00:00:00' }
  state.family.member_count = state.members.filter(x => x.status === 'active').length
  return ok(null)
})

// ===== 记账 =====
route('POST', '/transaction', (ctx) => {
  if (!state.family) return fail(403, '尚未加入家庭')
  const d = ctx.data
  const cat = findCat(d.categoryId)
  if (!cat) return fail(400, '分类不存在')
  if (!d.amount || d.amount <= 0) return fail(400, '金额无效')
  const tx = mkTx(state.me, d.type, cat, d.amount, d.date || fmt.today(), d.note)
  state.transactions.unshift(tx)
  return ok({ id: tx.id })
})

route('PUT', '/transaction/:id', (ctx) => {
  const tx = state.transactions.find(t => t.id === ctx.params.id)
  if (!tx) return fail(404, '记录不存在')
  if (tx.openid !== state.me && me().role !== 'owner') return fail(403, '无权编辑他人记录')
  const d = ctx.data
  if (d.categoryId) { const cat = findCat(d.categoryId); if (cat) { tx.category_id = cat.id; tx.category_name = cat.name; tx.category_icon = cat.icon; tx.category_color = cat.color } }
  if (d.amount) tx.amount = d.amount
  if (d.type) tx.type = d.type
  if (d.date) tx.date = d.date
  if (d.note !== undefined) tx.note = d.note
  tx.updated_at = fmt.today() + 'T00:00:00'
  return ok(null)
})

route('DELETE', '/transaction/:id', (ctx) => {
  const idx = state.transactions.findIndex(t => t.id === ctx.params.id)
  if (idx < 0) return fail(404, '记录不存在')
  const tx = state.transactions[idx]
  if (tx.openid !== state.me && me().role !== 'owner') return fail(403, '无权删除他人记录')
  state.transactions.splice(idx, 1)
  return ok(null)
})

route('GET', '/transaction/:id', (ctx) => {
  const tx = state.transactions.find(t => t.id === ctx.params.id)
  if (!tx) return fail(404, '记录不存在')
  const m = state.members.find(x => x.openid === tx.openid)
  return ok(Object.assign({}, tx, { nickname: m ? m.nickname : '?' }))
})

route('GET', '/transactions', (ctx) => {
  const q = ctx.query
  let list = state.transactions.slice()
  if (q.start) list = list.filter(t => t.date >= q.start)
  if (q.end) list = list.filter(t => t.date <= q.end)
  if (q.member) list = list.filter(t => t.openid === q.member)
  if (q.type) list = list.filter(t => t.type === q.type)
  if (q.category) list = list.filter(t => t.category_id === q.category)
  list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created_at < b.created_at ? 1 : -1)))
  const total = list.length
  const page = parseInt(q.page || '1', 10)
  const size = parseInt(q.size || '50', 10)
  const paged = list.slice((page - 1) * size, page * size).map(t => {
    const m = state.members.find(x => x.openid === t.openid)
    return Object.assign({}, t, { nickname: m ? m.nickname : '?', memberColor: m ? memberColor(m) : '#999', memberInitial: m ? initial(m.nickname) : '?' })
  })
  return ok({ list: paged, total })
})

// ===== 统计 =====
route('GET', '/stats', (ctx) => {
  const q = ctx.query
  let start, end
  if (q.period === 'year') { const y = q.year || new Date().getFullYear(); start = y + '-01-01'; end = y + '-12-31' }
  else if (q.period === 'custom') { start = q.start; end = q.end }
  else { const mr = fmt.monthRange(q.month || (new Date().getFullYear() + '-' + fmt.pad2(new Date().getMonth() + 1))); start = mr.start; end = mr.end }

  let list = state.transactions.filter(t => t.date >= start && t.date <= end)
  if (q.member) list = list.filter(t => t.openid === q.member)

  let income = 0, expense = 0
  const catMap = {}, dayMap = {}, memMap = {}
  list.forEach(t => {
    if (t.type === 'income') income += t.amount; else expense += t.amount
    if (t.type === 'expense') {
      catMap[t.category_name] = (catMap[t.category_name] || 0) + t.amount
      dayMap[t.date] = (dayMap[t.date] || 0) + t.amount
      const mm = memMap[t.openid] || { openid: t.openid, amount: 0 }
      mm.amount += t.amount; memMap[t.openid] = mm
    }
  })
  const byCategory = Object.keys(catMap).map(name => ({ name, amount: catMap[name] })).sort((a, b) => b.amount - a.amount)
  const byDay = Object.keys(dayMap).sort().map(date => ({ date, amount: dayMap[date] }))
  const byMember = Object.keys(memMap).map(openid => {
    const m = state.members.find(x => x.openid === openid)
    return { openid, nickname: m ? m.nickname : '?', amount: memMap[openid].amount }
  }).sort((a, b) => b.amount - a.amount)

  return ok({ income, expense, balance: income - expense, byCategory, byDay, byMember, start, end })
})

// ===== 成员 =====
route('GET', '/family/:familyId/members', () => {
  const month = new Date().getFullYear() + '-' + fmt.pad2(new Date().getMonth() + 1)
  const list = state.members.filter(m => m.status === 'active' || m.status === 'pending').map(m => {
    const monthCount = state.transactions.filter(t => t.openid === m.openid && t.date.indexOf(month) === 0).length
    const totalCount = state.transactions.filter(t => t.openid === m.openid).length
    return {
      memberId: m.id, openid: m.openid, nickname: m.nickname, avatar: m.avatar,
      role: m.role, status: m.status, joinedAt: m.joined_at, source: m.source, monthCount, totalCount,
      color: memberColor(m), initial: initial(m.nickname)
    }
  })
  return ok(list)
})

route('DELETE', '/family/:familyId/member/:memberId', (ctx) => {
  const err = requireOwner(); if (err) return err
  const m = findMemberById(ctx.params.memberId)
  if (!m) return fail(404, '成员不存在')
  if (m.role === 'owner') return fail(400, '创建者不可被移除')
  m.status = 'removed'
  state.family.member_count = state.members.filter(x => x.status === 'active').length
  return ok(null)
})

route('POST', '/family/:familyId/transfer', (ctx) => {
  const err = requireOwner(); if (err) return err
  const to = state.members.find(x => x.openid === ctx.data.toOpenid && x.status === 'active')
  if (!to) return fail(404, '目标成员不存在')
  const owner = state.members.find(x => x.role === 'owner')
  owner.role = 'member'; to.role = 'owner'
  state.family.creator_openid = to.openid
  state.me = to.openid
  return ok(null)
})

route('POST', '/family/:familyId/quit', () => {
  const m = me()
  if (!m) return fail(404, '未加入家庭')
  if (m.role === 'owner') return fail(400, '创建者需先转让身份再退出')
  m.status = 'removed'
  state.family.member_count = state.members.filter(x => x.status === 'active').length
  return ok(null)
})

route('PATCH', '/family/:familyId/member/me', (ctx) => {
  const m = me()
  if (!m) return fail(404, '未加入家庭')
  if (ctx.data.nickname) m.nickname = ctx.data.nickname
  if (ctx.data.avatar !== undefined) m.avatar = ctx.data.avatar
  return ok({ nickname: m.nickname, avatar: m.avatar })
})

// ===== 提醒 =====
route('GET', '/reminder', () => {
  const r = state.reminders[state.me] || { enabled: 0, time: '21:00', tmplId: 'TEMPLATE_DEMO_ID' }
  return ok(r)
})

route('PUT', '/reminder', (ctx) => {
  const d = ctx.data
  state.reminders[state.me] = {
    enabled: d.enabled ? 1 : 0,
    time: d.time || '21:00',
    tmplId: d.tmplId || 'TEMPLATE_DEMO_ID'
  }
  return ok(state.reminders[state.me])
})

route('GET', '/wxacode', () => {
  const err = requireOwner(); if (err) return err
  return ok({ qrImageUrl: 'data:image/svg+xml;base64,PLACEHOLDER_QR' })
})

// ===== 自定义分类 =====
route('POST', '/category', (ctx) => {
  if (!state.family) return fail(403, '尚未加入家庭')
  const d = ctx.data || {}
  const type = d.type === 'income' ? 'income' : 'expense'
  const cat = {
    id: genId('cat'),
    name: (d.name || '其他').trim() || '其他',
    icon: d.icon || '🏷️',
    color: d.color || '#8c8c8c',
    type
  }
  state.customCats.push(cat)
  return ok(cat)
})

// ===== 预算 =====
route('GET', '/budget', () => {
  if (!state.family) return fail(404, '账本不存在')
  return ok({ amount: state.budget || 0 })
})

route('PUT', '/budget', (ctx) => {
  if (!state.family) return fail(404, '账本不存在')
  const err = requireOwner(); if (err) return err
  const amount = Math.max(0, Math.floor(Number(ctx.data && ctx.data.amount) || 0))
  state.budget = amount
  return ok({ amount })
})

// 导出分类（前端记账页需要，含自定义分类）
function getCategories() {
  return {
    expense: EXPENSE_CATS.concat(state.customCats.filter(c => c.type === 'expense')),
    income: INCOME_CATS.concat(state.customCats.filter(c => c.type === 'income'))
  }
}

module.exports = {
  state, seedDemo, resetState, avatarColor, initial, getCategories,
  dispatch
}
