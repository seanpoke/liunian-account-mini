// pages/detail/detail.js —— 对照原型：仅按类型 / 按成员筛选，列表按日分组
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const store = require('../../utils/store')

function statusBar() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  return info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20)
}

Page({
  data: {
    statusBarHeight: 20,
    typeSel: 'all', memberSel: '', members: [],
    groups: [], total: 0,
    sheetVisible: false, sheetEditId: ''
  },
  onLoad() {
    this.setData({ statusBarHeight: statusBar() })
    const s = store.getSession()
    if (s && s.familyId) {
      api.getMembers(s.familyId).then(list => {
        this.setData({ members: [{ openid: '', nickname: '全部' }].concat(list.filter(m => m.status === 'active')) })
      }).catch(() => {})
    }
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    this.load()
  },
  load() {
    const s = store.getSession()
    if (!s || !s.familyId) return
    const q = { size: 600 }
    if (this.data.typeSel !== 'all') q.type = this.data.typeSel
    if (this.data.memberSel) q.member = this.data.memberSel
    api.getTransactions(q).then((res) => {
      const WEEK = ['日', '一', '二', '三', '四', '五', '六']
      const map = {}
      let total = 0
      res.list.forEach(t => {
        t.amountText = fmt.formatMoney(t.amount)
        t.typeCls = t.type === 'income' ? 'income' : 'expense'
        t.sign = t.type === 'income' ? '+' : '-'
        const time = t.createdAt ? t.createdAt.slice(11, 16) : ''
        t.sub = [t.note || '无备注', t.nickname, time].filter(Boolean).join(' · ')
        total += t.type === 'income' ? t.amount : -t.amount
        ;(map[t.date] = map[t.date] || []).push(t)
      })
      const groups = Object.keys(map).sort().reverse().map(date => {
        const items = map[date].sort((a, b) => a.createdAt < b.createdAt ? 1 : -1)
        let exp = 0, inc = 0
        items.forEach(t => t.type === 'income' ? inc += t.amount : exp += t.amount)
        const bal = inc - exp
        const p = date.split('-')
        return {
          date,
          dateLabel: parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日',
          week: '周' + WEEK[new Date(date + 'T00:00:00').getDay()],
          items, inc, exp,
          expText: fmt.formatMoney(exp), incText: fmt.formatMoney(inc),
          balText: (bal >= 0 ? '' : '-') + fmt.formatMoney(Math.abs(bal)),
          balanceCls: bal >= 0 ? 'income' : 'expense'
        }
      })
      this.setData({ groups, total: res.total })
    }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
  },
  onType(e) { this.setData({ typeSel: e.currentTarget.dataset.t }, () => this.load()) },
  onMember(e) { this.setData({ memberSel: e.currentTarget.dataset.id }, () => this.load()) },
  openItem(e) { this.showRecordSheet(e.currentTarget.dataset.id) },
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
