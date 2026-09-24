// app.js
// 全局应用入口。
// 说明：本工程为「前端独立可运行」版本，后端未就绪，全部接口走 mock。
// 关键敏感配置（如 AppSecret）绝不硬编码在前端，而是由 getServerConfig()
// 模拟「从服务端公开配置接口动态获取」——真实环境下 AppSecret 仅存于服务端，
// 由服务端在 code2Session 时使用，前端永远接触不到。
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
