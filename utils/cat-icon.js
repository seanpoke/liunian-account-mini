// utils/cat-icon.js
// 分类图标工具：只允许 emoji，非 emoji（含历史脏数据里的中文/空值）统一兜底为默认图标。

// 新增分类的默认图标（不填自定义 emoji 时使用）
function defaultIcon(type) {
  return type === 'income' ? '💰' : '🏷️'
}

// emoji 基字符（不含变体选择符 / ZWJ / 肤色等组合符）
function isEmojiBase(cp) {
  return (
    (cp >= 0x1F000 && cp <= 0x1FAFF) ||
    (cp >= 0x2600 && cp <= 0x27BF) ||
    (cp >= 0x2190 && cp <= 0x21FF) ||
    (cp >= 0x2300 && cp <= 0x23FF) ||
    (cp >= 0x25A0 && cp <= 0x25FF) ||
    (cp >= 0x2B00 && cp <= 0x2BFF) ||
    cp === 0x00A9 || cp === 0x00AE || cp === 0x203C || cp === 0x2049 ||
    cp === 0x2122 || cp === 0x2139 || cp === 0x24C2 ||
    cp === 0x3030 || cp === 0x303D || cp === 0x3297 || cp === 0x3299
  )
}

// 从输入中提取第一个完整 emoji（兼容肤色、ZWJ 组合、国旗、变体选择符）
// 非 emoji 输入返回空串
function firstEmoji(s) {
  const chars = Array.from(String(s || '').trim())
  let i = 0
  while (i < chars.length && !isEmojiBase(chars[i].codePointAt(0))) i++
  if (i >= chars.length) return ''
  let out = chars[i++]
  while (i < chars.length) {
    const cp = chars[i].codePointAt(0)
    const prev = chars[i - 1].codePointAt(0)
    const join = cp === 0xFE0F || cp === 0x200D || cp === 0x20E3 ||
      (cp >= 0x1F3FB && cp <= 0x1F3FF) ||
      (cp >= 0xE0020 && cp <= 0xE007F) ||
      prev === 0x200D ||
      (cp >= 0x1F1E6 && cp <= 0x1F1FF && prev >= 0x1F1E6 && prev <= 0x1F1FF)
    if (!join) break // 第二个独立字符/emoji 不再吸收
    out += chars[i++]
  }
  return out
}

// 展示用：合法 emoji 原样返回，否则用该类型的默认图标
function cleanIcon(icon, type) {
  return firstEmoji(icon) || defaultIcon(type)
}

module.exports = { defaultIcon, firstEmoji, cleanIcon }
