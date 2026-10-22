// pages/detail/detail.js —— 对照原型：仅按类型 / 按成员筛选，列表按日分组、分页加载
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const store = require('../../utils/store')
const recordFlow = require('../../utils/record-flow')

// 每页条数（与后端 /transactions 的 size 对齐；后端默认 20）
const PAGE_SIZE = 20
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function statusBar() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  return info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20)
}

// 单条流水补齐展示字段
function decorate(t) {
  t.idStr = String(t.id)
  t.amountText = fmt.formatMoney(t.amount)
  t.typeCls = t.type === 'income' ? 'income' : 'expense'
  t.sign = t.type === 'income' ? '+' : '-'
  const time = t.time || (t.createdAt ? t.createdAt.slice(11, 16) : '')
  t.sub = [t.note || '无备注', t.nickname, time].filter(Boolean).join(' · ')
  t.hasImage = Array.isArray(t.images) && t.images.length > 0
  return t
}

// 用「某一天的全部流水」构造分组（含日期标签与当日小计）
function buildGroup(date, items) {
  let inc = 0, exp = 0
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
}

Page({
  data: {
    statusBarHeight: 20,
    typeSel: 'all', memberSel: '', members: [],
    groups: [], total: 0,
    // 分页状态：page 为已加载页码，hasMore 控制触底是否继续请求
    page: 0, hasMore: true, loading: false,
    sheetVisible: false, sheetEditId: '', sheetPreset: null
  },
  onLoad() {
    this.setData({ statusBarHeight: statusBar() })
    const s = store.getSession()
    if (s && s.familyId) {
      api.getMembers(s.familyId).then(list => {
        this.setData({ members: [{ openid: '', nickname: '全部' }].concat(list || []) })
      }).catch(() => {})
    }
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    this.reload()
  },
  // 重新从第一页加载（切换筛选 / 编辑保存后调用）
  reload() {
    this._loaded = 0
    this.setData({ groups: [], total: 0, page: 0, hasMore: true, loading: false }, () => this.loadMore())
  },
  loadMore() {
    if (this.data.loading || !this.data.hasMore) return
    const s = store.getSession()
    if (!s || !s.familyId) return
    const next = this.data.page + 1
    const q = { page: next, size: PAGE_SIZE }
    if (this.data.typeSel !== 'all') q.type = this.data.typeSel
    if (this.data.memberSel) q.member = this.data.memberSel
    this.setData({ loading: true })
    api.getTransactions(q).then((res) => {
      const list = (res.list || []).map(decorate)
      const total = Number(res.total || 0)
      this._loaded = (this._loaded || 0) + list.length
      this.setData({
        groups: this.mergeGroups(this.data.groups, list),
        total,
        page: next,
        loading: false,
        hasMore: list.length > 0 && this._loaded < total
      })
    }).catch((e) => {
      this.setData({ loading: false })
      wx.showToast({ title: e.message, icon: 'none' })
    })
  },
  // 把新一页合并进已有分组：同一日期（跨页）续在当天末尾，其余日期追加为新分组
  mergeGroups(groups, list) {
    if (!list.length) return groups
    const out = groups.slice()
    const order = []
    const byDate = {}
    list.forEach((t) => {
      if (!byDate[t.date]) { byDate[t.date] = []; order.push(t.date) }
      byDate[t.date].push(t)
    })
    order.forEach((date) => {
      const last = out[out.length - 1]
      if (last && last.date === date) out[out.length - 1] = buildGroup(date, last.items.concat(byDate[date]))
      else out.push(buildGroup(date, byDate[date]))
    })
    return out
  },
  // 触底加载下一页
  onReachBottom() {
    this.loadMore()
  },
  onType(e) { this.setData({ typeSel: e.currentTarget.dataset.t }, () => this.reload()) },
  onMember(e) { this.setData({ memberSel: e.currentTarget.dataset.id }, () => this.reload()) },
  openItem(e) { this.showRecordSheet(e.currentTarget.dataset.id) },
  // 新建：先到全屏分类选择页；编辑：直接打开弹层
  showRecordSheet(id) { recordFlow.start(this, id) },
  onSheetClose() {
    this.setData({ sheetVisible: false })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  },
  onSheetSaved() {
    this.setData({ sheetVisible: false })
    // 金额/日期/分类可能变化，回第一页重新拉取，避免分页错位
    this.reload()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false })
  }
})
