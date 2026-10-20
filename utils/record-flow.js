// utils/record-flow.js
// 统一的「记一笔」入口：
//   新建 → 先进全屏分类选择页选类型/分类，选完再拉起记账弹层；
//   编辑 → 分类已定，直接打开弹层。

function hideTabBar(page, hidden) {
  if (typeof page.getTabBar === 'function' && page.getTabBar()) {
    page.getTabBar().setData({ hidden })
  }
}

function openSheet(page, id, preset) {
  hideTabBar(page, true)
  page.setData({ sheetPreset: preset || null, sheetVisible: true, sheetEditId: id || '' })
}

function start(page, id) {
  if (id) {
    openSheet(page, id, null)
    return
  }
  wx.navigateTo({
    url: '/pages/category-picker/category-picker',
    events: {
      // 选中分类后回到原页面并打开记账弹层（分类已带入）
      picked: (cat) => openSheet(page, '', cat)
    }
  })
}

module.exports = { start }
