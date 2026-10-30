// pages/avatar-crop/avatar-crop.js
// 圆形头像裁剪：单指拖动、双指缩放，确认后按圆形可视区域重绘为 OUT_SIZE 的 JPEG，
// 通过 eventChannel('done', path) 回传给上一个页面（由它继续上传）。
const OUT_SIZE = 360        // 导出边长（px），展示尺寸约 120rpx，足够清晰
const MIN_SCALE = 1         // 1 = 图片短边刚好铺满裁剪圆
const MAX_SCALE = 4

Page({
  data: {
    src: '',
    stage: 300,             // 裁剪圆直径（CSS px）
    stageTop: 120,
    stageOffset: -150,      // -stage/2，用 fixed + 50% 居中
    tipTop: 80,
    dispW: 0, dispH: 0, imgLeft: 0, imgTop: 0,
    scale: 1,
    busy: false
  },
  onLoad(query) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const winW = Number(info.windowWidth) || 375
    const winH = Number(info.windowHeight) || 667
    const statusBar = Number(info.statusBarHeight) || 20
    const stage = Math.round(Math.min(winW, winH) * 0.76)
    // 裁剪圆居中偏上，给底部按钮和提示留位置
    const stageTop = Math.max(Math.round((winH - stage) / 2 - winH * 0.05), statusBar + 56)
    let src = ''
    try { src = decodeURIComponent(query.src || '') } catch (e) { src = query.src || '' }
    this.setData({
      src,
      stage,
      stageTop,
      stageOffset: -Math.round(stage / 2),
      tipTop: Math.max(stageTop - 52, statusBar + 8)
    })
    // 手势锚点换算用：裁剪圆中心在屏幕上的坐标
    this._cx = winW / 2
    this._cy = stageTop + stage / 2
    this._dx = 0
    this._dy = 0
    this._mode = ''
    if (!src) { wx.navigateBack(); return }
    this._loadImage()
  },
  _loadImage() {
    wx.getImageInfo({
      src: this.data.src,
      success: (r) => {
        this._imgW = r.width || 1
        this._imgH = r.height || 1
        // 短边铺满裁剪圆所需的基准缩放
        this._base = this.data.stage / Math.min(this._imgW, this._imgH)
        this._apply(1, 0, 0)
      },
      fail: () => {
        wx.showToast({ title: '图片读取失败', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
      }
    })
  },
  // 按「缩放 + 圆心偏移」重算图片显示位置，越界时自动回弹到边缘
  _apply(scale, dx, dy) {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
    const stage = this.data.stage
    const dw = this._imgW * this._base * s
    const dh = this._imgH * this._base * s
    const maxX = Math.max(0, (dw - stage) / 2)
    const maxY = Math.max(0, (dh - stage) / 2)
    const x = Math.min(maxX, Math.max(-maxX, dx || 0))
    const y = Math.min(maxY, Math.max(-maxY, dy || 0))
    this._dx = x
    this._dy = y
    this.setData({
      scale: s,
      dispW: dw,
      dispH: dh,
      imgLeft: (stage - dw) / 2 + x,
      imgTop: (stage - dh) / 2 + y
    })
  },
  onTouchStart(e) {
    if (this.data.busy || !this._base) return
    const t = e.touches || []
    this._sdx = this._dx
    this._sdy = this._dy
    if (t.length === 1) {
      this._mode = 'pan'
      this._x0 = t[0].clientX
      this._y0 = t[0].clientY
    } else if (t.length >= 2) {
      this._mode = 'zoom'
      this._d0 = this._dist(t[0], t[1]) || 1
      this._s0 = this.data.scale
      // 以双指中点为锚点，坐标相对裁剪圆中心
      this._ax = (t[0].clientX + t[1].clientX) / 2 - this._cx
      this._ay = (t[0].clientY + t[1].clientY) / 2 - this._cy
    }
  },
  onTouchMove(e) {
    if (this.data.busy || !this._base) return
    const t = e.touches || []
    if (this._mode === 'pan' && t.length === 1) {
      this._apply(this.data.scale, this._sdx + (t[0].clientX - this._x0), this._sdy + (t[0].clientY - this._y0))
    } else if (this._mode === 'zoom' && t.length >= 2) {
      const d = this._dist(t[0], t[1]) || this._d0
      const s1 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this._s0 * d / this._d0))
      const r = s1 / this._s0
      // 锚点保持不动：d' = a - (a - d0) * r
      this._apply(s1, this._ax - (this._ax - this._sdx) * r, this._ay - (this._ay - this._sdy) * r)
    }
  },
  onTouchEnd() {
    this._mode = ''
  },
  _dist(a, b) {
    const dx = (a.clientX || 0) - (b.clientX || 0)
    const dy = (a.clientY || 0) - (b.clientY || 0)
    return Math.sqrt(dx * dx + dy * dy)
  },
  confirm() {
    if (this.data.busy) return
    if (!this._base) { wx.showToast({ title: '图片还在加载', icon: 'none' }); return }
    this.setData({ busy: true })
    this._export().then((path) => {
      const ec = this.getOpenerEventChannel && this.getOpenerEventChannel()
      if (ec && ec.emit) ec.emit('done', path)
      wx.navigateBack()
    }).catch(() => {
      this.setData({ busy: false })
      wx.showToast({ title: '处理失败，请重试', icon: 'none' })
    })
  },
  cancel() {
    if (this.data.busy) return
    wx.navigateBack()
  },
  // 把「屏幕上的可见区域」等比映射到 OUT_SIZE，重绘成 JPEG（圆形由展示层 border-radius 负责）
  _export() {
    return new Promise((resolve, reject) => {
      if (typeof wx.createOffscreenCanvas !== 'function') return reject(new Error('not supported'))
      let canvas
      try {
        canvas = wx.createOffscreenCanvas({ type: '2d', width: OUT_SIZE, height: OUT_SIZE })
      } catch (e) {
        return reject(e)
      }
      const ctx = canvas.getContext('2d')
      const img = canvas.createImage()
      img.onload = () => {
        try {
          const k = OUT_SIZE / this.data.stage
          const w = this._imgW * this._base * this.data.scale * k
          const h = this._imgH * this._base * this.data.scale * k
          const x = OUT_SIZE / 2 - w / 2 + this._dx * k
          const y = OUT_SIZE / 2 - h / 2 + this._dy * k
          // 先铺白底：JPEG 没有透明通道，PNG 透明区域否则会变黑
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE)
          ctx.drawImage(img, x, y, w, h)
          wx.canvasToTempFilePath({
            canvas,
            x: 0, y: 0,
            width: OUT_SIZE, height: OUT_SIZE,
            destWidth: OUT_SIZE, destHeight: OUT_SIZE,
            fileType: 'jpg',
            quality: 88,
            success: (r) => resolve(r.tempFilePath),
            fail: reject
          })
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = reject
      img.src = this.data.src
    })
  }
})
