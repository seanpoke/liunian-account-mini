// utils/recent-cats.js
// 最近使用的分类：按「家庭 + 收支类型」记在本地，用于记账弹层动态生成「常用」位。
// 只存分类 id，读取时再与最新分类列表求交集（分类被删/改名后自然失效）。
const store = require('./store')

const PREFIX = 'liunian_recent_cats_'
// 本地最多保留的记录条数（真正展示的常用位数量由调用方决定）
const KEEP = 20

function currentKey() {
  const s = store.getSession()
  return PREFIX + ((s && s.familyId) || 'local')
}

function readAll() {
  try { return wx.getStorageSync(currentKey()) || {} } catch (e) { return {} }
}

// 取某收支类型的最近使用 id 列表（新的在前），limit 可选
function get(type, limit) {
  const list = (readAll()[type] || []).slice()
  return limit ? list.slice(0, limit) : list
}

// 记一次使用：去重后插到最前
function push(type, id) {
  if (id === undefined || id === null || id === '') return
  const all = readAll()
  const key = currentKey()
  const list = (all[type] || []).filter((x) => String(x) !== String(id))
  list.unshift(id)
  all[type] = list.slice(0, KEEP)
  try { wx.setStorageSync(key, all) } catch (e) {}
}

// 家庭切换后清空当前家庭的常用记录
function clear(type) {
  const all = readAll()
  if (type) delete all[type]
  try { wx.setStorageSync(currentKey(), all) } catch (e) {}
}

module.exports = { get, push, clear }
