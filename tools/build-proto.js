/**
 * build-proto.js —— 把真实小程序源码（WXML/WXSS）一比一转换为离线 HTML 原型
 *
 * 原理：
 *   1) 直接读取 app.wxss、各页面 wxss、组件 wxss，只做 rpx→calc(var(--rpx)*n) 与标签名映射；
 *   2) 直接用真实页面 data 渲染 WXML（支持 wx:if / wx:elif / wx:else / wx:for / {{}}）；
 *   3) 每个画板输出为一个独立 iframe（等同小程序单页样式作用域，避免类名互串）；
 *   4) 自定义组件 navigation-bar / record-sheet / custom-tab-bar 用其自身 wxml + wxss 内联渲染。
 *
 * 用法：node tools/build-proto.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'doc', '高保真原型-代码复刻.html');

/* ---------------- 读取 ---------------- */
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/* ---------------- WXSS → CSS ---------------- */
function toCss(wxss) {
  return wxss
    // rpx → calc(var(--rpx) * n)：保留原始数值，便于与源码逐值对照
    .replace(/(-?\d*\.?\d+)rpx/g, (_, n) => `calc(var(--rpx) * ${n})`)
    // 小程序 page 选择器 → body
    .replace(/(^|[\s,}])page(\s*[,{])/g, '$1body$2')
    // 标签选择器映射（只匹配选择器位置，不碰 text-align 等属性名）
    .replace(/(^|[\s,}])view(\s*[,{])/g, '$1div$2')
    .replace(/(^|[\s,}])text(\s*[,{])/g, '$1span$2')
    .replace(/(^|[\s,}])image(\s*[,{])/g, '$1img$2')
    // image 的默认显示差异
    .replace(/(^|[\s,}])img(\s*[,{])/g, '$1img$2');
}

/* ---------------- 数据提取（用 Proxy + with 求值） ---------------- */
function makeEvalScope() {
  const fnCache = new Map();
  return function evaluate(expr, scope) {
    try {
      const key = expr;
      let f = fnCache.get(key);
      if (!f) {
        f = new Function('s', `with(s){ return (${expr}); }`);
        fnCache.set(key, f);
      }
      return f(scope);
    } catch (e) {
      return '';
    }
  };
}
const evalExpr = makeEvalScope();

function scopeProxy(obj) {
  return new Proxy(obj, {
    has: () => true,
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      return undefined;
    }
  });
}

/** 从页面 js 里抠出 data:{...} 并求值 */
function extractData(jsPath) {
  const src = read(jsPath);
  const i = src.indexOf('data:');
  if (i < 0) return {};
  let start = src.indexOf('{', i);
  // 括号配平
  let depth = 0, end = -1, inStr = null, esc = false;
  for (let p = start; p < src.length; p++) {
    const ch = src[p];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  if (end < 0) return {};
  const text = src.slice(start, end + 1);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('s', `with(s){ return (${text}); }`);
    const stub = new Proxy({}, { has: () => true, get: () => () => '' });
    return fn(stub) || {};
  } catch (e) {
    return {};
  }
}

/* ---------------- 迷你 WXML 解析器 ---------------- */
const TAG_MAP = {
  view: 'div', text: 'span', image: 'img', block: null,
  'scroll-view': 'div', navigator: 'a', picker: 'div',
  switch: 'div', textarea: 'div', label: 'label', button: 'button',
  canvas: 'canvas', input: 'input', form: 'div', icon: 'i'
};
const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'canvas']);

function parseWxml(src) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { pushText(src.slice(i)); break; }
    if (lt > i) pushText(src.slice(i, lt));
    const gt = findTagEnd(src, lt);
    if (gt < 0) { pushText(src.slice(lt)); break; }
    const raw = src.slice(lt + 1, gt).trim();

    if (raw.startsWith('!--')) { i = gt + 1; continue; }
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tag === name) { stack.length = s; break; }
      }
      i = gt + 1;
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1).trim() : raw;
    const m = body.match(/^([\w-]+)/);
    if (!m) { i = gt + 1; continue; }
    const tag = m[1];
    const attrs = parseAttrs(body.slice(tag.length));
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(node);
    i = gt + 1;
  }
  return root.children;

  function pushText(t) {
    if (t.trim()) stack[stack.length - 1].children.push({ tag: '#text', text: t.trim() });
  }
}

