// 读取 YAML
const yamlObj = ProxyUtils.yaml.safeLoad($content ?? $files[0])

/** =========================
 * A) 递归删除指定键（任意层级）
 * ========================= */
const KEYS_TO_REMOVE = new Set([
  'unified-delay',
  'tcp-concurrent',
  'keep-alive-interval',
  'geodata-mode',
  'geox-url',
  'sniffer'
])

function stripKeys(node) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) stripKeys(node[i])
    return
  }
  for (const key of Object.keys(node)) {
    if (KEYS_TO_REMOVE.has(key)) {
      delete node[key]
    } else {
      stripKeys(node[key])
    }
  }
}
stripKeys(yamlObj)

/** =========================
 * B) 覆盖/新增顶层 dns 配置
 * ========================= */
yamlObj['dns'] = {
  enable: true,
  ipv6: true,
  'enhanced-mode': 'fake-ip',
  'fake-ip-range': '28.0.0.1/8',
  'fake-ip-filter': ['*', '+.lan', '+.local'],
  'default-nameserver': ['223.5.5.5', '119.29.29.29'],
  nameserver: [
    'https://1.0.0.1/dns-query',
    'https://8.8.4.4/dns-query',
    'https://223.5.5.5/dns-query',
    'https://120.53.53.53/dns-query'
  ],
  'follow-rule': true
}

/** =========================
 * C) 仅对白名单筛选【含 dialer-proxy】的 proxies；
 *    无 dialer-proxy 的代理全部保留；
 *    并在 proxy-groups 中清理对被删代理名的引用
 * ========================= */
function norm(s) { return String(s ?? '').normalize('NFC').trim() }

const ALLOWED_NAMES = [
  '🇺🇸 DV BGP',
  '🇺🇸 DV SS',
  '🇺🇸 HD SS',
  '🇺🇸 VHS SS',
  '🇹🇼 HiNET SS',
  '🇭🇰 HKT SS',
  '🇭🇰 HKBN SS',
  '🇭🇰 HGC SS',
  '🇦🇶 AQ WARP',
  '🇬🇧 LC SS',
  '🇱🇺 LU BVM',
  '🇷🇺 JH SS',
  '🇹🇷 TR SS',
  '🇸🇬 SP Vmess'
]
const ALLOWED_SET = new Set(ALLOWED_NAMES.map(norm))

if (!Array.isArray(yamlObj['proxies'])) {
  yamlObj['proxies'] = yamlObj['proxies'] ? [].concat(yamlObj['proxies']) : []
}
if (!Array.isArray(yamlObj['proxy-groups'])) {
  yamlObj['proxy-groups'] = yamlObj['proxy-groups'] ? [].concat(yamlObj['proxy-groups']) : []
}

const keptProxies = []
const removedNameSet = new Set()

for (const p of yamlObj['proxies']) {
  if (!p || typeof p !== 'object') { keptProxies.push(p); continue }
  if ('dialer-proxy' in p) {
    const nameN = norm(p.name)
    if (ALLOWED_SET.has(nameN)) {
      keptProxies.push(p)
    } else {
      if (nameN) removedNameSet.add(nameN) // 仅记录被删的（含 dialer-proxy 且不在白名单）
      // 丢弃该代理
    }
  } else {
    keptProxies.push(p) // 无 dialer-proxy 一律保留
  }
}
yamlObj['proxies'] = keptProxies

// 清理 proxy-groups 内对被删代理名的引用
for (const g of yamlObj['proxy-groups']) {
  if (!g || typeof g !== 'object') continue
  if (Array.isArray(g.proxies)) {
    g.proxies = g.proxies.filter(v => !(typeof v === 'string' && removedNameSet.has(norm(v))))
  }
}

/** =========================
 * D) 处理剩余 proxies 中含 dialer-proxy 的条目：
 *    ① 改名：name += "-原始"
 *    ② 删除 dialer-proxy
 *    ③ 末尾追加 benchmark-disabled: true（幂等，确保键序在末尾）
 *    ④ 对应 relay 组严格追加到 proxy-groups 末尾；若已存在同名组，仅更新其 proxies 顺序与去重
 * ========================= */
const groupByName = new Map()
for (const g of yamlObj['proxy-groups']) {
  if (g && typeof g === 'object' && g.name != null) groupByName.set(String(g.name), g)
}

// 让某个键“出现在对象末尾”的工具函数
function appendKeyLast(obj, key, value) {
  if (!obj || typeof obj !== 'object') return
  if (Object.prototype.hasOwnProperty.call(obj, key)) delete obj[key]
  obj[key] = value
}

const pendingGroups = []
const pendingByName = new Map()

