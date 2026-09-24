// utils/charts.js
// 原生 canvas 2D 自绘图表（折线/面积、环形、柱状），零第三方依赖。
// 适配设备像素比，调用方先 initCanvas 取得 ctx 与尺寸（CSS 像素）。

function initCanvas(id) {
  return new Promise((resolve, reject) => {
    const q = wx.createSelectorQuery()
    q.select('#' + id).fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) { reject(new Error('canvas not found')); return }
      const node = res[0].node
      const ctx = node.getContext('2d')
      const dpr = wx.getWindowInfo ? (wx.getWindowInfo().pixelRatio || 2) : 2
      const w = res[0].width, h = res[0].height
      node.width = w * dpr
      node.height = h * dpr
      ctx.scale(dpr, dpr)
      resolve({ ctx, w, h, node })
    })
  })
}

// 折线 + 渐变面积（支出趋势）
// opts: { plain, line, areaTop, areaBottom, grid, label }
// plain=true 时输出「纯净迷你趋势」：无网格/刻度/数据点，适合深色 Hero 内嵌
function drawTrend(ctx, w, h, series, opts) {
  opts = opts || {}
  const plain = !!opts.plain
  ctx.clearRect(0, 0, w, h)
  const padL = plain ? 2 : 36, padR = plain ? 2 : 12, padT = plain ? 8 : 14, padB = plain ? 8 : 22
  const cw = w - padL - padR, ch = h - padT - padB
  const max = Math.max.apply(null, series.map(p => p.value).concat([1]))
  const n = series.length
  const xAt = (i) => padL + (n <= 1 ? cw / 2 : (cw * i) / (n - 1))
  const yAt = (v) => padT + ch - (v / max) * ch
  const lineColor = opts.line || '#07C160'
  const areaTop = opts.areaTop || 'rgba(7,193,96,0.28)'
  const areaBottom = opts.areaBottom || 'rgba(7,193,96,0.02)'

  if (!plain) {
    // 网格 + Y 轴刻度
    ctx.strokeStyle = opts.grid || '#eef0f3'; ctx.lineWidth = 1
    ctx.fillStyle = opts.label || '#9aa0a6'; ctx.font = '10px sans-serif'
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    for (let g = 0; g <= 3; g++) {
      const y = padT + (ch * g) / 3
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke()
      const val = Math.round(max * (1 - g / 3))
      ctx.fillText((val / 100).toFixed(0), padL - 4, y)
    }
  }

  // 面积
  const grad = ctx.createLinearGradient(0, padT, 0, padT + ch)
  grad.addColorStop(0, areaTop)
  grad.addColorStop(1, areaBottom)
  ctx.beginPath()
  ctx.moveTo(xAt(0), yAt(series[0].value))
  series.forEach((p, i) => ctx.lineTo(xAt(i), yAt(p.value)))
  ctx.lineTo(xAt(n - 1), padT + ch)
  ctx.lineTo(xAt(0), padT + ch)
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill()

  // 线
  ctx.beginPath(); ctx.moveTo(xAt(0), yAt(series[0].value))
  series.forEach((p, i) => ctx.lineTo(xAt(i), yAt(p.value)))
  ctx.strokeStyle = lineColor; ctx.lineWidth = plain ? 1.6 : 2
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke()

  if (!plain) {
    // 点 + X 轴标签（稀疏）
    ctx.fillStyle = opts.label || '#9aa0a6'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    series.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(xAt(i), yAt(p.value), 2.5, 0, Math.PI * 2); ctx.fillStyle = lineColor; ctx.fill()
      if (n <= 12 || i % Math.ceil(n / 6) === 0) ctx.fillText(p.label, xAt(i), padT + ch + 4)
    })
  }
}

// 环形图（分类占比）
function drawRing(ctx, w, h, items, centerText) {
  ctx.clearRect(0, 0, w, h)
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 10, rin = r * 0.62
  const total = items.reduce((s, i) => s + i.value, 0) || 1
  let a0 = -Math.PI / 2
  items.forEach(it => {
    const a1 = a0 + (it.value / total) * Math.PI * 2
    ctx.beginPath(); ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r, a0, a1); ctx.closePath()
    ctx.fillStyle = it.color || '#07C160'; ctx.fill()
    a0 = a1
  })
  // 内圈镂空
  ctx.beginPath(); ctx.arc(cx, cy, rin, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill()
  ctx.fillStyle = '#1f2329'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = 'bold 16px sans-serif'
  ctx.fillText(centerText || '', cx, cy - 6)
  ctx.fillStyle = '#9aa0a6'; ctx.font = '11px sans-serif'
  ctx.fillText('总支出', cx, cy + 12)
}