function findTagEnd(src, lt) {
  let i = lt + 1, inStr = null;
  while (i < src.length) {
    const ch = src[i];
    if (inStr) { if (ch === inStr) inStr = null; }
    else if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === '>') return i;
    i++;
  }
  return -1;
}

function parseAttrs(text) {
  const attrs = {};
  const re = /([\w:.-]+)(?:\s*=\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(text))) {
    attrs[m[1]] = m[2] === undefined ? true : m[2];
  }
  return attrs;
}

/* ---------------- 渲染 ---------------- */
function interp(str, scope) {
  if (typeof str !== 'string') return str;
  const whole = str.match(/^\{\{([\s\S]+)\}\}$/);
  if (whole) return evalExpr(whole[1], scope);
  return str.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => {
    const v = evalExpr(e, scope);
    return v === undefined || v === null ? '' : String(v);
  });
}

function truthy(v) {
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== '0';
  return !!v;
}

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderNodes(nodes, scope) {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.tag === '#text') { out += esc(interp(node.text, scope)); continue; }

    const a = node.attrs;
    // wx:if / elif / else 链
    if ('wx:if' in a) {
      let picked = null;
      if (truthy(interp(a['wx:if'], scope))) picked = node;
      else {
        let j = i + 1;
        // 跳过换行文本
        while (j < nodes.length && nodes[j].tag === '#text') j++;
        while (j < nodes.length && ('wx:elif' in nodes[j].attrs || 'wx:else' in nodes[j].attrs)) {
          const cand = nodes[j];
          if ('wx:elif' in cand.attrs && truthy(interp(cand.attrs['wx:elif'], scope))) { picked = cand; }
          else if ('wx:else' in cand.attrs) { picked = cand; }
          if (picked) break;
          j++;
          while (j < nodes.length && nodes[j].tag === '#text') j++;
        }
        i = j; // 消费掉链上后续分支
      }
      if (picked) out += renderNode({ ...picked, attrs: stripCond(picked.attrs) }, scope);
      continue;
    }
    if ('wx:elif' in a || 'wx:else' in a) continue;
    out += renderNode(node, scope);
  }
  return out;
}

function stripCond(attrs) {
  const o = { ...attrs };
  delete o['wx:if']; delete o['wx:elif']; delete o['wx:else'];
  return o;
}

