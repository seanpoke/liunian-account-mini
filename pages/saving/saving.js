// pages/saving/saving.js —— 家庭储蓄（第二本账）
// 与收支账本互不校验：储蓄的存取不影响收入 / 支出 / 预算，只在自己的余额里增减。
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const store = require('../../utils/store')

const PAGE_SIZE = 20

/** 一条流水 → 展示模型 */
function mapRecord(r) {
  const isTransferIn = r.direction === 'transfer_in'
  const isTransferOut = r.direction === 'transfer_out'
  const isTransfer = isTransferIn || isTransferOut

  let title = '存入'
  let sign = '+'
  let amountCls = 'inc'
  if (r.direction === 'out') { title = '取出'; sign = '−'; amountCls = 'out' }
  if (isTransferIn) { title = '转入'; sign = ''; amountCls = 'gray' }
  if (isTransferOut) { title = '转出'; sign = ''; amountCls = 'gray' }

  let tag = ''
  if (r.source === 'transaction') tag = '储蓄支付'
  else if (r.source === 'adjust') { tag = '余额调整'; title = r.direction === 'out' ? '取出' : '存入' }
  else if (isTransfer) tag = '转账'

  const md = String(r.date || '').slice(5)
  const parts = [md, r.accountName || '', r.operatorName || '']
  if (r.note) parts.push(r.note)

  return {
    id: r.id,
    icon: r.accountIcon || (r.direction === 'in' || isTransferIn ? '📥' : '📤'),
    title,
    tag,
    sign,
    // 金额只留数字：¥ 已由上下文说明（这是储蓄流水），符号单独渲染并留间距
    amountText: fmt.formatMoney(r.amount),
    amountCls,
    sub: parts.filter(Boolean).join(' · '),
    readonly: !!r.readonly,
    raw: r
  }
}

/** 按月分组 + 当月小计（转入/转出不进小计） */
function buildGroups(list) {
  const map = {}
  const order = []
  list.forEach((r) => {
    const key = String(r.date || '').slice(0, 7)
    if (!map[key]) {
      map[key] = {
        key,
        label: key.slice(0, 4) + '年' + Number(key.slice(5, 7)) + '月',
        inFen: 0,
        outFen: 0,
        items: []
      }
      order.push(key)
    }
    const g = map[key]
    const item = mapRecord(r)
    if (r.source !== 'transfer') {
      if (r.direction === 'in') g.inFen += r.amount || 0
      else if (r.direction === 'out') g.outFen += r.amount || 0
    }
    g.items.push(item)
  })
  return order.map((k) => {
    const g = map[k]
    g.inText = fmt.formatMoney(g.inFen)
    g.outText = fmt.formatMoney(g.outFen)
    // 当月差额 = 存入 − 取出（转账不进这两项，挪账户不影响差额）；符号与数字拆开，便于拉开间距
    const net = g.inFen - g.outFen
    g.netSign = net > 0 ? '+' : (net < 0 ? '−' : '')
    g.netText = fmt.formatMoney(Math.abs(net))
    g.netCls = net > 0 ? 'in' : (net < 0 ? 'out' : 'flat')
    return g
  })
}

