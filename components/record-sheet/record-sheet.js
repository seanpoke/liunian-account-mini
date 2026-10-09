// components/record-sheet/record-sheet.js
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const store = require('../../utils/store')

Component({
  properties: {
    visible: { type: Boolean, value: false, observer(val) { this.onVisible(val) } },
    editId: { type: String, value: '' }
  },
  data: {
    shown: false,
    closing: false,
    type: 'expense',
    amountText: '',
    cats: [],
    selectedCatId: '',
    date: '',
    note: '',
    saving: false
  },
  lifetimes: {
    attached() {
      const fid = store.getSession() && store.getSession().familyId
      api.getCategories(fid).then((cats) => {
        this._cats = cats
        this.setData({ date: fmt.today() })
      }).catch(() => { this.setData({ date: fmt.today() }) })
    }
  },
  methods: {
    onVisible(val) {
      if (val) {
        this.setData({ shown: true, closing: false })
        // 进入编辑模式
        if (this.data.editId) this.loadEdit(this.data.editId)
        else this.resetForm()
      } else if (this.data.shown) {
        this.setData({ closing: true })
        setTimeout(() => this.setData({ shown: false, closing: false }), 280)
      }
    },
    resetForm() {
      this.setData({
        type: 'expense', amountText: '', selectedCatId: '',
        note: '', date: fmt.today(), cats: this._cats.expense, saving: false
      })
    },
    loadEdit(id) {
      api.getTransaction(id).then((t) => {
        this.setData({
          type: t.type, amountText: fmt.fenToYuan(t.amount).toFixed(2),
          selectedCatId: t.categoryId, date: t.date, note: t.note,
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
    selectCat(e) { this.setData({ selectedCatId: e.currentTarget.dataset.id }) },
    save() {
      const d = this.data
      const amount = fmt.yuanToFen(d.amountText)
      if (!amount) { wx.showToast({ title: '请输入金额', icon: 'none' }); return }
      const cat = (d.type === 'income' ? this._cats.income : this._cats.expense).find(c => c.id === d.selectedCatId)
      if (!cat) { wx.showToast({ title: '请选择分类', icon: 'none' }); return }
      const payload = { type: d.type, amount, categoryId: cat.id, date: d.date, note: d.note }
      this.setData({ saving: true })
      const p = d.editId ? api.updateTransaction(d.editId, payload) : api.createTransaction(payload)
      p.then(() => {
        wx.showToast({ title: '已保存', icon: 'success' })
        this.triggerEvent('saved')
        this.close()
      }).catch((e) => { this.setData({ saving: false }); wx.showToast({ title: e.message || '保存失败', icon: 'none' }) })
    },
    remove() {
      if (!this.data.editId) return
      wx.showModal({ title: '删除这笔记录', content: '确定删除吗？', success: (r) => {
        if (!r.confirm) return
        api.deleteTransaction(this.data.editId)
          .then(() => { wx.showToast({ title: '已删除', icon: 'success' }); this.triggerEvent('saved'); this.close() })
          .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
      } })
    },
    close() {
      this.triggerEvent('close')
      this.setData({ closing: true })
      setTimeout(() => this.setData({ shown: false, closing: false }), 280)
    },
    onBackdropTap() {
      if (this.data.saving) return
      this.close()
    },
    stop() {}
  }
})
