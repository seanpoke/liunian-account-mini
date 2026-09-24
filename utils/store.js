// utils/store.js
// 前端会话状态：当前登录用户（openid / token / 角色 / 所属家庭）。
// 真实环境下由服务端签发的 token 解析得到；此处由 mock 登录写入并持久化到本地。

const SESSION_KEY = 'liunian_session'
const PRIVACY_KEY = 'liunian_privacy_agreed'

function getSession() {
  try { return wx.getStorageSync(SESSION_KEY) || null } catch (e) { return null }
}

function setSession(s) {
  try { wx.setStorageSync(SESSION_KEY, s) } catch (e) {}
  return s
}

function clearSession() {
  try { wx.removeStorageSync(SESSION_KEY) } catch (e) {}
}

function isPrivacyAgreed() {
  try { return !!wx.getStorageSync(PRIVACY_KEY) } catch (e) { return false }
}

function setPrivacyAgreed(v) {
  try { wx.setStorageSync(PRIVACY_KEY, v ? 1 : 0) } catch (e) {}
}

module.exports = {
  getSession, setSession, clearSession,
  isPrivacyAgreed, setPrivacyAgreed
}
