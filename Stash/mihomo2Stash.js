// 读取 YAML
const yamlObj = ProxyUtils.yaml.safeLoad($content ?? $files[0])

// 优先读取 URL 动态参数，其次读取前端固定参数
const filterGrpcRaw = String($options?.filterGrpc ?? $arguments?.filterGrpc ?? '').trim().toLowerCase()

// 为空时默认 true；显式传 false / 0 / no / off 时为 false
const filterGrpc = filterGrpcRaw === ''
  ? true
  : !['false', '0', 'no', 'off'].includes(filterGrpcRaw)

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
  'nameserver-policy': {
    'geosite:geolocation-!cn': [
      'tls://1.0.0.1:853',
      'tls://8.8.4.4:853'
    ],
    'geosite:cn': [
      'https://dns.alidns.com/dns-query',
      'https://doh.pub/dns-query'
    ]
  },
  'follow-rule': true
}

/** =========================
 * C) 确保 proxies / proxy-groups 为数组
 * ========================= */
if (!Array.isArray(yamlObj['proxies'])) {
  yamlObj['proxies'] = yamlObj['proxies'] ? [].concat(yamlObj['proxies']) : []
}
if (!Array.isArray(yamlObj['proxy-groups'])) {
  yamlObj['proxy-groups'] = yamlObj['proxy-groups'] ? [].concat(yamlObj['proxy-groups']) : []
}

function norm(s) { return String(s ?? '').normalize('NFC').trim()}

/** =========================
 * D) 根据 filterGrpc 删除 name 以 grpc 结尾的 proxies
 *    - 为空时默认 true
 *    - 为 true 时删除，并同步清理 proxy-groups 中对应引用
 *    - 为 false 时不处理
 * ========================= */
if (filterGrpc) {
  const removedGrpcNameSet = new Set()
  const keptProxies = []

  for (const p of yamlObj['proxies']) {
    if (!p || typeof p !== 'object') {
      keptProxies.push(p)
      continue
    }

    const proxyName = norm(p.name)
    const isGrpcName = proxyName.toLowerCase().endsWith('grpc')

    if (isGrpcName) {
      if (proxyName) removedGrpcNameSet.add(proxyName)
      continue
    }

    keptProxies.push(p)
  }

  yamlObj['proxies'] = keptProxies

  // 清理 proxy-groups 中对被删 grpc 节点的引用
  if (removedGrpcNameSet.size > 0) {
    for (const g of yamlObj['proxy-groups']) {
      if (!g || typeof g !== 'object') continue
      if (Array.isArray(g.proxies)) {
        g.proxies = g.proxies.filter(v => {
          return !(typeof v === 'string' && removedGrpcNameSet.has(norm(v)))
        })
      }
    }
  }
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