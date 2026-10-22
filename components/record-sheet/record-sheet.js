// components/record-sheet/record-sheet.js
// 记账表单弹层：分类由全屏分类选择页选好后带入（preset），这里只负责金额/日期/备注/凭证。
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const store = require('../../utils/store')
const recentCats = require('../../utils/recent-cats')
const { cleanIcon } = require('../../utils/cat-icon')
const { chooseImages, IMAGE_MAX_COUNT, IMAGE_MAX_BYTES, FAIL_COMPRESS } = require('../../utils/upload')

Component({
  properties: {
    visible: { type: Boolean, value: false, observer(val) { this.onVisible(val) } },
    editId: { type: String, value: '' },
    // 全屏分类选择页选中的分类（新建记账时带入）
    preset: {
      type: Object,
      value: null,
      // setData 里 preset 与 visible 同批下发时，属性更新先后不确定，这里补一次兜底
      observer(p) {
        if (!p || p.id === undefined || p.id === null) return
        if (this.data.editId) return
        if (String(p.id) === String(this.data.selectedCatId)) return
        this.applyPickedCat(p)
      }
    }
  },
  data: {
    shown: false,
    closing: false,
    type: 'expense',
    amountText: '',
    selectedCatId: '',
    selectedIcon: '',
    selectedName: '',
    date: '',
    time: '',
    note: '',
    images: [],
    imgMax: IMAGE_MAX_COUNT,
    imgMaxText: (IMAGE_MAX_BYTES / 1024 / 1024) + 'MB',
    uploading: false,
    uploadCount: 0,
    saving: false,
    dragY: 0,
    // 键盘高度：弹层据此整体上移，避免备注等输入项被键盘遮挡
    kbHeight: 0,
    // 表单区滚动定位（正在输入的项滚进视野）
    scrollInto: ''
  },
  lifetimes: {
    attached() {
      this.setData({ date: fmt.today(), time: fmt.fmtTime(new Date()) })
      // 只有备注（f-note）需要避让键盘；金额用数字键盘时不顶起弹层
      this._onKb = (res) => {
        const h = Math.max(0, (res && res.height) || 0)
        this._kbRaw = h
        const lift = this._focusId === 'f-note' ? h : 0
        if (lift === this.data.kbHeight) return
        this.setData({ kbHeight: lift }, () => {
          // 可视区域变化后，把正在输入的项重新滚进视野
          if (this._focusId) this.scrollToField(this._focusId)
        })
      }
      if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this._onKb)
    },
    detached() {
      if (wx.offKeyboardHeightChange && this._onKb) wx.offKeyboardHeightChange(this._onKb)
      this._onKb = null
    }
  },
  methods: {
    onVisible(val) {
      if (val) {
        // 重新打开时清掉上次的聚焦/键盘状态
        this._focusId = ''
        this.setData({ shown: true, closing: false, dragY: 0, kbHeight: 0 })
        // 进入编辑模式
        if (this.data.editId) this.loadEdit(this.data.editId)
        else this.resetForm()
      } else if (this.data.shown) {
        this.setData({ closing: true })
        setTimeout(() => this.setData({ shown: false, closing: false }), 280)
      }
    },
    // 新建：清空表单，并应用分类页带回的分类
    resetForm() {
      this._pending = 0
      const p = this.data.preset
      const patch = {
        type: 'expense', amountText: '',
        selectedCatId: '', selectedIcon: '', selectedName: '',
        note: '', date: fmt.today(), time: fmt.fmtTime(new Date()),
        images: [], uploading: false, uploadCount: 0, saving: false,
        scrollInto: ''
      }
      if (p && p.id !== undefined && p.id !== null) {
        patch.type = p.type === 'income' ? 'income' : 'expense'
        patch.selectedCatId = p.id
        patch.selectedIcon = cleanIcon(p.icon, patch.type)
        patch.selectedName = p.name || ''
      }
      this.setData(patch)
    },
    loadEdit(id) {
      api.getTransaction(id).then((t) => {
        const type = t.type === 'income' ? 'income' : 'expense'
        this.setData({
          type,
          amountText: fmt.fenToYuan(t.amount).toFixed(2),
          selectedCatId: t.categoryId,
          selectedIcon: cleanIcon(t.categoryIcon, type),
          selectedName: t.categoryName || '',
          date: t.date,
          time: t.time || (t.createdAt ? t.createdAt.slice(11, 16) : ''),
          note: t.note,
          images: (t.images || []).map((u) => ({ url: u, fullUrl: fmt.imgUrl(u) }))
        })
      }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
    },
    // 更换分类：重开全屏分类选择页（可顺便切支出/收入）
    openAllCats() {
      const q = '?type=' + this.data.type +
        (this.data.selectedCatId !== '' && this.data.selectedCatId !== undefined
          ? '&selectedId=' + this.data.selectedCatId
          : '')
      wx.navigateTo({
        url: '/pages/category-picker/category-picker' + q,
        events: {
          picked: (cat) => this.applyPickedCat(cat)
        }
      })
    },
    applyPickedCat(cat) {
      if (!cat || cat.id === undefined || cat.id === null) return
      const type = cat.type === 'income' ? 'income' : 'expense'
      this.setData({
        type,
        selectedCatId: cat.id,
        selectedIcon: cleanIcon(cat.icon, type),
        selectedName: cat.name || ''
      })
    },
    onAmount(e) { this.setData({ amountText: e.detail.value }) },
    onNote(e) { this.setData({ note: e.detail.value }) },
    // 金额：数字键盘不顶起弹层，只把金额本身滚进视野
    onAmountFocus() {
      this._focusId = 'f-amount'
      if (this.data.kbHeight) this.setData({ kbHeight: 0 })
      this.scrollToField('f-amount')
    },
    // 备注：需要避让键盘，否则输入内容会被挡住
    onNoteFocus() {
      this._focusId = 'f-note'
      // 从金额（数字键盘）切过来时，键盘高度可能不变而不触发回调，这里先用最近一次高度垫上
      if (this._kbRaw && this._kbRaw !== this.data.kbHeight) this.setData({ kbHeight: this._kbRaw })
      this.scrollToField('f-note')
    },
    scrollToField(id) {
      // 先清空再赋值，保证连续聚焦同一项也能触发滚动
      this.setData({ scrollInto: '' }, () => this.setData({ scrollInto: id }))
    },
    onDate(e) { this.setData({ date: e.detail.value }) },
    onTime(e) { this.setData({ time: e.detail.value }) },

    // ---------- 凭证图片（最多 3 张，非必传） ----------
    chooseImage() {
      const remain = this.data.imgMax - this.data.images.length
      if (remain <= 0) {
        wx.showToast({ title: '最多 ' + this.data.imgMax + ' 张', icon: 'none' })
        return
      }
      chooseImages(remain, (path, reason) => {
        if (!path) {
          wx.showToast({
            title: reason === FAIL_COMPRESS
              ? '图片压缩失败，请重试或换一张'
              : '图片超过 ' + this.data.imgMaxText + '，已跳过',
            icon: 'none'
          })
          return
        }
        this._uploadOne(path)
      })
    },
    _uploadOne(path) {
      const fid = store.getSession() && store.getSession().familyId
      this._pending = (this._pending || 0) + 1
      this.setData({ uploadCount: this._pending, uploading: true })
      const done = () => {
        this._pending = Math.max(0, (this._pending || 1) - 1)
        this.setData({ uploadCount: this._pending, uploading: this._pending > 0 })
      }
      api.upload(path, fid).then((d) => {
        if (!d || !d.url) throw new Error('上传返回地址为空')
        // 按文档：url 原样入库；展示统一走 imgUrl（绝对 CDN 地址原样使用）
        const item = { url: d.url, fullUrl: fmt.imgUrl(d.url) }
        this.setData({ images: this.data.images.concat([item]) })
      }).catch((e) => {
        wx.showToast({ title: e.message || '上传失败', icon: 'none' })
      }).then(done)
    },
    removeImage(e) {
      const idx = Number(e.currentTarget.dataset.index)
      const images = this.data.images.slice()
      images.splice(idx, 1)
      this.setData({ images })
    },
    previewImage(e) {
      const urls = this.data.images.map((i) => i.fullUrl).filter(Boolean)
      if (!urls.length) return
      wx.previewImage({ urls, current: e.currentTarget.dataset.url || urls[0] })
    },

    save() {
      const d = this.data
      if (d.uploading) { wx.showToast({ title: '图片上传中，完成后再保存', icon: 'none' }); return }
      const amount = fmt.yuanToFen(d.amountText)
      if (!amount) { wx.showToast({ title: '请输入金额', icon: 'none' }); return }
      const categoryId = typeof d.selectedCatId === 'number' ? d.selectedCatId : Number(d.selectedCatId)
      if (!categoryId) { wx.showToast({ title: '请选择分类', icon: 'none' }); return }
      const payload = {
        type: d.type, amount, categoryId, date: d.date, time: d.time, note: d.note,
        images: d.images.map((i) => i.url)
      }
      this.setData({ saving: true })
      const p = d.editId ? api.updateTransaction(d.editId, payload) : api.createTransaction(payload)
      p.then(() => {
        // 记一次使用，供分类页顶部「常用」展示
        recentCats.push(d.type, categoryId)
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
      this._focusId = ''
      if (wx.hideKeyboard) wx.hideKeyboard()
      this.triggerEvent('close')
      this.setData({ closing: true })
      setTimeout(() => this.setData({ shown: false, closing: false }), 280)
    },
    // 遮罩层吞掉 touchmove，避免背景列表跟着滚动（滚动穿透）
    preventTouchMove() {},
    onBackdropTap() {
      if (this.data.saving) return
      this.close()
    },
    // 下拉把手关闭：拖动跟手，松手超过阈值关闭，否则回弹
    onDragStart(e) {
      if (this.data.saving) return
      this._dragStartY = e.touches[0].clientY
      this._dragging = true
    },
    onDragMove(e) {
      if (!this._dragging) return
      const dy = Math.max(0, e.touches[0].clientY - this._dragStartY)
      this._dragY = dy
      this.setData({ dragY: dy })
    },
    onDragEnd() {
      if (!this._dragging) return
      this._dragging = false
      const dy = this._dragY || 0
      this._dragY = 0
      if (dy > 100) {
        this.setData({ dragY: 0 })
        this.close()
      } else {
        this.setData({ dragY: 0 })
      }
    },
    stop() {}
  }
})
