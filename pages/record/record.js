// pages/record/record.js
const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: {
    statusBarHeight: 20,
    editId: null,
    type: 'expense',
    amountText: '',
    cats: [],
    selectedCatId: '',
    date: '',
    note: '',
    saving: false,
    closing: false
  },
  onLoad(query) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20), date: fmt.today() })
    const cats = api.getCategories()
    this._cats = cats
    this.setData({ cats: cats.expense })
    if (query.id) this.loadEdit(query.id)
  },
  loadEdit(id) {
    api.getTransaction(id).then((t) => {
      this.setData({
        editId: id, type: t.type, amountText: fmt.fenToYuan(t.amount).toFixed(2),
        selectedCatId: t.category_id, date: t.date, note: t.note,
        cats: t.type === 'income' ? this._cats.income : this._cats.expense
      })
    }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
  },
  switchType(e) {
    const type = e.currentTarget.dataset.type
    if (type === this.data.type) return
    this.setData({ type, cats: type === 'income' ? this._cats.income : this._cats.expense, selectedCatId: '' })
  },
  onAmount(e) { this.setData({ amountText: e.detail.value }) },
  onNote(e) { this.setData({ note: e.detail.value }) },
  onDate(e) { this.setData({ date: e.detail.value }) },
  selectCat(e) {
    this.setData({ selectedCatId: e.currentTarget.dataset.id })
  },
  addCustomCat() {
    const type = this.data.type
    wx.showModal({
      title: '新增' + (type === 'income' ? '收入' : '支出') + '分类',
      editable: true, placeholderText: '分类名称',
      success: (r) => {
        if (!r.confirm || !r.content.trim()) return
        const palette = ['#ff7a45', '#36cfc9', '#ff85c0', '#9254de', '#597ef7', '#f5222d', '#13c2c2', '#fa8c16', '#8c8c8c']
        const color = palette[Math.floor(Math.random() * palette.length)]
        api.addCategory({ type, name: r.content.trim(), icon: '🏷️', color })
          .then(() => {
            const cats = api.getCategories()
            this._cats = cats
            this.setData({ cats: type === 'income' ? cats.income : cats.expense })
            wx.showToast({ title: '已添加', icon: 'success' })
          })
          .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },
  save() {
    const d = this.data
    const amount = fmt.yuanToFen(d.amountText)
    if (!amount) { wx.showToast({ title: '请输入金额', icon: 'none' }); return }
    const cat = (d.type === 'income' ? this._cats.income : this._cats.expense).find(c => c.id === d.selectedCatId)
    if (!cat) { wx.showToast({ title: '请选择分类', icon: 'none' }); return }
    const payload = { type: d.type, amount, categoryId: cat.id, categoryName: cat.name, date: d.date, note: d.note }
    this.setData({ saving: true })
    const p = d.editId ? api.updateTransaction(d.editId, payload) : api.createTransaction(payload)
    p.then(() => {
      wx.showToast({ title: '已保存', icon: 'success' })
      this.closeThen(() => wx.navigateBack())
    }).catch((e) => { this.setData({ saving: false }); wx.showToast({ title: e.message || '保存失败', icon: 'none' }) })
  },
  remove() {
    if (!this.data.editId) return
    wx.showModal({ title: '删除这笔记录', content: '确定删除吗？', success: (r) => {
      if (!r.confirm) return
      api.deleteTransaction(this.data.editId)
        .then(() => { wx.showToast({ title: '已删除', icon: 'success' }); this.closeThen(() => wx.navigateBack()) })
        .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
    } })
  },

  closeThen(cb) {
    this.setData({ closing: true })
    setTimeout(() => { if (cb) cb() }, 300)
  },

  onBackdropTap() {
    if (this.data.saving) return
    this.closeThen(() => wx.navigateBack())
  },

  stopPropagation() {}
})
