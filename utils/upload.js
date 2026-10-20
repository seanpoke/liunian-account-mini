// utils/upload.js
// 图片选择 + 压缩：
// - 记账凭证：先压到 1280px / 约 200-400KB，单张硬上限 1MB；
// - 头像：压到 200px / 约 20-40KB（对照《前端改造说明》5.3 / 5.5）。
// - quality 仅对 JPEG 生效，PNG 压完仍偏大时用离屏 canvas 重绘为 JPEG。
const IMAGE_MAX_BYTES = 1024 * 1024   // 凭证单张硬上限 1MB
const IMAGE_SOFT_BYTES = 300 * 1024   // 超过 300KB 才触发压缩
const IMAGE_MAX_COUNT = 3             // 每笔账最多 3 张
const AVATAR_MAX_BYTES = 100 * 1024   // 头像超过 100KB 再压一档

// 失败原因：compress-fail=压缩本身失败（不回落原图）；too-big=压完仍超上限
const FAIL_COMPRESS = 'compress-fail'
const FAIL_TOO_BIG = 'too-big'

function fileSize(p) {
  try {
    const stat = wx.getFileSystemManager().statSync(p)
    return (stat && stat.size) || 0
  } catch (e) {
    return 0
  }
}

function within(p, limit) {
  const s = fileSize(p)
  return !s || s <= limit
}

function compress(src, quality, width, next) {
  wx.compressImage({
    src,
    quality,
    compressedWidth: width,
    success: (r) => next(r.tempFilePath || null),
    fail: () => next(null)
  })
}

// 读文件头判断是否为 PNG：PNG 的 quality 参数不生效，只缩放不改编码，
// 所以体积压不下来时必须换成 JPEG 才能真正减小。
function isPng(p, cb) {
  try {
    wx.getFileSystemManager().readFile({
      filePath: p,
      position: 0,
      length: 8,
      success: (r) => {
        const b = new Uint8Array(r.data)
        cb(b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47)
      },
      fail: () => cb(false)
    })
  } catch (e) {
    cb(false)
  }
}

// 离屏 canvas 重绘为 JPEG（先铺白底，避免 PNG 透明区域变黑）。
// 基础库 < 2.7.0 或机型不支持时回调 null，由调用方兜底。
function toJpeg(src, maxWidth, quality, cb) {
  if (typeof wx.createOffscreenCanvas !== 'function') return cb(null)
  wx.getImageInfo({
    src,
    success(info) {
      const iw = info.width || maxWidth
      const ih = info.height || maxWidth
      const w = Math.max(1, Math.min(maxWidth, iw))
      const h = Math.max(1, Math.round(ih * w / iw))
      let canvas
      try {
        canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
      } catch (e) {
        return cb(null)
      }
      const ctx = canvas.getContext('2d')
      const img = canvas.createImage()
      img.onload = () => {
        try {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          wx.canvasToTempFilePath({
            canvas,
            x: 0, y: 0, width: w, height: h,
            destWidth: w, destHeight: h,
            fileType: 'jpg',
            quality,
            success: (r) => cb(r.tempFilePath || null),
            fail: () => cb(null)
          })
        } catch (e) {
          cb(null)
        }
      }
      img.onerror = () => cb(null)
      img.src = src
    },
    fail: () => cb(null)
  })
}

// 记账凭证：≤300KB 不处理；否则 1280px + quality 70；
// 仍超 1MB：PNG 先转 JPEG，再不行压到 quality 40；始终压不下去回调 (null, 原因)。
// 回调签名为 cb(path, reason)，path 为 null 时 reason 说明失败类型。
function compressToLimit(src, size, cb) {
  if (size && size <= IMAGE_SOFT_BYTES) return cb(src)

  // 最后一档：quality 40 强压
  const squeeze = (p1) => {
    compress(p1, 40, 1280, (p2) => {
      if (p2 && within(p2, IMAGE_MAX_BYTES)) return cb(p2)
      cb(null, FAIL_TOO_BIG)
    })
  }

  compress(src, 70, 1280, (p1) => {
    // 压缩失败不再退回原图（原图可能超过后端 5MB 上限）
    if (!p1) return cb(null, FAIL_COMPRESS)
    if (within(p1, IMAGE_MAX_BYTES)) return cb(p1)
    isPng(p1, (png) => {
      if (!png) return squeeze(p1)
      toJpeg(p1, 1280, 60, (j) => {
        if (j && within(j, IMAGE_MAX_BYTES)) return cb(j)
        squeeze(p1)
      })
    })
  })
}

// 选择记账图片：每张压缩通过后回调一次 (tempFilePath | null, reason)
function chooseImages(count, onReady) {
  const n = Math.min(count, IMAGE_MAX_COUNT)
  if (n <= 0) return
  wx.chooseMedia({
    count: n,
    mediaType: ['image'],
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success(res) {
      const files = res.tempFiles || []
      files.forEach((f) => compressToLimit(f.tempFilePath, f.size, onReady))
    }
  })
}

// 头像：200px 宽 + quality 80；仍偏大再压一档 quality 50，PNG 则转 JPEG。
// 压缩本身失败时回调 null，由调用方提示用户重试（不再静默用原图）。
function compressAvatar(src, cb) {
  compress(src, 80, 200, (p1) => {
    if (!p1) return cb(null)
    if (within(p1, AVATAR_MAX_BYTES)) return cb(p1)
    const fallback = () => compress(p1, 50, 200, (p2) => cb(p2 || p1))
    isPng(p1, (png) => {
      if (!png) return fallback()
      toJpeg(p1, 200, 60, (j) => {
        if (j && within(j, AVATAR_MAX_BYTES)) return cb(j)
        fallback()
      })
    })
  })
}

// 选择头像（相册/拍照）。返回压缩后的临时路径。
function chooseAvatarImage(cb) {
  wx.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success(res) {
      const f = (res.tempFiles || [])[0]
      if (!f) return
      compressAvatar(f.tempFilePath, cb)
    }
  })
}

module.exports = {
  IMAGE_MAX_BYTES, IMAGE_SOFT_BYTES, IMAGE_MAX_COUNT, AVATAR_MAX_BYTES,
  FAIL_COMPRESS, FAIL_TOO_BIG,
  chooseImages, compressToLimit, chooseAvatarImage, compressAvatar
}
