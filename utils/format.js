// utils/format.js
// 金额一律以「分」为整数存储；展示与输入均以「元」处理。

// 分 -> 元（数字，保留两位小数）
function fenToYuan(fen) {
  return Math.round(fen || 0) / 100
}

// 分 -> 格式化字符串，带千分位，如 123456 -> "1,234.56"
function formatMoney(fen, withSymbol) {
  const n = fenToYuan(fen)
  const s = n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return withSymbol ? '¥' + s : s
}

// 元（字符串/数字）-> 分（整数）
function yuanToFen(yuan) {
  const n = parseFloat(yuan)
  if (isNaN(n) || n <= 0) return 0
  return Math.round(n * 100)
}

function pad2(n) { return n < 10 ? '0' + n : '' + n }

function fmtDate(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate())
}

function today() { return fmtDate(new Date()) }

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return fmtDate(d)
}

// 月份第一天 / 最后一天
function monthRange(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number)
  const start = y + '-' + pad2(m) + '-01'
  const end = new Date(y, m, 0)
  return { start, end: fmtDate(end) }
}

function monthList(count) {
  const arr = []
  const now = new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    arr.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1))
  }
  return arr
}

function yearList(count) {
  const arr = []
  const y = new Date().getFullYear()
  for (let i = count - 1; i >= 0; i--) arr.push(y - i)
  return arr
}

// 时间 -> HH:mm
function fmtTime(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return pad2(dt.getHours()) + ':' + pad2(dt.getMinutes())
}

// 友好日期：今天 / 昨天 / MM月DD日
function friendDate(dateStr) {
  const t = today()
  if (dateStr === t) return '今天'
  if (dateStr === addDays(t, -1)) return '昨天'
  const p = dateStr.split('-')
  return p[1] + '月' + p[2] + '日'
}

// 头像渐变底（对照原型 .av.g/.b/.p/.o 的 135deg 双色渐变），未知色回退纯色
var AV_GRAD = {
  '#3a6df0': ['#4c8dff', '#3a78e0'],
  '#f0506e': ['#ff7a93', '#d93a58'],
  '#18a058': ['#2bc46f', '#0e8a49'],
  '#f0a020': ['#ffb84d', '#dd8a0a'],
  '#9254de': ['#9b6bff', '#7e3fd0'],
  '#13c2c2': ['#36cfc9', '#0da8a8'],
  '#fa8c16': ['#ffa940', '#e07708'],
  '#07c160': ['#0ed26c', '#0aa85a'],
  '#4c8dff': ['#6fa3ff', '#3a78e0']
}
function avGrad(color) {
  const g = AV_GRAD[String(color || '').toLowerCase()]
  return g ? 'linear-gradient(135deg,' + g[0] + ',' + g[1] + ')' : (color || '#bbbbbb')
}

module.exports = {
  fenToYuan, formatMoney, yuanToFen, pad2, fmtDate, today, addDays,
  monthRange, monthList, yearList, fmtTime, friendDate, avGrad
}
