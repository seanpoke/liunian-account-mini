// utils/config.js
// 模拟「从服务端动态获取运行配置」。
//
// 安全约定（关键）：
//   - AppSecret 等敏感信息【绝不】出现在前端代码中，也【绝不】通过此接口下发。
//   - 真实环境下，AppSecret 仅存于服务端，由服务端在 code2Session 时内部使用；
//     前端能拿到的只是一份「公开运行配置」（appId、接口域名、是否启用 mock、订阅模板 Id 等）。
//   - 本函数用 setTimeout 模拟一次网络往返，体现「配置由服务端下发、非硬编码」的设计。
//
// 生产实现示例（伪代码）：
//   const res = await wx.request({ url: 'https://api.example.com/api/public/config' })
//   return res.data.data   // 其中不包含任何密钥

const CACHE_KEY = 'server_config_cache'
let _cache = null

function getServerConfig() {
  return new Promise((resolve) => {
    if (_cache) return resolve(_cache)

    // 模拟服务端公开配置接口的异步返回
    setTimeout(() => {
      const cfg = {
        // 小程序 AppId（公开信息，可下发）
        appId: 'wxb5904d7b622aaa72',
        // 后端接口基址；真实环境为已备案域名 + HTTPS
        apiBaseUrl: 'https://api.example.com/api',
        // 后端未就绪时的开关：true 走本地 mock，false 走真实 wx.request
        enableMock: true,
        // 订阅消息模板 Id（公开配置，非密钥）
        subscribeTemplateId: 'TEMPLATE_DEMO_ID',
        // 邀请有效期（天）
        inviteExpireDays: 7,
        // 家庭人数上限
        familyMemberLimit: 10,
        // 是否展示「演示工具」（切换身份 / 重置隐私弹窗）。交付正式版时置 false。
        showDemoTools: true
      }
      _cache = cfg
      try { wx.setStorageSync(CACHE_KEY, cfg) } catch (e) {}
      resolve(cfg)
    }, 120)
  })
}

module.exports = { getServerConfig }