Page({
  data: {
    familyId: '',

    accounts: [],       // 全部账户（含停用），用于横滚筛选
    accOptions: [],     // 只含启用账户，用于选择面板
    accId: 0,           // 0 = 全部

    balanceText: '0.00',
    monthInText: '0.00',
    monthOutText: '0.00',
    titleName: '家庭储蓄',
    subText: '',
    accountCount: 0,

    groups: [],
    page: 1,
    hasMore: true,
    loading: false,
    loaded: false,
    total: 0,

    today: fmt.today(),
    date: fmt.today(),

    // 弹层：'' | saving（存入/取出共用，靠 dir 区分）| adjust | transfer | pick | edit
    sheet: '',
    submitting: false,
    dir: 'in',              // in = 存入，out = 取出（同一弹层分段切换）
    amountText: '',
    previewText: '',        // 存后余额 / 取后余额
    btnText: '存入',
    note: '',
    errText: '',

    cur: null,          // 存/取/调整的目标账户
    transFrom: null,
    transTo: null,
    transferPreview: '',   // 转账金额下方的实时预览：可转出 / 转出后两个账户各剩多少
    transferBad: false,
    pickTarget: '',     // save | from | to
    pickBack: 'saving', // 选完账户后回到哪个弹层
    pickList: [],       // 账户选择面板的渲染列表（含 checked / disabled）

    // 更新余额
    bookFen: 0,        // 账面余额（只参与算差额，界面不展示）
    realText: '',
    deltaDir: '',
    deltaLine: '',     // 填了金额才出现的一行结论
    needConfirm: false,
    adjustChecked: false,
    lastAdjustText: '',

    editing: null       // 正在编辑的流水
  },

  onLoad(options) {
    const session = store.getSession() || {}
    this.setData({ familyId: session.familyId || '' })
    const ready = this.loadOverview()
    this.loadRecords(true)
    // 首页储蓄卡的「存入 / 取出」直达：?deposit=1 / ?withdraw=1 进来时自动拉起对应弹层
    if (options && (options.deposit || options.withdraw)) {
      ready.then(() => {
        if (!this.data.accOptions.length) return
        if (options.deposit) this.openDeposit()
        else this.openWithdraw()
      })
    }
  },

  onShow() {
    // 从账户管理页返回时刷新
    if (this.data.loaded) {
      this.loadOverview()
      this.loadRecords(true)
    }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadRecords(false)
  },

  /* ---------------- 数据 ---------------- */
  loadOverview() {
    const accId = this.data.accId
    const query = accId ? { accountId: accId } : {}
    return api.getSavingOverview(query).then((res) => {
      const d = res || {}
      const accounts = (d.accounts || []).map((a) => Object.assign({}, a, {
        balanceText: fmt.formatMoney(a.balance)
      }))
      const accOptions = accounts.filter((a) => a.status === 1)
      const cur = accId ? accounts.filter((a) => a.id === accId)[0] : null
      this.setData({
        accounts,
        accOptions,
        accountCount: d.accountCount != null ? d.accountCount : accounts.length,
        balanceText: fmt.formatMoney(d.balance),
        monthInText: fmt.formatMoney(d.monthIn),
        monthOutText: fmt.formatMoney(d.monthOut),
        titleName: cur ? cur.name + ' · 单账户余额' : '家庭储蓄',
        subText: cur ? '' : '共 ' + (d.accountCount != null ? d.accountCount : accounts.length) + ' 个账户'
      })
    }).catch(() => {})
  },

  loadRecords(reset) {
    // 重置（切账户 / 保存后刷新）优先级最高，可以打断上一页请求；翻页则等上一次返回
    if (this.data.loading && !reset) return Promise.resolve()
    if (!reset && !this.data.hasMore) return Promise.resolve()
    const page = reset ? 1 : this.data.page + 1
    const seq = (this._seq = (this._seq || 0) + 1)
    this.setData({ loading: true })
    const query = { page, size: PAGE_SIZE }
    if (this.data.accId) query.accountId = this.data.accId
    return api.getSavingRecords(query).then((res) => {
      if (seq !== this._seq) return          // 已被更新的请求取代，丢弃这次结果
      const d = res || {}
      const list = (d.list || []).map((r) => Object.assign({}, r))
      // 用原始流水数组累积（不再从 groups 反推），重置时整体替换
      this._raws = reset ? list : (this._raws || []).concat(list)
      const total = d.total || 0
      this.setData({
        groups: buildGroups(this._raws),
        page,
        total,
        hasMore: list.length > 0 && this._raws.length < total,
        loading: false,
        loaded: true
      })
    }).catch(() => {
      if (seq !== this._seq) return
      this.setData({ loading: false, loaded: true })
    })
  },

  /* ---------------- 筛选 ---------------- */
  pickFilter(e) {
    this.applyFilter(Number(e.currentTarget.dataset.id) || 0)
  },

  applyFilter(id) {
    if (id === this.data.accId) return
    this._raws = []
    this.setData({ accId: id, groups: [], page: 1, hasMore: true, total: 0 })
    this.loadOverview()
    this.loadRecords(true)
  },

  // 账户多时不用横向滑：从面板里直接选，含「全部账户」一行
  openAccountFilter() {
    if (!this.data.accounts.length) return this.toast('还没有可用的储蓄账户')
    const total = this.data.accounts.reduce((sum, a) => sum + (a.balance || 0), 0)
    const list = [{
      id: 0,
      icon: '🗂',
      name: '全部账户',
      balanceText: fmt.formatMoney(total),
      checked: this.data.accId === 0,
      disabled: false
    }].concat(this.data.accounts.map((a) => ({
      id: a.id,
      icon: a.icon,
      name: a.name + (a.status === 0 ? '（已停用）' : ''),
      balanceText: a.balanceText,
      checked: this.data.accId === a.id,
      disabled: false
    })))
    this.setData({ pickTarget: 'filter', pickBack: 'saving', pickList: list, sheet: 'pick' })
  },

  /* ---------------- 弹层通用 ---------------- */
  closeSheet() {
    this.setData({ sheet: '', errText: '', submitting: false })
  },
  noop() {},

  defaultAccount() {
    const list = this.data.accOptions
    if (!list.length) return null
    const picked = this.data.accId ? list.filter((a) => a.id === this.data.accId)[0] : null
    return picked || list[0]
  },

  onAmount(e) {
    this.setData({ amountText: e.detail.value })
    if (this.data.sheet === 'saving') this.calcPreview()
    if (this.data.sheet === 'transfer') this.checkTransfer(e.detail.value)
  },

  quickAmount(e) {
    const v = String(e.currentTarget.dataset.v)
    this.setData({ amountText: v })
    if (this.data.sheet === 'saving') this.calcPreview()
    if (this.data.sheet === 'transfer') this.checkTransfer(v)
  },

  // 转账「全部」：一次把该账户的钱挪走（余额为 0 时不填，避免填出 0 让按钮看似可用）
  quickAll() {
    const from = this.data.transFrom
    const fen = (from && from.balance) || 0
    if (!fen) return this.toast('该账户没有可转出的余额')
    const v = fmt.fenToYuan(fen).toFixed(2)
    this.setData({ amountText: v })
    this.checkTransfer(v)
  },

  // 取出「全部」：填该账户当前余额，预览会同时变成"取后余额 ¥0.00"
  fillAll() {
    const avail = (this.data.cur && this.data.cur.balance) || 0
    if (!avail) return this.toast('该账户没有可取出的余额')
    this.setData({ amountText: fmt.fenToYuan(avail).toFixed(2) })
    this.calcPreview()
  },

  onNote(e) { this.setData({ note: e.detail.value }) },
  onDate(e) { this.setData({ date: e.detail.value }) },

  onReal(e) {
    const v = e.detail.value
    this.setData({ realText: v })
    this.calcDelta(v)
  },

  /* ---------------- 存入 / 取出（同一弹层，顶部分段切换） ---------------- */
  openDeposit() { this.openSaving('in') },
  openWithdraw() { this.openSaving('out') },

  openSaving(dir) {
    const acc = this.data.accId
      ? this.data.accOptions.filter((a) => a.id === this.data.accId)[0]
      : this.defaultAccount()
    if (!acc) return this.toast('还没有可用的储蓄账户')
    this.setData({
      sheet: 'saving', dir, cur: acc, amountText: '',
      date: fmt.today(), errText: '', submitting: false
    })
    this.calcPreview()
  },

  // 方向切换：金额清零（存 3000 切到取出还留着 3000 会被当成同一笔），账户与日期保留
  switchDir(e) {
    const dir = e.currentTarget.dataset.dir
    if (dir === this.data.dir) return
    this.setData({ dir, amountText: '', errText: '' })
    this.calcPreview()
  },

  // 金额预览：存入看「存后余额」，取出看「取后余额 / 可取出」，超限即时报错
  calcPreview() {
    const acc = this.data.cur
    if (!acc) return
    const amount = fmt.yuanToFen(this.data.amountText)
    const dir = this.data.dir
    const isOut = dir === 'out'
    const limit = acc.balance || 0
    const over = isOut && amount > limit
    const left = isOut ? limit - amount : limit + amount
    let preview
    if (isOut) {
      preview = amount
        ? (over ? '可取出 ¥' + fmt.formatMoney(limit) : '取出后余额 ¥' + fmt.formatMoney(left))
        : '可取出 ¥' + fmt.formatMoney(limit) + '（' + acc.name + '）'
    } else {
      preview = amount
        ? '存入后余额 ¥' + fmt.formatMoney(left)
        : '当前余额 ¥' + fmt.formatMoney(limit) + '（' + acc.name + '）'
    }
    this.setData({
      errText: over ? '超出可取出金额 ¥' + fmt.formatMoney(amount - limit) : '',
      previewText: preview,
      btnText: (isOut ? '取出' : '存入') + (amount ? ' ¥' + fmt.formatMoney(amount) : '')
    })
  },

  submitSaving() {
    const fen = fmt.yuanToFen(this.data.amountText)
    if (!fen) return this.toast('请输入有效金额')
    const acc = this.data.cur
    if (!acc) return this.toast('请选择储蓄账户')
    const isOut = this.data.dir === 'out'
    if (isOut && fen > acc.balance) {
      return this.toast('该账户最多可取出 ¥' + fmt.formatMoney(acc.balance))
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })
    // 存/取弹层不填备注：储蓄流水只需要金额、账户、日期，备注留给转账与「从储蓄支付」这两类复合记录
    const payload = { accountId: acc.id, amount: fen, date: this.data.date }
    const req = isOut ? api.savingWithdraw(payload) : api.savingDeposit(payload)
    req.then(() => {
      this.closeSheet()
      this.toast(isOut ? '已取出' : '已存入')
      this.loadOverview()
      this.loadRecords(true)
    }).catch((e) => {
      this.setData({ submitting: false })
      this.toast((e && e.message) || '保存失败')
    })
  },

  /* ---------------- 更新余额 ---------------- */
  openAdjust() {
    if (!this.data.accOptions.length) return this.toast('还没有可用的储蓄账户')
    // 「全部」视角下先弹账户选择，避免猜错要校准哪个账户
    if (!this.data.accId) {
      return this.setData({ pickTarget: 'save', pickBack: 'adjust', pickList: this.buildPickList('save'), sheet: 'pick' })
    }
    const acc = this.data.accOptions.filter((a) => a.id === this.data.accId)[0]
    if (!acc) return this.toast('还没有可用的储蓄账户')
    this.loadAdjustPreview(acc)
  },

  loadAdjustPreview(acc) {
    api.savingAdjustPreview({ accountId: acc.id }).then((res) => {
      const d = res || {}
      const at = d.lastAdjust && d.lastAdjust.at
      const last = at ? fmt.fmtDate(at) + ' ' + fmt.fmtTime(at) : ''
      this.setData({
        sheet: 'adjust',
        cur: acc,
        bookFen: d.bookBalance || 0,   // 只用于算差额，界面上不展示
        realText: '',                  // 让用户从空开始填"现在实际多少"，而不是预填账面值等他去改
        needConfirm: !!d.needsConfirm,
        adjustChecked: !d.needsConfirm,
        lastAdjustText: last,
        deltaDir: '',
        deltaLine: ''
      })
    }).catch((e) => this.toast((e && e.message) || '加载失败'))
  },

  // 只填实际值，方向与金额都由差额推出；结论压成一行，填之前什么都不显示
  calcDelta(v) {
    const raw = String(v == null ? '' : v).trim()
    const real = fmt.yuanToFen(raw)
    const base = this.data.bookFen || (this.data.cur && this.data.cur.balance) || 0
    const delta = real - base
    const hasInput = raw !== ''
    const dir = !hasInput || delta === 0 ? '' : (delta > 0 ? '存入' : '取出')
    let line = ''
    if (hasInput) {
      line = delta === 0
        ? '与账面一致，无需调整'
        : '差额 ' + (delta > 0 ? '+' : '−') + '¥' + fmt.formatMoney(Math.abs(delta)) +
          ' → 记一笔「' + dir + ' · 余额调整」'
    }
    this.setData({ deltaDir: dir, deltaLine: line })
  },

  toggleAdjustCheck() {
    this.setData({ adjustChecked: !this.data.adjustChecked })
  },

  submitAdjust() {
    const fen = fmt.yuanToFen(this.data.realText)
    if (!this.data.realText) return this.toast('请输入实际余额')
    if (!this.data.deltaDir) return this.toast('余额没有变化，无需更新')
    if (this.data.needConfirm && !this.data.adjustChecked) return this.toast('请先勾选确认')
    if (this.data.submitting) return
    this.setData({ submitting: true })
    // 字段名对齐后端 AdjustReq：actualBalance（分）/ date / confirmed
    api.savingAdjust({
      accountId: this.data.cur.id,
      actualBalance: fen,
      date: fmt.today(),
      confirmed: !!this.data.adjustChecked
    }).then(() => {
      this.closeSheet()
      this.toast('余额已更新')
      this.loadOverview()
      this.loadRecords(true)
    }).catch((e) => {
      this.setData({ submitting: false })
      this.toast((e && e.message) || '提交失败')
    })
  },

  /* ---------------- 转账 ---------------- */
  openTransfer() {
    const list = this.data.accOptions
    if (list.length < 2) return this.toast('至少需要两个启用的储蓄账户')
    const from = this.data.accId
      ? list.filter((a) => a.id === this.data.accId)[0] || list[0]
      : list[0]
    const to = list.filter((a) => a.id !== from.id)[0]
    this.setData({
      sheet: 'transfer', transFrom: from, transTo: to,
      amountText: '', note: '', date: fmt.today(), errText: '', transferBad: false
    })
    this.checkTransfer('')
  },

  openPickForFrom() { this.setData({ pickTarget: 'from', pickBack: 'transfer', pickList: this.buildPickList('from'), sheet: 'pick' }) },
  openPickForTo() { this.setData({ pickTarget: 'to', pickBack: 'transfer', pickList: this.buildPickList('to'), sheet: 'pick' }) },

  // 账户面板右上角「返回」：退回打开它的那个弹层，不强迫用户必须选一个账户
  backFromPick() {
    if (this.data.pickTarget === 'filter') return this.closeSheet()
    const back = this.data.pickBack
    if (back === 'saving' || back === 'transfer') return this.setData({ sheet: back })
    this.closeSheet()
  },

  // 账户选择列表：转账两头互相置灰（从账户面板灰掉到账户、到账户面板灰掉从账户），并算出勾选态
  buildPickList(target) {
    const from = this.data.transFrom
    const to = this.data.transTo
    const cur = this.data.cur
    return this.data.accOptions.map((a) => {
      let checked = false
      if (target === 'from') checked = !!(from && from.id === a.id)
      else if (target === 'to') checked = !!(to && to.id === a.id)
      else checked = !!(cur && cur.id === a.id)
      const disabled = (target === 'from' && !!(to && to.id === a.id)) ||
        (target === 'to' && !!(from && from.id === a.id))
      return {
        id: a.id,
        icon: a.icon,
        name: a.name,
        balanceText: a.balanceText,
        checked,
        disabled
      }
    })
  },

  // 点中间箭头一键互换转出 / 转入，金额不用重填；换完立刻按新「从账户」重算可转出余额
  swapAccounts() {
    const from = this.data.transFrom
    const to = this.data.transTo
    if (!from || !to) return
    this.setData({ transFrom: to, transTo: from, errText: '' })
    this.checkTransfer(this.data.amountText)
  },

  checkTransfer(v) {
    const from = this.data.transFrom || {}
    const to = this.data.transTo || {}
    const fen = fmt.yuanToFen(v)
    const avail = from.balance || 0
    const over = fen > avail
    let preview
    if (over) {
      preview = '「' + from.name + '」余额不足，最多可转 ¥' + fmt.formatMoney(avail)
    } else if (fen) {
      preview = '转出后 ' + from.name + ' ¥' + fmt.formatMoney(avail - fen) +
        ' · ' + to.name + ' ¥' + fmt.formatMoney((to.balance || 0) + fen)
    } else {
      preview = from.name + ' 可转出 ¥' + fmt.formatMoney(avail)
    }
    this.setData({
      transferPreview: preview,
      transferBad: over,
      errText: over ? '超出可转出金额 ¥' + fmt.formatMoney(fen - avail) : ''
    })
  },

  submitTransfer() {
    const fen = fmt.yuanToFen(this.data.amountText)
    if (!fen) return this.toast('请输入有效金额')
    const from = this.data.transFrom
    const to = this.data.transTo
    if (!from || !to) return this.toast('请选择账户')
    if (from.id === to.id) return this.toast('转出与转入不能是同一账户')
    if (fen > from.balance) return this.toast('该账户最多可转出 ¥' + fmt.formatMoney(from.balance))
    if (this.data.submitting) return
    this.setData({ submitting: true })
    api.savingTransfer({
      fromAccountId: from.id,
      toAccountId: to.id,
      amount: fen,
      date: this.data.date,
      note: this.data.note
    }).then(() => {
      this.closeSheet()
      this.toast('已转账')
      this.loadOverview()
      this.loadRecords(true)
    }).catch((e) => {
      this.setData({ submitting: false })
      this.toast((e && e.message) || '转账失败')
    })
  },

  /* ---------------- 账户选择面板 ---------------- */
  // data-back: 选完回到哪个弹层（saving / adjust）。存/取共用 saving，回来时沿用当前 dir
  openPick(e) {
    const back = (e && e.currentTarget && e.currentTarget.dataset.back) || 'saving'
    this.setData({ pickTarget: 'save', pickBack: back, pickList: this.buildPickList('save'), sheet: 'pick' })
  },

  chooseAccount(e) {
    const id = Number(e.currentTarget.dataset.id)
    if (e.currentTarget.dataset.disabled) return this.toast('转出与转入不能是同一账户')
    const target = this.data.pickTarget
    // 「全部账户」面板：选完只是切换筛选，不涉及存取账户
    if (target === 'filter') {
      this.setData({ sheet: '' })
      this.applyFilter(id)
      return
    }
    const acc = this.data.accOptions.filter((a) => a.id === id)[0]
    if (!acc) return
    if (target === 'from') {
      this.setData({ transFrom: acc, sheet: 'transfer', errText: '' })
      this.checkTransfer(this.data.amountText)
    } else if (target === 'to') {
      if (this.data.transFrom && this.data.transFrom.id === acc.id) {
        return this.toast('转出与转入不能是同一账户')
      }
      this.setData({ transTo: acc, sheet: 'transfer', errText: '' })
      this.checkTransfer(this.data.amountText)
    } else if (this.data.pickBack === 'adjust') {
      this.loadAdjustPreview(acc)
    } else {
      this.setData({ cur: acc, sheet: 'saving', errText: '' })
      this.calcPreview()
    }
  },

  /* ---------------- 流水编辑 / 删除 ---------------- */
  onRecordTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    let target = null
    this.data.groups.forEach((g) => {
      g.items.forEach((it) => { if (it.id === id) target = it })
    })
    if (!target) return
    if (target.readonly) return this.toast('该记录关联的账单已作废，不可修改')
    if (target.raw.source === 'transaction') {
      // 组合记录必须成对改：入口在明细页的账单，储蓄侧不单独编辑/删除
      return wx.showModal({
        title: '这笔取出由记账生成',
        content: '请在明细页打开对应账单修改或删除，储蓄流水会成对同步，余额自动回补。',
        confirmText: '去明细',
        success: (r) => {
          if (r.confirm) wx.switchTab({ url: '/pages/detail/detail' })
        }
      })
    }
    if (target.raw.source === 'transfer') {
      wx.showModal({
        title: '删除这笔转账？',
        content: '将同时撤销对应的转入记录，两个账户余额各自回退。',
        confirmColor: '#fa5151',
        success: (r) => { if (r.confirm) this.removeRecord(id) }
      })
      return
    }
    wx.showActionSheet({
      itemList: ['修改', '删除'],
      success: (r) => {
        if (r.tapIndex === 0) this.openEdit(target)
        else this.confirmRemove(target)
      }
    })
  },

  openEdit(item) {
    const r = item.raw
    if (r.source === 'adjust') return this.toast('余额调整记录不可编辑，只能删除后重新校准')
    this.setData({
      sheet: 'edit',
      editing: item,
      cur: this.data.accounts.filter((a) => a.id === r.accountId)[0] || this.data.cur,
      amountText: fmt.fenToYuan(r.amount).toFixed(2),
      date: r.date,
      errText: ''
    })
  },

  submitEdit() {
    const fen = fmt.yuanToFen(this.data.amountText)
    if (!fen) return this.toast('请输入有效金额')
    const item = this.data.editing
    if (!item) return
    if (this.data.submitting) return
    this.setData({ submitting: true })
    api.updateSavingRecord(item.id, {
      amount: fen,
      date: this.data.date
    }).then(() => {
      this.closeSheet()
      this.toast('已保存')
      this.loadOverview()
      this.loadRecords(true)
    }).catch((e) => {
      this.setData({ submitting: false })
      this.toast((e && e.message) || '保存失败')
    })
  },

  confirmRemove(item) {
    wx.showModal({
      title: '删除这笔记录？',
      content: '删除后余额会相应回退，历史流水不可恢复。',
      confirmColor: '#fa5151',
      success: (r) => { if (r.confirm) this.removeRecord(item.id) }
    })
  },

  removeRecord(id) {
    api.deleteSavingRecord(id).then(() => {
      this.toast('已删除')
      this.loadOverview()
      this.loadRecords(true)
    }).catch((e) => this.toast((e && e.message) || '删除失败'))
  },

  /* ---------------- 其它 ---------------- */
  goAccounts() {
    // 从账户面板进来时先收起面板，回来再看最新的账户列表
    this.setData({ sheet: '' })
    wx.navigateTo({ url: '/pages/saving-accounts/saving-accounts' })
  },

  toast(title) {
    wx.showToast({ title: title || '', icon: 'none' })
  }
})
