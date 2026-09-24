// pages/index/index.js
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const charts = require('../../utils/charts')
const store = require('../../utils/store')

function statusBar() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  return info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20)
}

Page({
  data: {
    statusBarHeight: 20,
    familyName: '流年小账',
    incomeText: '0.00', expenseText: '0.00', balanceText: '¥0.00',
    monthLabel: '', myInitial: '家',
    todayCount: 0, todayExpenseText: '0.00', todayIncomeText: '0.00',
    recent: [],
    hasData: false,
    miniImg: '', miniOn: false,
    sheetVisible: false, sheetEditId: ''
  },
  onLoad() {
    this.setData({ statusBarHeight: statusBar() })
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this.load()
  },
  load() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    const now = new Date()
    const month = now.getFullYear() + '-' + fmt.pad2(now.getMonth() + 1)
    const WEEK = ['日', '一', '二', '三', '四', '五', '六']
    Promise.all([
      api.getFamily(s.familyId),
      api.getStats({ period: 'month', month }),
      api.getTransactions({ start: fmt.addDays(fmt.today(), -4), end: fmt.today(), size: 200 })
    ]).then(([fam, stats, txRes]) => {
      const txs = txRes.list
      // 今日
      const todayTx = txs.filter(t => t.date === fmt.today())
      let tExp = 0, tInc = 0
      todayTx.forEach(t => t.type === 'income' ? tInc += t.amount : tExp += t.amount)
      // 最近5天分组：日期头「9月23日 / 周三」，行「分类 + 备注 · 成员 · 时间 + ±金额」，尾行「收/支/结余」
      const map = {}
      txs.forEach(t => { (map[t.date] = map[t.date] || []).push(t) })
      const recent = Object.keys(map).sort().reverse().map(date => {
        const p = date.split('-')
        const d = new Date(date + 'T00:00:00')
        const items = map[date].sort((a, b) => a.created_at < b.created_at ? 1 : -1)
        let exp = 0, inc = 0
        items.forEach(t => {
          t.type === 'income' ? inc += t.amount : exp += t.amount
          t.amountText = fmt.formatMoney(t.amount)
          t.typeCls = t.type === 'income' ? 'income' : 'expense'
          t.sign = t.type === 'income' ? '+' : '-'
          const time = t.created_at ? t.created_at.slice(11, 16) : ''
          t.sub = [t.note || '无备注', t.nickname, time].filter(Boolean).join(' · ')
        })
        const bal = inc - exp
        return {
          date,
          dateLabel: parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日',
          week: '周' + WEEK[d.getDay()],
          items,
          expText: fmt.formatMoney(exp),
          incText: fmt.formatMoney(inc),
          balText: (bal >= 0 ? '¥' : '-¥') + fmt.formatMoney(Math.abs(bal)),
          balanceCls: bal >= 0 ? 'income' : 'expense'
        }
      })
      const bal = stats.balance
      this.setData({
        familyName: fam.name,
        monthLabel: now.getFullYear() + '年' + (now.getMonth() + 1) + '月',
        myInitial: (s.nickname || fam.name || '家').slice(0, 1),
        balanceText: (bal >= 0 ? '¥' : '-¥') + fmt.formatMoney(Math.abs(bal)),
        incomeText: fmt.formatMoney(stats.income),
        expenseText: fmt.formatMoney(stats.expense),
        todayCount: todayTx.length,
        todayExpenseText: fmt.formatMoney(tExp),
        todayIncomeText: fmt.formatMoney(tInc),
        recent,
        hasData: txs.length > 0
      })
      this.drawMini(stats.byDay)
    }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
  },
  drawMini(byDay) {
    if (!byDay || !byDay.length) { this.setData({ miniImg: '', miniOn: false }); return }
    const series = byDay.slice(-30).map(d => ({ value: d.amount, label: d.date.slice(5) }))
    // canvas 绘制后导出图片展示并移除节点，规避原生组件层浮到 tabBar 上的问题
    this.setData({ miniImg: '', miniOn: true }, () => {
      setTimeout(() => {
        charts.initCanvas('miniTrend')
          .then(({ ctx, w, h, node }) => {
            // 原型 Hero：白色细线 + 淡面积，无网格/坐标
            charts.drawTrend(ctx, w, h, series, { plain: true, line: '#ffffff', areaTop: 'rgba(255,255,255,0.30)', areaBottom: 'rgba(255,255,255,0.05)' })
            return charts.canvasToImage(node, w, h)
          })
          .then((path) => this.setData({ miniImg: path, miniOn: false }))
          .catch(() => this.setData({ miniOn: true }))
      }, 60)
    })
  },
  goStats() { wx.switchTab({ url: '/pages/stats/stats' }) },
  goRecord() { this.showRecordSheet() },
  goDetail() { wx.switchTab({ url: '/pages/detail/detail' }) },
  showRecordSheet(id) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: true })
    this.setData({ sheetVisible: true, sheetEditId: id || '' })
  },
  onSheetClose() {
    this.setData({ sheetVisible: false })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  },
  onSheetSaved() {
    this.setData({ sheetVisible: false }); this.load()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  }
})
