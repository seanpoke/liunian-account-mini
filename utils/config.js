// utils/config.js
// 运行配置：敏感信息（AppSecret 等）绝不出现在前端，仅由服务端在 code2Session 时使用。
//
// ⚠️ 后端服务地址「不要在业务代码里写死 IP / 端口」，统一在此配置：
//   - DEFAULT_API_BASE 为开发环境默认值；
//   - 如需临时切换到其它后端，无需改代码，在开发者工具 Console 执行：
//       wx.setStorageSync('liunian_api_base', 'http://<ip>:<port>/api')
//     即可覆盖；清空覆盖：wx.removeStorageSync('liunian_api_base')。
//   - 生产环境请把 DEFAULT_API_BASE 改为已备案域名（如 https://api.<你的域名>/api）。

// 当前开发环境（本地测试）
const DEFAULT_API_BASE = 'http://10.8.2.83:8445/api'

// 当前开发环境（预生产测试）
// const DEFAULT_API_BASE = 'https://dev-account.sean.ltd/api'

// 生产环境
// const DEFAULT_API_BASE = 'https://account.ltd/api'

// 是否走本地 mock（开发联调后端未就绪时设为 true；接入真实后端设为 false）
const ENABLE_MOCK = false

// 是否展示「演示工具」（切换身份 / 重置隐私弹窗等，依赖 mock）。真实后端请置 false。
const SHOW_DEMO_TOOLS = false

const API_BASE_KEY = 'liunian_api_base'
const CACHE_KEY = 'server_config_cache'
let _cache = null

// 取后端基址：优先 storage 覆盖，其次默认开发环境地址
function getApiBase() {
  try {
    const override = wx.getStorageSync(API_BASE_KEY)
    if (override) return override
  } catch (e) {}
  return DEFAULT_API_BASE
}

function getServerConfig() {
  return new Promise((resolve) => {
    if (_cache) return resolve(_cache)
    const cfg = {
      // 小程序 AppId（公开信息，可下发）
      appId: 'wxb5904d7b622aaa72',
      // 真实后端基址（集中配置，业务代码不写死）
      apiBaseUrl: getApiBase(),
      // 后端未就绪时的开关：true 走本地 mock，false 走真实 wx.request
      enableMock: ENABLE_MOCK,
      // 订阅消息模板 Id（公开配置，非密钥）
      subscribeTemplateId: 'TEMPLATE_DEMO_ID',
      // 邀请有效期（天）
      inviteExpireDays: 7,
      // 家庭人数上限
      familyMemberLimit: 10,
      // 是否展示「演示工具」（切换身份 / 重置隐私弹窗）。交付正式版时置 false。
      showDemoTools: SHOW_DEMO_TOOLS
    }
    _cache = cfg
    try { wx.setStorageSync(CACHE_KEY, cfg) } catch (e) {}
    resolve(cfg)
  })
}

module.exports = { getServerConfig, getApiBase, ENABLE_MOCK, DEFAULT_API_BASE }
