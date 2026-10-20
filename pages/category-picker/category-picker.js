// pages/category-picker/category-picker.js
// 全屏分类选择页：记一笔的主入口（也用于弹层里「更换分类」），
// 顶部为最近使用的「常用」区，下面是全部分类；选中后通过 eventChannel 回传并返回。
const api = require('../../utils/api')
const store = require('../../utils/store')
const recentCats = require('../../utils/recent-cats')
const { firstEmoji, defaultIcon, cleanIcon } = require('../../utils/cat-icon')

// 每个收支类型下的自定义分类上限（与后端一致）
const CUSTOM_CAT_LIMIT = 20
// 顶部「常用」最多展示几个
const RECENT_LIMIT = 8
const CAT_PALETTE = ['#ff7a45', '#36cfc9', '#ff85c0', '#9254de', '#597ef7', '#f5222d', '#13c2c2', '#fa8c16', '#8c8c8c']

Page({
  data: {
    statusBarHeight: 20,
    // 导航条高度（与微信右上角胶囊对齐）
    navHeight: 44,
    type: 'expense',
    // 三个版块：常用（最近使用）/ 默认（系统预置）/ 自定义（家庭自建）
    recentList: [],
    systemCats: [],
    customCats: [],
    activeId: '',
    // 新增分类后滚动定位到该分类
    scrollToId: '',
    canAddCat: true,
    // 新增分类弹层（图标 + 名称，与记账弹层保持一致）
    catAddShow: false,
    catAddName: '',
    catAddIcon: '🏷️',
    catCustomIcon: '',
    catHasCustom: false,
    catAdding: false
  },
  onLoad(query) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = info.safeArea ? info.safeArea.top : (info.statusBarHeight || 20)
    const type = query && query.type === 'income' ? 'income' : 'expense'
    const activeId = query && query.selectedId !== undefined ? query.selectedId : ''
    // 导航条高度与微信右上角胶囊保持一致（胶囊上下留白对称），「取消」因此放在左侧避开胶囊
    let navHeight = 44
    const rect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    if (rect && rect.height) {
      const gap = Math.max(0, rect.top - statusBarHeight)
      navHeight = rect.height + gap * 2
    }
    this.setData({ statusBarHeight, navHeight, type, activeId })
    this.load()
  },
  load() {
    const fid = store.getSession() && store.getSession().familyId
    return api.getCategories(fid)
      .then((cats) => { this._cats = cats; this.applyType() })
      .catch((e) => wx.showToast({ title: e.message, icon: 'none' }))
  },
  applyType() {
    const all = this._cats || { expense: [], income: [] }
    const type = this.data.type
    const list = type === 'income' ? (all.income || []) : (all.expense || [])
    const customCount = list
      .filter(c => Number(c.isSystem) === 0 && c.familyId !== null && c.familyId !== undefined).length
    // idStr 仅供 wxml 里与 activeId（query 传入的字符串）比较，避免类型不一致导致高亮失效
    // icon 统一清洗：历史脏数据（中文/空值）兜底为该类型的默认图标
    const norm = list.map(c => Object.assign({}, c, { idStr: String(c.id), icon: cleanIcon(c.icon, c.type || type) }))
    // 常用：最近使用过且仍存在的分类，按最近使用倒序
    const recentList = recentCats.get(type, RECENT_LIMIT)
      .map(id => norm.find(c => String(c.id) === String(id)))
      .filter(Boolean)
    // 默认 = 系统预置；自定义 = 家庭自建（increment 的 isSystem=0）
    const systemCats = norm.filter(c => Number(c.isSystem) === 1)
    const customCats = norm.filter(c => Number(c.isSystem) !== 1)
    // 供 pick 按 id 反查（不渲染，故不进 data）
    this._catIndex = {}
    norm.forEach((c) => { this._catIndex[String(c.id)] = c })
    this.setData({
      recentList,
      systemCats,
      customCats,
      canAddCat: customCount < CUSTOM_CAT_LIMIT
    })
  },
  switchType(e) {
    const type = e.currentTarget.dataset.type
    if (type === this.data.type) return
    this.setData({ type }, () => this.applyType())
  },
  pick(e) {
    const id = e.currentTarget.dataset.id
    this.finish((this._catIndex || {})[String(id)])
  },
  // 选中后回传记账弹层并返回
  finish(cat) {
    if (!cat) return
    const ec = this.getOpenerEventChannel && this.getOpenerEventChannel()
    if (ec && ec.emit) {
      ec.emit('picked', {
        id: cat.id, name: cat.name, icon: cat.icon,
        type: cat.type || this.data.type
      })
    }
    wx.navigateBack()
  },
  cancel() {
    wx.navigateBack()
  },

  // ---------- 新增分类（图标 emoji + 名称） ----------
  addCategory() {
    if (!this.data.canAddCat) {
      wx.showToast({ title: '本类自定义分类最多 ' + CUSTOM_CAT_LIMIT + ' 个', icon: 'none' })
      return
    }
    this.setData({
      catAddShow: true,
      catAddName: '',
      catAddIcon: defaultIcon(this.data.type),
      catCustomIcon: '',
      catHasCustom: false,
      catAdding: false
    })
  },
  closeCatAdd() {
    if (this.data.catAdding) return
    this.setData({ catAddShow: false })
  },
  onCatNameInput(e) {
    this.setData({ catAddName: e.detail.value })
  },
  // 自定义图标：只接受 emoji，非 emoji 输入会被清掉
  onCatIconInput(e) {
    const raw = (e.detail.value || '').trim()
    const fallback = defaultIcon(this.data.type)
    // 用空白占位强制刷新输入框（setData 写入相同值时原生 input 可能不刷新），再清空以恢复 placeholder
    const wipe = () => {
      const sentinel = this.data.catCustomIcon === ' ' ? '  ' : ' '
      this.setData({ catCustomIcon: sentinel, catAddIcon: fallback, catHasCustom: false })
      setTimeout(() => this.setData({ catCustomIcon: '' }), 0)
    }
    if (!raw) {
      this.setData({ catCustomIcon: '', catAddIcon: fallback, catHasCustom: false })
      return
    }
    const emoji = firstEmoji(raw)
    if (!emoji) {
      wipe()
      wx.showToast({ title: '仅支持输入 emoji', icon: 'none' })
      return
    }
    if (raw !== emoji) {
      // 输入中混入非 emoji 或多个 emoji：先清空，再只回写第一个 emoji
      this.setData({ catCustomIcon: this.data.catCustomIcon === ' ' ? '' : ' ' })
      setTimeout(() => this.setData({ catCustomIcon: emoji, catAddIcon: emoji, catHasCustom: true }), 0)
      return
    }
    this.setData({ catCustomIcon: emoji, catAddIcon: emoji, catHasCustom: true })
  },
  resetCatIcon() {
    this.setData({ catCustomIcon: '', catAddIcon: defaultIcon(this.data.type), catHasCustom: false })
  },
  confirmAddCategory() {
    if (this.data.catAdding) return
    const name = (this.data.catAddName || '').trim()
    if (!name) { wx.showToast({ title: '请输入分类名称', icon: 'none' }); return }
    const type = this.data.type
    const icon = firstEmoji(this.data.catAddIcon) || defaultIcon(type)
    const color = CAT_PALETTE[Math.floor(Math.random() * CAT_PALETTE.length)]
    this.setData({ catAdding: true })
    api.addCategory({ type, name, icon, color })
      // 创建成功后停留本页（不返回记账弹层）：刷新列表、高亮并滚动到新分类
      .then((created) => {
        this.setData({ catAdding: false, catAddShow: false })
        return this.load().then(() => {
          const id = created && created.id !== undefined && created.id !== null ? String(created.id) : ''
          this.setData({ activeId: id, scrollToId: id ? 'cat-' + id : '' })
          wx.showToast({ title: '已添加', icon: 'success' })
        })
      })
      .catch((err) => {
        this.setData({ catAdding: false })
        wx.showToast({ title: err.message || '添加失败', icon: 'none' })
      })
  },
  // 弹层内部吞掉事件，避免点到遮罩关闭
  noop() {}
})
