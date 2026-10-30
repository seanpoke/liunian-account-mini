// pages/stats/stats.js
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const charts = require('../../utils/charts')
const store = require('../../utils/store')
const recordFlow = require('../../utils/record-flow')

const RING_PALETTE = ['#3a6df0', '#ff7a45', '#18a058', '#f0a020', '#9254de', '#36cfc9', '#f5222d', '#13c2c2', '#fa8c16', '#8c8c8c']
const MEMBER_PALETTE = ['#07C160', '#4C8DFF', '#FFB020', '#9254DE', '#36CFC9', '#FF7A45', '#EB2F96', '#13C2C2']
function statusBar() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  // statusBarHeight 各机型都可靠；safeArea.top 在部分机型会返回 0，只作兜底
  return Number(info.statusBarHeight) || Number(info.safeArea && info.safeArea.top) || 20
}

Page({
  data: {
    statusBarHeight: 20,
    period: 'month',
    month: '', monthText: '', months: [],
    year: 0, years: [],
    start: '', end: '',
    members: [], memberChips: [], filterMembers: [],
    trendLegend: [],
    incomeText: '0.00', expenseText: '0.00', balanceText: '0.00',
    periodLabel: '',
    hasData: false,
    // 图表：canvas 绘制后导出为图片展示（imgKey），canvas 节点随即移除（xxxCavasOn=false）
    trendImg: '', ringImg: '', barImg: '',
    trendCanvasOn: false, ringCanvasOn: false, barCanvasOn: false,
    sheetVisible: false, sheetEditId: '', sheetPreset: null
  },
  onLoad() {
    const now = new Date()
    const month = now.getFullYear() + '-' + fmt.pad2(now.getMonth() + 1)
    const s = store.getSession()
    // 同步初始化颜色映射，避免统计接口先于分类接口返回时读到 undefined
    this._catColor = {}
    this._memberColor = {}
    this.setData({
      statusBarHeight: statusBar(),
      month, monthText: this.formatMonthText(month),
      months: fmt.monthList(12),
      year: now.getFullYear(), years: fmt.yearList(5),
      start: fmt.monthRange(month).start, end: fmt.today()
    })
    const fid = s && s.familyId
    api.getCategories(fid).then((cats) => {
      this._catColor = {}
      cats.expense.concat(cats.income).forEach(c => { this._catColor[c.name] = c.color })
    }).catch(() => {})
    this._memberColor = {}
    if (s && s.familyId) {
      api.getMembers(s.familyId).then(list => {
        const members = (list || []).slice()
        const memberChips = members.map((m, i) => {
          const color = MEMBER_PALETTE[i % MEMBER_PALETTE.length]
          this._memberColor[m.openid] = color
          return { openid: m.openid, nickname: m.nickname, on: false }
        })
        this.setData({ members, memberChips })
      }).catch(() => {})
    }
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    this.load()
  },
  buildQuery() {
    const q = { period: this.data.period }
    if (this.data.period === 'month') {
      const [y, m] = (this.data.month || '').split('-')
      q.year = Number(y)
      q.month = Number(m)
    } else if (this.data.period === 'year') q.year = this.data.year
    else { q.start = this.data.start; q.end = this.data.end }
    return q
  },
  formatMonthText(month) {
    const [y, m] = (month || '').split('-')
    return y && m ? (y + '年' + Number(m) + '月') : ''
  },
  periodLabel() {
    if (this.data.period === 'month') return this.formatMonthText(this.data.month)
    if (this.data.period === 'year') return this.data.year + '年'
    return this.data.start + ' ~ ' + this.data.end
  },
  load() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    const sel = this.data.filterMembers
    const base = this.buildQuery()
    // 多选成员：按成员并行请求，各自得到一条趋势线；合计数据客户端合并
    const calls = sel.length
      ? sel.map(id => api.getStats(Object.assign({}, base, { member: id })))
      : [api.getStats(base)]
    Promise.all(calls).then(list => {
      const stats = sel.length ? this.mergeStats(list, sel) : list[0]
      const label = this.periodLabel()
      const total = stats.expense || 1
      const ringLegend = stats.byCategory.map((c) => ({
        name: c.name, amountText: fmt.formatMoney(c.amount),
        color: this._catColor[c.name] || RING_PALETTE[0], percent: (c.amount / total * 100).toFixed(1)
      }))
      this.setData({
        incomeText: fmt.formatMoney(stats.income),
        expenseText: fmt.formatMoney(stats.expense),
        balanceText: fmt.formatMoney(stats.balance),
        periodLabel: label,
        hasData: (stats.income + stats.expense) > 0,
        ringLegend
      })
      this.drawCharts(stats, list, sel)
    }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
  },
  // 合并多个按成员的统计结果为一份合计
  mergeStats(list, sel) {
    const out = { income: 0, expense: 0, byCategory: [], byDay: [], byMember: [] }
    const catMap = {}, dayMap = {}, memMap = {}
    list.forEach(st => {
      out.income += st.income || 0
      out.expense += st.expense || 0
      ;(st.byCategory || []).forEach(c => { catMap[c.name] = (catMap[c.name] || 0) + c.amount })
      ;(st.byDay || []).forEach(d => { dayMap[d.date] = (dayMap[d.date] || 0) + (d.expense || 0) })
      ;(st.byMember || []).forEach(m => { memMap[m.openid] = (memMap[m.openid] || 0) + m.amount })
    })
    out.balance = out.income - out.expense
    out.byCategory = Object.keys(catMap).map(n => ({ name: n, amount: catMap[n] })).sort((a, b) => b.amount - a.amount)
    out.byDay = Object.keys(dayMap).sort().map(d => ({ date: d, amount: dayMap[d] }))
    out.byMember = Object.keys(memMap).map(id => ({ openid: id, nickname: this.memberName(id), amount: memMap[id] })).sort((a, b) => b.amount - a.amount)
    return out
  },
  memberName(id) {
    const m = this.data.members.find(x => x.openid === id)
    return m ? m.nickname : '成员'
  },
  // 由各成员的 byDay 组出统一时间轴的多序列（>40 天按月聚合）
  buildTrendSeries(perMember) {
    const maps = perMember.map(p => {
      const m = {}
      ;(p.byDay || []).forEach(d => { m[d.date] = (m[d.date] || 0) + (d.expense || 0) })
      return m
    })
    const set = {}
    maps.forEach(m => Object.keys(m).forEach(k => { set[k] = true }))
    let axis = Object.keys(set).sort()
    let seriesMaps = maps
    let labels
    if (axis.length > 40) {
      seriesMaps = maps.map(m => {
        const a = {}
        Object.keys(m).forEach(d => { const k = d.slice(0, 7); a[k] = (a[k] || 0) + m[d] })
        return a
      })
      const s2 = {}
      seriesMaps.forEach(a => Object.keys(a).forEach(k => { s2[k] = true }))
      axis = Object.keys(s2).sort()
      labels = axis.map(k => k.slice(5) + '月')
    } else {
      labels = axis.map(k => k.slice(5))
    }
    const lines = perMember.map((p, i) => ({
      name: this.memberName(p.openid),
      color: this._memberColor[p.openid] || '#07C160',
      values: axis.map(k => seriesMaps[i][k] || 0)
    }))
    return { labels, lines }
  },
  // 通用图表渲染：挂载 canvas → 绘制 → 导出图片 → 移除 canvas
  // 用 <image> 展示，规避 canvas 原生层在开发者工具等环境浮到 tabBar 之上的问题
  renderChart(canvasId, imgKey, drawFn) {
    this.setData({ [imgKey]: '', [canvasId + 'On']: true }, () => {
      setTimeout(() => {
        charts.initCanvas(canvasId)
          .then(({ ctx, w, h, node }) => {
            drawFn(ctx, w, h)
            return charts.canvasToImage(node, w, h)
          })
          .then((path) => this.setData({ [imgKey]: path, [canvasId + 'On']: false }))
          .catch(() => this.setData({ [canvasId + 'On']: true })) // 导出失败兜底：直接展示 canvas
      }, 60)
    })
  },
  drawCharts(stats, rawList, sel) {
    // 趋势：选中成员 → 每人一条彩线；未选 → 合计单线
    if (sel && sel.length) {
      const t = this.buildTrendSeries(sel.map((id, i) => ({ openid: id, byDay: rawList[i].byDay || [] })))
      this.setData({ trendLegend: t.lines.map(l => ({ name: l.name, color: l.color })) })
      this.renderChart('trendCanvas', 'trendImg', (ctx, w, h) => charts.drawTrendMulti(ctx, w, h, t.labels, t.lines))
    } else {
      this.setData({ trendLegend: [] })
      let series = stats.byDay.map(d => ({ value: d.expense || 0, label: d.date.slice(5) }))
      if (series.length > 40) {
        const m = {}
        stats.byDay.forEach(d => { const k = d.date.slice(0, 7); m[k] = (m[k] || 0) + d.amount })
        series = Object.keys(m).sort().map(k => ({ value: m[k], label: k.slice(5) + '月' }))
      }
      if (series.length) {
        this.renderChart('trendCanvas', 'trendImg', (ctx, w, h) => charts.drawTrend(ctx, w, h, series, {}))
      } else {
        this.setData({ trendImg: '', trendCanvasOn: false })
      }
    }

    // 环形（byCategory 字段为 amount）
    const ring = stats.byCategory.map((c, i) => ({ name: c.name, value: c.amount, color: this._catColor[c.name] || RING_PALETTE[i % RING_PALETTE.length] }))
    if (ring.length) {
      this.renderChart('ringCanvas', 'ringImg', (ctx, w, h) => charts.drawRing(ctx, w, h, ring, fmt.formatMoney(stats.expense)))
    } else {
      this.setData({ ringImg: '', ringCanvasOn: false })
    }

    // 柱状
    const bars = stats.byMember.map(m => ({ label: m.nickname, value: m.amount }))
    if (bars.length) {
      this.renderChart('barCanvas', 'barImg', (ctx, w, h) => charts.drawBars(ctx, w, h, bars))
    } else {
      this.setData({ barImg: '', barCanvasOn: false })
    }
  },
  setPeriod(e) { this.setData({ period: e.currentTarget.dataset.p }, () => this.load()) },
  onMonth(e) { this.setData({ month: e.detail.value, monthText: this.formatMonthText(e.detail.value) }, () => this.load()) },
  onYear(e) { this.setData({ year: Number(e.detail.value) }, () => this.load()) },
  onStart(e) { this.setData({ start: e.detail.value }, () => this.load()) },
  onEnd(e) { this.setData({ end: e.detail.value }, () => this.load()) },
  // 多选切换：点成员 chip 加/减一个成员
  onFilter(e) {
    const id = e.currentTarget.dataset.id
    const sel = this.data.filterMembers.slice()
    const idx = sel.indexOf(id)
    if (idx >= 0) sel.splice(idx, 1)
    else sel.push(id)
    const memberChips = this.data.memberChips.map(c => Object.assign({}, c, { on: sel.indexOf(c.openid) >= 0 }))
    this.setData({ filterMembers: sel, memberChips }, () => this.load())
  },
  // 全部 = 清空多选
  onFilterAll() {
    const memberChips = this.data.memberChips.map(c => Object.assign({}, c, { on: false }))
    this.setData({ filterMembers: [], memberChips }, () => this.load())
  },
  // 新建：先到全屏分类选择页；编辑：直接打开弹层
  showRecordSheet(id) { recordFlow.start(this, id) },
  onSheetClose() {
    this.setData({ sheetVisible: false })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  },
  onSheetSaved() {
    this.setData({ sheetVisible: false }); this.load()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  }
})