// 柱状图（成员贡献）
function drawBars(ctx, w, h, items) {
  ctx.clearRect(0, 0, w, h)
  const padL = 12, padR = 12, padT = 14, padB = 26
  const cw = w - padL - padR, ch = h - padT - padB
  const max = Math.max.apply(null, items.map(i => i.value).concat([1]))
  const n = items.length || 1
  const gap = 14
  const slot = (cw - gap * (n + 1)) / n + gap // 每根柱的槽位宽
  const bw = Math.min(slot - gap, 48) // 柱宽上限 48px，成员少时不再撑满整卡
  ctx.textAlign = 'center'
  items.forEach((it, i) => {
    const slotX = padL + gap + i * slot
    const x = slotX + (slot - gap - bw) / 2 // 槽位内居中
    const bh = (it.value / max) * ch
    const y = padT + ch - bh
    const grad = ctx.createLinearGradient(0, y, 0, padT + ch)
    grad.addColorStop(0, '#0aa85a'); grad.addColorStop(1, '#07C160')
    ctx.fillStyle = grad
    roundRect(ctx, x, y, bw, bh, 6); ctx.fill()
    ctx.fillStyle = '#1f2329'; ctx.font = '11px sans-serif'; ctx.textBaseline = 'bottom'
    ctx.fillText(((it.value) / 100).toFixed(0), x + bw / 2, y - 2)
    ctx.fillStyle = '#9aa0a6'; ctx.textBaseline = 'top'
    ctx.fillText(it.label, x + bw / 2, padT + ch + 4)
  })
}

function roundRect(ctx, x, y, w, h, r) {
  if (h < 0) h = 0
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// 多序列折线（成员对比）：labels=X 轴标签，lines=[{name,color,values:number[]}]
// 所有序列共享同一 Y 轴刻度，各自用不同颜色画线 + 数据点
function drawTrendMulti(ctx, w, h, labels, lines, opts) {
  opts = opts || {}
  ctx.clearRect(0, 0, w, h)
  const padL = 36, padR = 12, padT = 14, padB = 22
  const cw = w - padL - padR, ch = h - padT - padB
  const n = labels.length
  let max = 1
  lines.forEach(l => l.values.forEach(v => { if (v > max) max = v }))
  const xAt = (i) => padL + (n <= 1 ? cw / 2 : (cw * i) / (n - 1))
  const yAt = (v) => padT + ch - (v / max) * ch

  // 网格 + Y 轴刻度
  ctx.strokeStyle = opts.grid || '#eef0f3'; ctx.lineWidth = 1
  ctx.fillStyle = opts.label || '#9aa0a6'; ctx.font = '10px sans-serif'
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  for (let g = 0; g <= 3; g++) {
    const y = padT + (ch * g) / 3
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke()
    ctx.fillText((max * (1 - g / 3) / 100).toFixed(0), padL - 4, y)
  }

  // X 轴标签（稀疏）
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  labels.forEach((lb, i) => {
    if (n <= 12 || i % Math.ceil(n / 6) === 0) ctx.fillText(lb, xAt(i), padT + ch + 4)
  })

  // 各序列折线 + 数据点
  lines.forEach(l => {
    ctx.beginPath()
    l.values.forEach((v, i) => { i ? ctx.lineTo(xAt(i), yAt(v)) : ctx.moveTo(xAt(i), yAt(v)) })
    ctx.strokeStyle = l.color; ctx.lineWidth = 2
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke()
    l.values.forEach((v, i) => {
      ctx.beginPath(); ctx.arc(xAt(i), yAt(v), 2.5, 0, Math.PI * 2)
      ctx.fillStyle = l.color; ctx.fill()
    })
  })
}

// 将已绘制的 canvas 2d 节点导出为临时图片路径（按 dpr 输出高清图）
// 页面用 <image> 展示图表、随后通过 wx:if 移除 canvas 节点：
// 页面上不再存在原生组件层，彻底规避 canvas 在开发者工具等环境
// 浮到 tabBar / 导航栏之上的同层渲染问题
function canvasToImage(node, w, h) {
  return new Promise((resolve, reject) => {
    const dpr = wx.getWindowInfo ? (wx.getWindowInfo().pixelRatio || 2) : 2
    wx.canvasToTempFilePath({
      canvas: node,
      x: 0, y: 0, width: w, height: h,
      destWidth: Math.round(w * dpr),
      destHeight: Math.round(h * dpr),
      success: (r) => resolve(r.tempFilePath),
      fail: reject
    })
  })
}

module.exports = { initCanvas, drawTrend, drawTrendMulti, drawRing, drawBars, canvasToImage }