function renderNode(node, scope) {
  const a = node.attrs;

  // wx:for
  if ('wx:for' in a) {
    const list = interp(a['wx:for'], scope) || [];
    const itemName = a['wx:for-item'] || 'item';
    const idxName = a['wx:for-index'] || 'index';
    const attrs = { ...a };
    delete attrs['wx:for']; delete attrs['wx:for-item']; delete attrs['wx:for-index']; delete attrs['wx:key'];
    const arr = Array.isArray(list) ? list : Object.values(list);
    return arr.map((it, idx) => renderNode({ ...node, attrs }, { ...scope, [itemName]: it, [idxName]: idx })).join('');
  }

  // 自定义组件
  if (node.tag === 'navigation-bar') return renderNavigation(a, scope);
  if (node.tag === 'record-sheet') return renderRecordSheet(a, scope);
  if (node.tag === 'custom-tab-bar') return renderTabbar();

  const mapped = TAG_MAP[node.tag];
  const tag = mapped === undefined ? node.tag : mapped;
  if (tag === null) return renderNodes(node.children, scope); // block

  const htmlAttrs = [];
  const classes = [];
  if (a.class) classes.push(interp(a.class, scope));
  if (a['hover-class']) classes.push('');
  if (classes.join('').trim()) htmlAttrs.push(`class="${esc(classes.join(' '))}"`);

  if (a.style) htmlAttrs.push(`style="${esc(interp(a.style, scope))}"`);
  if (a.id) htmlAttrs.push(`id="${esc(interp(a.id, scope))}"`);

  // scroll-view 的滚动属性
  if (node.tag === 'scroll-view') {
    const extra = [];
    if ('scroll-x' in a || truthy(interp(a['scroll-x'], scope))) extra.push('overflow-x:auto', 'overflow-y:hidden');
    if ('scroll-y' in a) extra.push('overflow-y:auto');
    const st = interp(a.style || '', scope);
    htmlAttrs.push(`style="${esc((st ? st + ';' : '') + extra.join(';'))}"`);
  }

  if (tag === 'img') {
    const src = interp(a.src || '', scope);
    if (src) htmlAttrs.push(`src="${esc(src)}"`);
    else htmlAttrs.push(`src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"`);
    htmlAttrs.push('alt=""');
  }
  if (tag === 'input') {
    const val = a.value !== undefined ? interp(a.value, scope) : '';
    const ph = a.placeholder ? interp(a.placeholder, scope) : '';
    const type = a.type === 'digit' || a.type === 'number' ? 'text' : 'text';
    htmlAttrs.push(`type="${type}"`);
    if (val !== '' && val !== undefined) htmlAttrs.push(`value="${esc(val)}"`);
    if (ph) htmlAttrs.push(`placeholder="${esc(ph)}"`);
    if (a['placeholder-class']) {
      // 用 CSS 变量式占位样式无法逐类，简单忽略
    }
  }
  if (a.hidden !== undefined && truthy(interp(a.hidden, scope))) {
    htmlAttrs.push('style="display:none"');
  }
  if (node.tag === 'button') htmlAttrs.push('type="button"');

  const inner = renderNodes(node.children, scope);
  if (tag === 'img' || tag === 'input') return `<${tag} ${htmlAttrs.join(' ')} />`;
  return `<${tag} ${htmlAttrs.join(' ')}>${inner}</${tag}>`;
}

/* ---------------- 组件内联 ---------------- */
const NAV_WXML = read('components/navigation-bar/navigation-bar.wxml');
const NAV_WXSS = toCss(read('components/navigation-bar/navigation-bar.wxss'));
const NAV_NODES = parseWxml(NAV_WXML);

function renderNavigation(attrs, scope) {
  const vm = {
    extClass: '',
    ios: true,
    color: attrs.color ? interp(attrs.color, scope) : 'black',
    background: attrs.background ? interp(attrs.background, scope) : '#ffffff',
    displayStyle: '',
    innerPaddingRight: 'padding-right: 0',
    safeAreaTop: 'padding-top: 44px', // 模拟刘海屏状态栏
    leftWidth: 'width: 88px',
    back: attrs.back !== undefined ? truthy(interp(attrs.back, scope)) : true,
    homeButton: attrs.homeButton !== undefined ? truthy(interp(attrs.homeButton, scope)) : false,
    title: attrs.title ? interp(attrs.title, scope) : '',
    loading: false
  };
  return renderNodes(NAV_NODES, scopeProxy(vm));
}

const REC_WXML = read('components/record-sheet/record-sheet.wxml');
const REC_WXSS = toCss(read('components/record-sheet/record-sheet.wxss'));
const REC_NODES = parseWxml(REC_WXML);

function renderRecordSheet(attrs, scope) {
  const visible = attrs.visible !== undefined ? truthy(interp(attrs.visible, scope)) : false;
  const vm = {
    shown: visible,
    closing: false,
    kbHeight: 0,
    dragY: 0,
    scrollInto: '',
    selectedIcon: '🛋',
    selectedName: '家居',
    amountText: attrs.amountText ? interp(attrs.amountText, scope) : '1286.00',
    date: '2026-10-18',
    time: '18:30',
    note: '买冰箱',
    images: [],
    imgMax: 3,
    imgMaxText: '5MB',
    uploading: false,
    saving: false,
    editId: attrs.editId !== undefined && interp(attrs.editId, scope) ? 1 : 0
  };
  return renderNodes(REC_NODES, scopeProxy(vm));
}

