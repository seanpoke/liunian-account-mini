// components/prompt-dialog/prompt-dialog.js
// 单行文本输入弹层：原生 input 的 maxlength 硬限制输入长度（超出无法继续输入）。
Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    value: { type: String, value: '' },
    maxlength: { type: Number, value: 10 }
  },
  data: { text: '', count: 0 },
  observers: {
    'visible, value': function (visible, value) {
      if (!visible) return
      const t = value || ''
      this.setData({ text: t, count: t.length })
    }
  },
  methods: {
    noop() {},
    onInput(e) {
      const text = e.detail.value || ''
      this.setData({ text, count: text.length })
    },
    onCancel() {
      this.triggerEvent('cancel')
    },
    onConfirm() {
      const text = (this.data.text || '').trim()
      if (!text) {
        wx.showToast({ title: '内容不能为空', icon: 'none' })
        return
      }
      this.triggerEvent('confirm', { value: text })
    }
  }
})