for (const p of yamlObj['proxies']) {
  if (!p || typeof p !== 'object' || !('dialer-proxy' in p)) continue

  const originalNameRaw = (p.name ?? '').toString()
  const baseName = originalNameRaw.replace(/-原始$/, '') // 幂等
  const newName = `${baseName}-原始`
  const dialer = String(p['dialer-proxy'])

  // ① 改名
  p.name = newName
  // ② 删除 dialer-proxy
  delete p['dialer-proxy']
  // ③ 末尾追加 benchmark-disabled: true（若已有则覆盖并移到末尾）
  appendKeyLast(p, 'benchmark-disabled', true)

  // ④ 生成/更新 relay 组
  if (groupByName.has(baseName)) {
    const g = groupByName.get(baseName)
    if (!Array.isArray(g.proxies)) g.proxies = []
    const want = [dialer, newName].map(String)
    g.proxies = g.proxies.filter(v => !want.includes(String(v)))
    g.proxies.unshift(...want) // 若希望加到各组 proxies 的尾部，把 unshift 改成 push
  } else {
    if (!pendingByName.has(baseName)) {
      const newGroup = {
        name: baseName,
        type: 'relay',
        'benchmark-url': 'http://cp.cloudflare.com/cdn-cgi/trace',
        'benchmark-timeout': 5,
        proxies: [dialer, newName]
      }
      pendingGroups.push(newGroup)       // 末尾统一追加
      pendingByName.set(baseName, newGroup)
    } else {
      const g = pendingByName.get(baseName)
      const want = [dialer, newName].map(String)
      g.proxies = g.proxies.filter(v => !want.includes(String(v)))
      g.proxies.unshift(...want)
    }
  }
}

// 统一把新组**追加到末尾**
if (pendingGroups.length > 0) {
  yamlObj['proxy-groups'] = yamlObj['proxy-groups'].concat(pendingGroups)
}

/** =========================
 * E) 移除所有 proxy-groups 中 proxies 列表的 "PASS"
 * ========================= */
for (const g of yamlObj['proxy-groups']) {
  if (!g || typeof g !== 'object') continue
  if (Array.isArray(g.proxies)) {
    g.proxies = g.proxies.filter(v => !(typeof v === 'string' && norm(v) === 'PASS'))
  }
}

/** =========================
 * F) rules 清理与修正：
 *    F1) 删除所有包含 "PROCESS-NAME" 的条目（大小写不敏感）
 *    F2) 删除特定双栈端口 AND 规则
 *    F3) 将 YouTube QUIC 禁用从 (DST-PORT,443)+(NETWORK,UDP) 改写为 (PROTOCOL,QUIC)
 * ========================= */
function normalizeRule(s) {
  return String(s ?? '').normalize('NFC').replace(/\s+/g, '')
}

// F2：需要删除的“↕️ 双栈节点”规则
const RULE1_DELETE = 'AND,((OR,(IP-CIDR6,240e:974:eb00:908::c4c:57/16),(IP-CIDR6,2a13:b487:4f08:6b6b::3e/16),(DOMAIN,cqcmv6.frtz.club),(DOMAIN,aq.frtz.club)),(DST-PORT,22/11129)),↕️ 双栈节点'

// F3：把旧的 QUIC 规则改写为新的
const QUIC_RULE_OLD = 'AND,((GEOSITE,youtube),(AND,(DST-PORT,443),(NETWORK,UDP))),🇶 QUIC禁用'
const QUIC_RULE_NEW = 'AND,((GEOSITE,youtube),(PROTOCOL,QUIC)),🇶 QUIC禁用'

if (Array.isArray(yamlObj['rules'])) {
  const out = []
  const RULE1_DELETE_N = normalizeRule(RULE1_DELETE)
  const QUIC_RULE_OLD_N = normalizeRule(QUIC_RULE_OLD)

  for (const rule of yamlObj['rules']) {
    if (typeof rule !== 'string') { out.push(rule); continue }

    // F1) 删除包含 PROCESS-NAME 的条目
    if (/PROCESS-NAME/i.test(rule)) continue

    const normed = normalizeRule(rule)

    // F2) 删除“↕️ 双栈节点”规则
    if (normed === RULE1_DELETE_N) continue

    // F3) 命中旧的 QUIC 规则则改写为新的
    if (normed === QUIC_RULE_OLD_N) {
      out.push(QUIC_RULE_NEW)
      continue
    }

    // 其余规则保留
    out.push(rule)
  }

  yamlObj['rules'] = out
}

/** =========================
 * G) 导出
 * ========================= */
const output = ProxyUtils.yaml.safeDump(yamlObj/*, { lineWidth: -1 }*/)
$content = output