const TAB_WXML = read('custom-tab-bar/index.wxml');
const TAB_WXSS = toCss(read('custom-tab-bar/index.wxss'));
const TAB_NODES = parseWxml(TAB_WXML);

/* 与 custom-tab-bar/index.js 完全相同的图标生成逻辑（运行时 attached 才生成，故此处复跑） */
const svgUri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const TAB_ICON_PATHS = {
  home: '<path d="M4 10.6 12 4.2l8 6.4V19a1.2 1.2 0 0 1-1.2 1.2h-3.6v-5.6H8.8v5.6H5.2A1.2 1.2 0 0 1 4 19z"/>',
  list: '<path d="M4 7h16M4 12h16M4 17h9"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  mine: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c0-3.6 3.2-5.8 7.2-5.8s7.2 2.2 7.2 5.8"/>'
};
function tabIcon(name, color) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<g fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    TAB_ICON_PATHS[name] + '</g></svg>';
  return svgUri(svg);
}
const TABS = [
  { key: 'home', text: '首页' },
  { key: 'list', text: '明细' },
  { key: 'chart', text: '统计' },
  { key: 'mine', text: '我的' }
].map((t) => ({ ...t, iconGray: tabIcon(t.key, '#9a9a9a'), iconGreen: tabIcon(t.key, '#07C160') }));

function renderTabbar(selected = 0) {
  const vm = { selected, tabs: TABS, hidden: false };
  return renderNodes(TAB_NODES, scopeProxy(vm));
}

/* ---------------- 演示数据（只填值，结构 / 样式 / 类名仍来自源码） ---------------- */
const CHART = {
  mini: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 34" preserveAspectRatio="none">' +
    '<path d="M0 26 L40 22 L80 24 L120 14 L160 18 L200 10 L240 13 L300 6 L300 34 L0 34 Z" fill="#ffffff" opacity=".16"/>' +
    '<path d="M0 26 L40 22 L80 24 L120 14 L160 18 L200 10 L240 13 L300 6" fill="none" stroke="#ffffff" stroke-width="1.6"/></svg>'),
  ring: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="none" stroke-width="14">' +
    '<circle cx="50" cy="50" r="40" stroke="#07C160" stroke-dasharray="88 164" transform="rotate(-90 50 50)"/>' +
    '<circle cx="50" cy="50" r="40" stroke="#FFB020" stroke-dasharray="63 189" stroke-dashoffset="-88" transform="rotate(-90 50 50)"/>' +
    '<circle cx="50" cy="50" r="40" stroke="#4C8DFF" stroke-dasharray="50 202" stroke-dashoffset="-151" transform="rotate(-90 50 50)"/></g></svg>'),
  trend: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" preserveAspectRatio="none">' +
    '<polyline points="0,96 50,88 100,72 150,80 200,52 250,60 300,36" fill="none" stroke="#07C160" stroke-width="2"/>' +
    '<polyline points="0,104 50,100 100,92 150,84 200,86 250,70 300,64" fill="none" stroke="#fa5151" stroke-width="2"/></svg>'),
  bar: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" preserveAspectRatio="none">' +
    '<rect x="18" y="52" width="42" height="68" rx="5" fill="#07C160"/>' +
    '<rect x="84" y="76" width="42" height="44" rx="5" fill="#4C8DFF"/>' +
    '<rect x="150" y="88" width="42" height="32" rx="5" fill="#FFB020"/>' +
    '<rect x="216" y="96" width="42" height="24" rx="5" fill="#9B6BFF"/></svg>')
};

