// pages/saving-accounts/saving-accounts.js —— 储蓄账户管理
// 规则：5 个预置账户（活期/定期/国债/基金/保险）完全只读——不可改名、不可排序、不可停用、不可删除；
//       只有家庭自建账户可以改名 / 换图标 / 停用 / 删除（余额必须为 0）。
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const store = require('../../utils/store')

const ICONS = ['💵', '🏦', '📜', '📈', '🛡️', '💳', '🏠', '📦', '🐷', '💎', '📊', '🎯']
const MAX_CUSTOM = 20

// 图标只接受「一个」emoji：拦掉文字/数字/中文，也拦掉一次粘进来一串图标
function isSingleEmoji(v) {
  const s = (v || '').trim()
  if (!s || s.length > 8) return false
  if (/[A-Za-z0-9\u4e00-\u9fa5]/.test(s)) return false
  try {
    // 去掉变体选择符/零宽连接符/肤色修饰后再数，避免 🛡️、👍🏽、👨‍👩‍👧 被误判成多个
    let core = s.replace(/[\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/gu, '')
    core = core.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, 'X')   // 国旗 = 两个区域指示符，算一个
    const hits = core.match(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\u20E3X]/gu) || []
    return hits.length === 1
  } catch (e) {
    return s.length <= 2    // 极老基础库不支持 /u 时退化：已排除文字，长度够短即可
  }
}

Page({
  data: {
    isOwner: false,
    accounts: [],
    total: 0,
    customCount: 0,
    canAdd: true,

    sheet: '',
    editing: null,   // null = 新建
    name: '',
    icon: '💵',
    icons: ICONS,
    submitting: false,
    errText: ''
  },

  onLoad() {
    const session = store.getSession() || {}
    this.setData({ isOwner: session.role === 'owner' })
    this.load()
  },

  onShow() { this.load() },

  load() {
    return api.getSavingAccounts().then((res) => {
      // 接口直接返回数组（5 个预置在前 + 家庭自定义），兼容 {list} 包裹
      const list = Array.isArray(res) ? res : ((res && res.list) || [])
      const accounts = list.map((a) => Object.assign({}, a, {
        balanceText: fmt.formatMoney(a.balance)
      }))
      const customCount = accounts.filter((a) => !a.isSystem).length
      this.setData({
        accounts,
        total: accounts.length,
        customCount,
        canAdd: customCount < MAX_CUSTOM
      })
    }).catch((e) => {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    })
  },

  onTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    const acc = this.data.accounts.filter((a) => a.id === id)[0]
    if (!acc) return
    // 预置账户在列表里没有任何可操作项：点它不该弹窗解释，静默忽略即可（说明常驻在页头）
    if (acc.isSystem) return
    const items = acc.status === 1
      ? ['修改名称 / 图标', '停用账户', '删除账户']
      : ['修改名称 / 图标', '启用账户', '删除账户']
    wx.showActionSheet({
      itemList: items,
      success: (r) => {
        if (r.tapIndex === 0) this.openEdit(acc)
        else if (r.tapIndex === 1) this.toggleStatus(acc)
        else this.confirmDelete(acc)
      }
    })
  },

  openNew() {
    if (!this.data.isOwner) return
    if (!this.data.canAdd) {
      return wx.showToast({ title: '自定义账户最多 ' + MAX_CUSTOM + ' 个', icon: 'none' })
    }
    this.setData({ sheet: 'form', editing: null, name: '', icon: '💵', errText: '' })
  },

  openEdit(acc) {
    this.setData({
      sheet: 'form',
      editing: acc,
      name: acc.name,
      icon: acc.icon || '💵',
      errText: ''
    })
  },

  closeSheet() { this.setData({ sheet: '' }) },
  noop() {},

  onName(e) { this.setData({ name: e.detail.value, errText: '' }) },
  pickIcon(e) { this.setData({ icon: e.currentTarget.dataset.ic, errText: '' }) },
  // 图标可手输：用户想用网格外的 emoji 时不用等我们加预设
  onIconInput(e) { this.setData({ icon: e.detail.value, errText: '' }) },

  submitForm() {
    const name = (this.data.name || '').trim()
    if (!name) return this.toast('请输入账户名称')
    if (name.length > 16) return this.toast('账户名称最多 16 个字')
    const icon = (this.data.icon || '').trim()
    if (!isSingleEmoji(icon)) return this.toast('图标只能填一个 emoji')
    // 同一家庭内账户名唯一：连预置账户（活期/定期/…）一起比，后端也做同样校验
    const dup = this.data.accounts.filter((a) =>
      (a.name || '').trim() === name && (!this.data.editing || a.id !== this.data.editing.id))
    if (dup.length) return this.toast('已有同名账户，换个名字吧')
    if (this.data.submitting) return
    this.setData({ submitting: true })

    const editing = this.data.editing
    const payload = { name, icon }
    const req = editing
      ? api.updateSavingAccount(editing.id, payload)
      : api.addSavingAccount(payload)

    req.then(() => {
      this.setData({ submitting: false })
      this.closeSheet()
      this.load()
      this.toast(editing ? '已保存' : '已创建')
    }).catch((e) => {
      this.setData({ submitting: false })
      this.toast((e && e.message) || '保存失败')
    })
  },

  toggleStatus(acc) {
    const next = acc.status === 1 ? 0 : 1
    api.updateSavingAccount(acc.id, { status: next }).then(() => {
      this.load()
      this.toast(next === 1 ? '已启用' : '已停用')
    }).catch((e) => this.toast((e && e.message) || '操作失败'))
  },

  confirmDelete(acc) {
    if (acc.balance > 0) {
      return wx.showModal({
        title: '余额不为 0，不能删除',
        content: '该账户还有 ¥' + acc.balanceText + '，请先转出到其他账户或取出，再删除。',
        showCancel: false
      })
    }
    wx.showModal({
      title: '删除账户「' + acc.name + '」？',
      content: acc.recordCount > 0
        ? '该账户下还有 ' + acc.recordCount + ' 条历史流水，删除后流水会一并清除，不可恢复。'
        : '删除后不可恢复。',
      confirmColor: '#fa5151',
      success: (r) => {
        if (!r.confirm) return
        api.deleteSavingAccount(acc.id).then(() => {
          this.load()
          this.toast('已删除')
        }).catch((e) => this.toast((e && e.message) || '删除失败'))
      }
    })
  },

  toast(title) { wx.showToast({ title: title || '', icon: 'none' }) }
})
