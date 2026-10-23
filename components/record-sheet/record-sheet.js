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
    // ---- 储蓄联动（第二本账）----
    savingOn: false,            // 支出=从储蓄支付；收入=同时存入
    savingAccounts: [],         // 启用账户
    savingAcc: null,            // 当前选中的储蓄账户
    savingAccBalText: '0.00',
    savingLeftText: '0.00',
    savingOver: false,
    savingErr: '',
    savingLinked: false,        // 编辑态：该笔已关联储蓄，只读展示
    savingLinkedName: '',
    savingAccId: 0,             // 组合记录配对的账户
    savingOriginal: 0,          // 组合记录原来的取出金额（分）
    savingOriginalText: '',     // 上面这个金额的展示值（分 → 元）
    savingCapText: '',          // 改金额上限 = 账户当前余额 + 原取出金额
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
        // 每次打开都刷新账户与余额（可能刚存过 / 新建过账户）
        this.loadSavingAccounts()
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
        savingOn: false, savingAcc: null, savingOver: false, savingErr: '',
        savingLinked: false, savingLinkedName: '',
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
    // ---------- 储蓄联动（第二本账） ----------
    // 账户列表只在打开弹层时拉一次；账户选择用 actionSheet，避免再叠一层半屏
    loadSavingAccounts() {
      api.getSavingAccounts().then((res) => {
        // 接口直接返回数组；只保留启用账户
        const raw = Array.isArray(res) ? res : ((res && res.list) || [])
        const list = raw.filter((a) => a.status === 1)
        const first = list.length ? list[0] : null
        this.setData({
          savingAccounts: list,
          savingAcc: this.data.savingAcc || first
        })
        this.calcSaving()
        this.updateSavingCap()
      }).catch(() => {})
    },

    // 组合记录改金额的上限 = 该账户当前余额 + 原取出金额（与后端口径一致）
    updateSavingCap() {
      if (!this.data.savingLinked) return
      const acc = this.data.savingAccounts.filter((a) => a.id === Number(this.data.savingAccId))[0]
      if (!acc) return
      this.setData({
        savingCapText: fmt.formatMoney(acc.balance + (this.data.savingOriginal || 0)),
        savingAccBalText: fmt.formatMoney(acc.balance),
        savingOriginalText: fmt.formatMoney(this.data.savingOriginal || 0)
      })
    },

    onSavingToggle(e) {
      const on = e.detail.value
      const acc = this.data.savingAcc || this.data.savingAccounts[0] || null
      if (on && !acc) {
        wx.showToast({ title: '还没有可用的储蓄账户', icon: 'none' })
        return this.setData({ savingOn: false })
      }
      this.setData({ savingOn: on, savingAcc: acc })
      this.calcSaving()
    },

    openSavingPick() {
      const list = this.data.savingAccounts
      if (!list.length) {
        wx.showToast({ title: '还没有可用的储蓄账户', icon: 'none' })
        return
      }
      wx.showActionSheet({
        itemList: list.map((a) => a.icon + ' ' + a.name + '（¥' + fmt.formatMoney(a.balance) + '）'),
        success: (r) => {
          const acc = list[r.tapIndex]
          if (!acc) return
          this.setData({ savingAcc: acc })
          this.calcSaving()
        }
      })
    },

    // 支出：余额不足要在前端先拦一次（后端事务内还会再校验）
    calcSaving() {
      // 编辑已关联储蓄的记录：金额上限由服务端按「当前余额 + 原取出」判定，前端不做余额拦截
      if (this.data.savingLinked) return
      // 开关没开就不做余额校验，避免「还没用储蓄」却先报红字
      if (!this.data.savingOn) {
        this.setData({ savingOver: false, savingErr: '' })
        return
      }
      const acc = this.data.savingAcc
      if (!acc) {
        this.setData({ savingOver: false, savingErr: '', savingAccBalText: '0.00', savingLeftText: '0.00' })
        return
      }
      const amount = fmt.yuanToFen(this.data.amountText)
      const left = acc.balance - amount
      const over = this.data.type === 'expense' && left < 0
      this.setData({
        savingAccBalText: fmt.formatMoney(acc.balance),
        savingLeftText: fmt.formatMoney(Math.abs(left)),
        savingOver: over,
        savingErr: over ? '该账户余额不足，最多可支付 ¥' + fmt.formatMoney(acc.balance) : ''
      })
    },

    loadEdit(id) {
      api.getTransaction(id).then((t) => {
        const type = t.type === 'income' ? 'income' : 'expense'
        const linked = !!t.savingLinked
        this.setData({
          type,
          amountText: fmt.fenToYuan(t.amount).toFixed(2),
          selectedCatId: t.categoryId,
          selectedIcon: cleanIcon(t.categoryIcon, type),
          selectedName: t.categoryName || '',
          date: t.date,
          time: t.time || (t.createdAt ? t.createdAt.slice(11, 16) : ''),
          note: t.note,
          images: (t.images || []).map((u) => ({ url: u, fullUrl: fmt.imgUrl(u) })),
          // 已关联储蓄的记录：开关只读展示，需改支付方式请删除后重录
          savingLinked: linked,
          savingLinkedName: t.savingAccountName || '',
          savingAccId: t.savingAccountId || 0,
          savingOriginal: t.amount || 0,
          savingOn: linked
        }, () => { this.calcSaving(); this.updateSavingCap() })
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
      const changed = type !== this.data.type
      this.setData({
        type,
        selectedCatId: cat.id,
        selectedIcon: cleanIcon(cat.icon, type),
        selectedName: cat.name || '',
        // 收支方向变了，储蓄联动语义也变（支出=取出 / 收入=存入），一律重置为关
        savingOn: changed ? false : this.data.savingOn,
        savingOver: false,
        savingErr: ''
      })
      this.calcSaving()
    },
    onAmount(e) {
      this.setData({ amountText: e.detail.value })
      this.calcSaving()
    },
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
      // 储蓄联动：支出=从储蓄支付（余额不足前端先拦一次），收入=同时存入
      const savingOn = d.savingOn && !d.savingLinked
      if (savingOn) {
        if (!d.savingAcc) { wx.showToast({ title: '请选择储蓄账户', icon: 'none' }); return }
        if (d.type === 'expense' && amount > d.savingAcc.balance) {
          wx.showToast({ title: '该账户最多可支付 ¥' + fmt.formatMoney(d.savingAcc.balance), icon: 'none' })
          return
        }
      }
      const payload = {
        type: d.type, amount, categoryId, date: d.date, time: d.time, note: d.note,
        images: d.images.map((i) => i.url)
      }
      if (savingOn) payload.savingAccountId = d.savingAcc.id
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