const HOME_ITEMS = [
  {
    id: 1, categoryIcon: '🛋', categoryName: '家居', hasImage: false,
    amountText: '1,200.00', typeCls: 'expense', sign: '-', sub: '买冰箱 · 妈妈 · 18:30'
  },
  {
    id: 2, categoryIcon: '🍜', categoryName: '餐饮', hasImage: true,
    amountText: '86.00', typeCls: 'expense', sign: '-', sub: '午饭 · 爸爸 · 12:05'
  },
  {
    id: 3, categoryIcon: '💰', categoryName: '工资', hasImage: false,
    amountText: '20,000.00', typeCls: 'income', sign: '+', sub: '10 月工资 · 爸爸 · 09:12'
  }
];

const MOCK = {
  'pages/index/index.wxml': {
    familyName: '流年小账',
    monthLabel: '2026年10月',
    myInitial: '黄',
    myAvatar: '',
    balanceText: '¥12,000.00',
    incomeText: '20,000.00',
    expenseText: '8,000.00',
    todayCount: 2,
    todayExpenseText: '1,286.00',
    todayIncomeText: '0.00',
    hasData: true,
    miniImg: CHART.mini,
    miniOn: false,
    recent: [
      {
        date: '2026-10-18', dateLabel: '10月18日', week: '周六',
        items: [HOME_ITEMS[0], HOME_ITEMS[1]],
        expText: '1,286.00', incText: '0.00', balText: '-¥1,286.00', balanceCls: 'expense'
      },
      {
        date: '2026-10-15', dateLabel: '10月15日', week: '周三',
        items: [HOME_ITEMS[2]],
        expText: '0.00', incText: '20,000.00', balText: '¥20,000.00', balanceCls: 'income'
      }
    ]
  },
  'pages/detail/detail.wxml': {
    typeSel: 'all',
    memberSel: '',
    members: [{ openid: 'o1', nickname: '妈妈' }, { openid: 'o2', nickname: '爸爸' }],
    groups: [
      {
        date: '2026-10-18', dateLabel: '10月18日', week: '周六',
        items: [HOME_ITEMS[0], HOME_ITEMS[1]],
        inc: 0, exp: 1286, incText: '0.00', expText: '1,286.00',
        balText: '-¥1,286.00', balanceCls: 'expense'
      },
      {
        date: '2026-10-15', dateLabel: '10月15日', week: '周三',
        items: [HOME_ITEMS[2]],
        inc: 20000, exp: 0, incText: '20,000.00', expText: '0.00',
        balText: '¥20,000.00', balanceCls: 'income'
      }
    ],
    total: 3, page: 1, hasMore: false, loading: false,
    sheetVisible: false, sheetEditId: '', sheetPreset: null
  },
  'pages/stats/stats.wxml': {
    period: 'month',
    month: '2026-10',
    monthText: '2026年10月',
    year: '2026',
    start: '2026-10-01',
    end: '2026-10-22',
    hasData: true,
    incomeText: '20,000.00',
    expenseText: '8,000.00',
    balanceText: '¥12,000.00',
    periodLabel: '2026年10月',
    memberChips: [{ openid: 'o1', nickname: '妈妈', on: false }, { openid: 'o2', nickname: '爸爸', on: false }],
    filterMembers: [],
    ringLegend: [
      { name: '家居', color: '#07C160', percent: 35, amountText: '2,800.00' },
      { name: '餐饮', color: '#FFB020', percent: 25, amountText: '2,000.00' },
      { name: '交通', color: '#4C8DFF', percent: 20, amountText: '1,600.00' },
      { name: '其他', color: '#9B6BFF', percent: 20, amountText: '1,600.00' }
    ],
    trendLegend: [{ name: '收入', color: '#07C160' }, { name: '支出', color: '#fa5151' }],
    ringCanvasOn: false, ringImg: CHART.ring,
    trendCanvasOn: false, trendImg: CHART.trend,
    barCanvasOn: false, barImg: CHART.bar
  },
  'pages/settings/settings.wxml': {
    familyName: '流年小账',
    familyAvatarUrl: '',
    familyAvatarError: false,
    iconHouse: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<path d="M4 10.4 12 4.2l8 6.2V19a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 19z" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<path d="M9.6 20.4v-5.2h4.8v5.2" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>'),
    memberCount: 4,
    monthCount: 12,
    ownerName: '妈妈',
    isOwner: true,
    curIdentity: 'owner',
    nickname: '妈妈',
    role: 'owner',
    members: [
      { memberId: 1, displayName: '妈妈', sub: '创建者 · 本月记账 6 笔', role: 'owner', initial: '妈', bg: '#07C160' },
      { memberId: 2, displayName: '爸爸', sub: '加入于 2026-08-12 · 本月记账 4 笔', role: 'member', initial: '爸', bg: '#4C8DFF' },
      { memberId: 3, displayName: '小黄', sub: '加入于 2026-09-01 · 本月记账 2 笔', role: 'member', initial: '黄', bg: '#9B6BFF' }
    ],
    pending: [
      { requestId: 11, nickname: '小姨', sub: '申请加入 · 2 小时前', initial: '姨', bg: '#FFB020', avatarUrl: '' }
    ],
    sheetShow: false,
    inviteShow: false,
    qrImageUrl: '',
    qrToken: '',
    qrMeta: { expireDays: 7, memberLimit: 10 },
    sheetMember: {},
    sheetActions: {},
    nameEditShow: false,
    nameEditTitle: '',
    nameEditValue: '',
    sheetVisible: false,
    sheetEditId: '',
    sheetPreset: null
  }
};

