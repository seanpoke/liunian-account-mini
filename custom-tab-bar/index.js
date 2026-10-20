// custom-tab-bar/index.js —— 自定义底部导航（对照原型 tabbar + 中央 fab）
// 亮点：更大字号/图标；中间绿色「＋」固定悬浮，点按进入记一笔。
const GRAY = '#9a9a9a'
const GREEN = '#07C160'

// 线性图标（与原型 svg path 一致），运行时生成 data-uri，无需图片资源
const ICON_PATHS = {
  home: '<path d="M4 10.6 12 4.2l8 6.4V19a1.2 1.2 0 0 1-1.2 1.2h-3.6v-5.6H8.8v5.6H5.2A1.2 1.2 0 0 1 4 19z"/>',
  list: '<path d="M4 7h16M4 12h16M4 17h9"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  mine: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c0-3.6 3.2-5.8 7.2-5.8s7.2 2.2 7.2 5.8"/>'
}

const TABS = [
  { key: 'home', text: '首页', path: '/pages/index/index' },
  { key: 'list', text: '明细', path: '/pages/detail/detail' },
  { key: 'chart', text: '统计', path: '/pages/stats/stats' },
  { key: 'mine', text: '我的', path: '/pages/settings/settings' }
]

function icon(name, color) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<g fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    ICON_PATHS[name] + '</g></svg>'
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

Component({
  data: {
    selected: 0,
    tabs: [],
    hidden: false
  },
  lifetimes: {
    attached() {
      this.setData({
        tabs: TABS.map(function (t) {
          return {
            key: t.key, text: t.text, path: t.path,
            iconGray: icon(t.key, GRAY),
            iconGreen: icon(t.key, GREEN)
          }
        })
      })
    }
  },
  pageLifetimes: {
    show() {
      this.setData({ hidden: false })
    }
  },
  methods: {
    tapTab(e) {
      const idx = e.currentTarget.dataset.index
      wx.switchTab({ url: TABS[idx].path })
    },
    tapAdd() {
      const pages = getCurrentPages()
      const cur = pages[pages.length - 1]
      if (cur && typeof cur.showRecordSheet === 'function') {
        cur.showRecordSheet()
      } else {
        wx.showToast({ title: '当前页面暂不支持记账', icon: 'none' })
      }
    }
  }
})
