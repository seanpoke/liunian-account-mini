Component({
  options: {
    multipleSlots: true // 在组件定义时的选项中启用多slot支持
  },
  /**
   * 组件的属性列表
   */
  properties: {
    extClass: {
      type: String,
      value: ''
    },
    title: {
      type: String,
      value: ''
    },
    background: {
      type: String,
      value: ''
    },
    color: {
      type: String,
      value: ''
    },
    back: {
      type: Boolean,
      value: true
    },
    loading: {
      type: Boolean,
      value: false
    },
    homeButton: {
      type: Boolean,
      value: false,
    },
    animated: {
      // 显示隐藏的时候opacity动画效果
      type: Boolean,
      value: true
    },
    show: {
      // 显示隐藏导航，隐藏的时候navigation-bar的高度占位还在
      type: Boolean,
      value: true,
      observer: '_showChange'
    },
    // back为true的时候，返回的页面深度
    delta: {
      type: Number,
      value: 1
    },
  },
  /**
   * 组件的初始数据
   */
  data: {
    displayStyle: ''
  },
  lifetimes: {
    attached() {
      this._syncTop()
      // 冷启动极早期（安卓扫码进入/从后台唤起时常见）statusBarHeight 可能返回 0，
      // 200ms 后再校准一次，避免导航条时高时矮、偶发压住胶囊。
      this._topTimer = setTimeout(() => this._syncTop(), 200)
    },
    detached() {
      if (this._topTimer) { clearTimeout(this._topTimer); this._topTimer = null }
    },
  },
  pageLifetimes: {
    // 页面每次重新显示（切 tab 回来、后台恢复）都校准一次
    show() { this._syncTop() },
  },
  /**
   * 组件的方法列表
   */
  methods: {
    // 计算并注入导航条高度。任何一步取不到值都不能退化成 0（否则导航条只剩 44/48px）：
    // 1) statusBarHeight  2) 胶囊顶反推（胶囊顶 ≈ 状态栏 + 6px）  3) 24 兜底
    _syncTop() {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const device = wx.getDeviceInfo ? wx.getDeviceInfo()
        : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : win)
      const rect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
      // 胶囊信息异常时不要拿 0 去算宽度，否则右侧留白会占满整屏、标题被挤掉
      const hasCapsule = !!(rect && rect.left > 0 && rect.top > 0 && rect.width > 0)

      let statusBarHeight = Number(win.statusBarHeight) || 0
      if (!(statusBarHeight > 0) && hasCapsule) {
        statusBarHeight = Math.max(0, Math.round(rect.top - 6))
      }
      if (!(statusBarHeight > 0)) {
        statusBarHeight = Number(win.safeArea && win.safeArea.top) || 0
      }
      if (!(statusBarHeight > 0)) statusBarHeight = 24

      // 右侧留白（= 屏幕宽 - 胶囊左边界）用 CSS 的 100vw 计算，不依赖 JS 的 windowWidth：
      // getWindowInfo() 在冷启动早期可能给出异常宽度，一旦偏大会把中间标题挤成竖排。
      const winWidth = Number(win.windowWidth) || 0
      const capsuleOk = hasCapsule && (!winWidth || rect.left < winWidth * 0.9)
      const padStyle = capsuleOk ? `calc(100vw - ${rect.left}px)` : ''

      // 取值没变化就不重复 setData（pageLifetimes.show 会频繁触发）
      const key = [statusBarHeight, padStyle, capsuleOk ? rect.width : 0, device.platform].join('/')
      if (key === this._topKey) return
      this._topKey = key

      this.setData({
        ios: device.platform !== 'android',
        innerPaddingRight: padStyle ? `padding-right: ${padStyle}` : '',
        leftWidth: padStyle ? `width: ${padStyle}` : 'width: auto',
        // 所有平台统一用内联样式补状态栏高度，不再依赖 env(safe-area-inset-top)
        safeAreaTop: `height: calc(var(--height) + ${statusBarHeight}px); padding-top: ${statusBarHeight}px`
      })
    },
    _showChange(show) {
      const animated = this.data.animated
      let displayStyle = ''
      if (animated) {
        displayStyle = `opacity: ${show ? '1' : '0'
          };transition:opacity 0.5s;`
      } else {
        displayStyle = `display: ${show ? '' : 'none'}`
      }
      this.setData({
        displayStyle
      })
    },
    back() {
      const data = this.data
      if (data.delta) {
        wx.navigateBack({
          delta: data.delta
        })
      }
      this.triggerEvent('back', { delta: data.delta }, {})
    }
  },
})