/* ---------------- 组装一个画板 ---------------- */
const STATUS_BAR = ''; // navigation-bar 已用 padding-top:44px 模拟状态栏

function buildScreen({ name, wxmlPath, wxssPaths, jsPath, extraCss = '', bodyClass = '', appendAfter = '', mock = {} }) {
  const wxss = wxssPaths.map((p) => toCss(read(p))).join('\n');
  const appCss = toCss(read('app.wxss'));
  const data = Object.assign({}, jsPath ? extractData(jsPath) : {}, MOCK[wxmlPath] || {}, mock);
  const nodes = parseWxml(read(wxmlPath));
  const html = renderNodes(nodes, scopeProxy(data)) + appendAfter;

  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  :root{ --rpx: 0.5px; } /* 750rpx = 375px，1rpx = 0.5px */
  html,body{height:100%;}
  body{margin:0;-webkit-font-smoothing:antialiased;}
  *{box-sizing:border-box;}
  /* ---- app.wxss ---- */
${appCss}
  /* ---- page wxss ---- */
${wxss}
  /* ---- components ---- */
${NAV_WXSS}
${REC_WXSS}
${TAB_WXSS}
  /* ---- proto 补丁：仅处理浏览器与小程序渲染差异，不改数值 ---- */
  img{display:block;}
  input{border:none;outline:none;background:transparent;font-family:inherit;font-size:inherit;color:inherit;padding:0;}
  button{font-family:inherit;}
  ${extraCss}
</style></head>
<body class="${bodyClass}">${html}</body></html>`;

  return { name, doc };
}

/* ---------------- 画板清单 ---------------- */
const SCREENS = [
  {
    name: '首页 · pages/index/index',
    cfg: {
      wxmlPath: 'pages/index/index.wxml',
      wxssPaths: ['pages/index/index.wxss'],
      jsPath: 'pages/index/index.js',
      appendAfter: renderTabbar(0)
    }
  },
  {
    name: '明细 · pages/detail/detail',
    cfg: {
      wxmlPath: 'pages/detail/detail.wxml',
      wxssPaths: ['pages/detail/detail.wxss'],
      jsPath: 'pages/detail/detail.js',
      appendAfter: renderTabbar(1)
    }
  },
  {
    name: '统计 · pages/stats/stats',
    cfg: {
      wxmlPath: 'pages/stats/stats.wxml',
      wxssPaths: ['pages/stats/stats.wxss'],
      jsPath: 'pages/stats/stats.js',
      appendAfter: renderTabbar(2)
    }
  },
  {
    name: '我的 · pages/settings/settings',
    cfg: {
      wxmlPath: 'pages/settings/settings.wxml',
      wxssPaths: ['pages/settings/settings.wxss'],
      jsPath: 'pages/settings/settings.js',
      appendAfter: renderTabbar(3)
    }
  },
  {
    name: '记一笔 · record-sheet（新建）',
    cfg: {
      wxmlPath: 'pages/index/index.wxml',
      wxssPaths: ['pages/index/index.wxss'],
      jsPath: 'pages/index/index.js',
      appendAfter: renderRecordSheet({ visible: '{{true}}' }, scopeProxy({}))
    }
  },
  {
    name: '编辑记录 · record-sheet（editId）',
    cfg: {
      wxmlPath: 'pages/detail/detail.wxml',
      wxssPaths: ['pages/detail/detail.wxss'],
      jsPath: 'pages/detail/detail.js',
      appendAfter: renderRecordSheet({ visible: '{{true}}', editId: '{{1}}' }, scopeProxy({}))
    }
  }
];

/* ---------------- 输出 ---------------- */
const boards = SCREENS.map(({ name, cfg }) => {
  const { doc } = buildScreen(cfg);
  const leftover = (doc.match(/\{\{/g) || []).length;
  return { name, doc, leftover };
});

const page = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>高保真原型 · 代码一比一复刻</title>
<style>
  :root{--brand:#07C160;--bg:#eef0f3;--line:#e3e6ea;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);font-family:-apple-system,"PingFang SC","Helvetica Neue",Helvetica,sans-serif;color:#1a1a1a;padding:28px 24px 60px;}
  h1{font-size:18px;margin:0 0 6px;}
  .lead{font-size:12.5px;color:#6b7280;line-height:1.7;margin:0 0 20px;max-width:900px;}
  .lead code{background:#fff;border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:11.5px;}
  .grid{display:flex;flex-wrap:wrap;gap:34px;}
  .board{width:375px;}
  .board .cap{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;}
  .board .cap b{font-size:13px;}
  .board .cap span{font-size:11px;color:#9aa0a6;font-family:ui-monospace,Consolas,monospace;}
  .frame{width:375px;height:812px;border-radius:26px;overflow:hidden;background:#fff;border:8px solid #1c1c1e;box-shadow:0 18px 44px rgba(0,0,0,.22);}
  .frame iframe{width:375px;height:812px;border:none;display:block;background:#f2f3f5;}
  .warn{background:#fff8e6;border:1px solid #f5d98a;border-radius:10px;padding:10px 12px;font-size:12px;color:#8a6d1a;margin-bottom:18px;}
</style></head>
<body>
<h1>高保真原型 · 代码一比一复刻</h1>
<p class="lead">
  由 <code>tools/build-proto.js</code> 直接读取小程序源码生成：WXSS 仅做 <code>rpx → calc(var(--rpx)*n)</code>（<code>--rpx:0.5px</code>，即 750rpx = 375px）与 <code>page/view/text</code> 标签映射，
  数值、类名、DOM 层级均未改动；WXML 用页面真实 <code>data</code> 渲染（<code>wx:if / wx:for / {{}}</code> 已求值）。每个画板为独立 iframe，等价于小程序的单页样式作用域。
</p>
<div class="warn">说明：储蓄页、储蓄弹层在当前代码中尚不存在，故不在本文件中杜撰；本文件只复刻已实现页面。canvas（首页迷你趋势）在浏览器中无 2d 上下文，显示为空条。</div>
<div class="grid">
${boards.map((b) => `
  <div class="board">
    <div class="cap"><b>${b.name}</b><span>375 × 812</span></div>
    <div class="frame"><iframe srcdoc="${b.doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></div>
  </div>`).join('\n')}
</div>
</body></html>`;

fs.writeFileSync(OUT, page, 'utf8');
console.log('written:', OUT, (page.length / 1024).toFixed(1) + 'KB');
boards.forEach((b) => console.log(' -', b.name, 'leftover {{:', b.leftover, 'size:', (b.doc.length / 1024).toFixed(1) + 'KB'));
