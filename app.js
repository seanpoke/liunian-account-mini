// app.js
// 全局应用入口。
// 前端统一通过 utils/api.js 调用真实后端（基址见 utils/config.js，不在业务代码写死 IP/端口）。
// 关键敏感配置（如 AppSecret）绝不出现在前端，仅由服务端在 code2Session 时使用。
const { getServerConfig } = require('./utils/config')

App({
  globalData: {
    config: null
  },
  onLaunch() {
    // 预热配置缓存（模拟从服务端拉取运行配置）
    getServerConfig().then((cfg) => {
      this.globalData.config = cfg
    })
  }
})
