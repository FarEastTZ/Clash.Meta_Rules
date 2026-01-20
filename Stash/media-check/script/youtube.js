async function request(method, params) {
  return new Promise((resolve) => {
    const httpMethod = $httpClient[method.toLowerCase()];
    httpMethod(params, (error, response, data) => {
      resolve({ error, response, data });
    });
  });
}

// 把两位国家码转成国旗 Emoji（如 US -> 🇺🇸）
function codeToFlag(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x1f1e6;
  const c1 = code.charCodeAt(0) - 65 + A;
  const c2 = code.charCodeAt(1) - 65 + A;
  return String.fromCodePoint(c1, c2);
}

// 两位国家码标准化
function parseCountryCode(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^([A-Za-z]{2})(?:\([^\)]*\))?$/);
  return m ? m[1].toUpperCase() : null;
}

// 拼接显示文案：Available (US 🇺🇸)
function formatWithCountry(baseText, code) {
  if (!code) return baseText;
  const flag = codeToFlag(code);
  const label = `${code} ${flag}`.trim();
  return label ? `${baseText} (${label})` : baseText;
}

// 判断是否 consent 页面（尽量严格，避免误判）
function isConsentPage(html) {
  const s = String(html || "").toLowerCase();
  return (
    s.includes("consent.youtube.com") ||
    s.includes("consent.google.com") ||
    s.includes("before you continue") ||
    s.includes("continue to youtube") ||
    s.includes("继续使用 youtube") ||
    // 很多同意页会出现 save/consent 的 form
    (s.includes("/save") && s.includes("consent"))
  );
}

// 从 Premium 页面 HTML/内嵌数据中提取国家码（兜底）
function extractCountryFromHtml(html) {
  const s = String(html || "");

  const patterns = [
    /"countryCode"\s*:\s*"([A-Za-z]{2})"/,           // "countryCode":"US"
    /"INNERTUBE_CONTEXT_GL"\s*:\s*"([A-Za-z]{2})"/,  // "INNERTUBE_CONTEXT_GL":"US"
    /"gl"\s*:\s*"([A-Za-z]{2})"/,                    // ..."gl":"US"...
    /[?&]gl=([A-Za-z]{2})(?:[&#"'\s]|$)/,            // URL 里 gl=GB
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) {
      const code = parseCountryCode(m[1]);
      if (code) return code;
    }
  }
  return null;
}

// ========== 从响应头 Set-Cookie 里解析国家码（更稳） ==========

function getSetCookie(headers) {
  if (!headers) return [];
  const sc = headers["Set-Cookie"] || headers["set-cookie"] || headers["SET-COOKIE"];
  if (!sc) return [];
  if (Array.isArray(sc)) return sc;
  // 有些实现会把多个 Set-Cookie 用换行拼起来
  return String(sc)
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

// base64 -> bytes（优先用 atob；如果没有则返回 null）
function b64ToBytes(b64) {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return bytes;
  } catch (e) {
    return null;
  }
}

// 从 VISITOR_PRIVACY_METADATA 解两位国家码
function extractCCFromVisitorPrivacy(headers) {
  const lines = getSetCookie(headers);
  const line = lines.find((x) => /^VISITOR_PRIVACY_METADATA=/i.test(String(x).trim()));
  if (!line) return null;

  const m = String(line).match(/VISITOR_PRIVACY_METADATA=([^;]+)/i);
  if (!m) return null;

  // 先 URL decode（把 %3D%3D 还原）
  const val = decodeURIComponent(m[1]);

  // 再 base64 decode
  const bytes = b64ToBytes(val);
  if (!bytes) return null;

  // 在字节流里找连续两个大写字母（US/JP/GB/CN 等）
  for (let i = 0; i < bytes.length - 1; i++) {
    const a = bytes[i];
    const b = bytes[i + 1];
    if (a >= 65 && a <= 90 && b >= 65 && b <= 90) {
      return String.fromCharCode(a, b);
    }
  }
  return null;
}

// ========== 主流程 ==========

async function main() {
  const req = {
    url: "https://www.youtube.com/premium",
    headers: {
      "Accept-Language": "en",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      // 不塞 Cookie：避免污染导致“越测越全 consent”
    },
    timeout: 10,
    "auto-cookie": false,   // 关键：每次检测不复用 cookie
    "auto-redirect": true,
  };

  const { error, response, data } = await request("GET", req);

  if (error) {
    $done({ content: "Network Error", backgroundColor: "" });
    return;
  }

  const html = String(data || "");
  const lower = html.toLowerCase();

  // 国家码优先从响应头拿（更稳），再从 HTML 兜底
  let code =
    extractCCFromVisitorPrivacy(response && response.headers) ||
    extractCountryFromHtml(html);

  // CN 特判
  if (lower.includes("www.google.cn")) code = "CN";

  // Consent 页：提示但不当成 Unknown
  if (isConsentPage(html)) {
    $done({
      content: formatWithCountry("Consent Page", code),
      backgroundColor: "",
    });
    return;
  }

  // 不可用提示
  if (
    lower.includes("youtube premium is not available in your country") ||
    lower.includes("premium is not available in your country")
  ) {
    // CN 要求显示 CN
    if (code === "CN") {
      $done({ content: formatWithCountry("Not Available", "CN"), backgroundColor: "" });
      return;
    }
    $done({ content: formatWithCountry("Not Available", code), backgroundColor: "" });
    return;
  }

  // 可用信号
  if (lower.includes("ad-free")) {
    $done({
      content: formatWithCountry("Available", code),
      backgroundColor: "#FF0000",
    });
    return;
  }

  // 兜底：如果没匹配到 ad-free，但能拿到国家码，仍给出提示避免“Unknown”太多
  if (code) {
    $done({ content: formatWithCountry("Unknown", code), backgroundColor: "" });
    return;
  }

  $done({ content: "Unknown Error", backgroundColor: "" });
}

(async () => {
  main()
    .then(() => {})
    .catch(() => {
      $done({ content: "Script Error", backgroundColor: "" });
    });
})();
