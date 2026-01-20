async function request(method, req) {
  return new Promise((resolve) => {
    const httpMethod = $httpClient[method.toLowerCase()];
    httpMethod(req, (error, response, data) => resolve({ error, response, data }));
  });
}

// ===== 显示相关 =====
function codeToFlag(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(code.charCodeAt(0) - 65 + A, code.charCodeAt(1) - 65 + A);
}
function formatWithCountry(baseText, code) {
  if (!code) return baseText;
  const flag = codeToFlag(code);
  const label = `${code} ${flag}`.trim();
  return label ? `${baseText} (${label})` : baseText;
}

// ===== 解析相关 =====
function isConsentPage(html) {
  const s = String(html || "").toLowerCase();
  return (
    s.includes("consent.youtube.com") ||
    s.includes("before you continue") ||
    s.includes("继续使用 youtube") ||
    (s.includes("cookie") && s.includes("google")) ||
    s.includes("consent") && s.includes("save")
  );
}

function extractCountryCodeFromHtml(html) {
  const s = String(html || "");
  const patterns = [
    /"countryCode"\s*:\s*"([A-Za-z]{2})"/,
    /"INNERTUBE_CONTEXT_GL"\s*:\s*"([A-Za-z]{2})"/,
    /[?&]gl=([A-Za-z]{2})(?:[&#"'\s]|$)/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) return m[1].toUpperCase();
  }
  return null;
}

function extractConsentUrl(html) {
  const s = String(html || "");
  const m = s.match(/https:\/\/consent\.youtube\.com\/m\?[^"'<> \n\r\t]+/i);
  return m ? m[0] : null;
}

function parseHiddenInputs(html) {
  const s = String(html || "");
  const inputs = {};
  const re = /<input[^>]+type="hidden"[^>]*>/gi;
  const nodes = s.match(re) || [];
  for (const node of nodes) {
    const n = (node.match(/name="([^"]+)"/i) || [])[1];
    const v = (node.match(/value="([^"]*)"/i) || [])[1];
    if (n) inputs[n] = v || "";
  }
  return inputs;
}

function parseFormAction(html) {
  const s = String(html || "");
  const m = s.match(/action="([^"]*consent\.youtube\.com\/save[^"]*)"/i);
  if (m) return m[1];
  // 有时 action 可能是相对路径
  const m2 = s.match(/action="([^"]*\/save[^"]*)"/i);
  if (m2) {
    const a = m2[1];
    return a.startsWith("http") ? a : ("https://consent.youtube.com" + a);
  }
  return "https://consent.youtube.com/save";
}

function pickAcceptButton(html) {
  const s = String(html || "");
  // button 标签
  const reBtn = /<button[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/button>/gi;
  let m;
  while ((m = reBtn.exec(s)) !== null) {
    const name = m[1], value = m[2];
    const inner = (m[3] || "").replace(/\s+/g, " ").trim();
    if (/accept all|i agree|agree|accept|同意|接受|全部接受|继续/i.test(inner)) {
      return { name, value };
    }
  }
  // input submit
  const reInp = /<input[^>]*type="submit"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi;
  while ((m = reInp.exec(s)) !== null) {
    const name = m[1], value = m[2];
    if (/accept|agree|同意|接受|继续/i.test(value)) return { name, value };
  }
  return null;
}

function toFormBody(obj) {
  return Object.keys(obj)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k] ?? "")))
    .join("&");
}

// ===== 脚本内 cookie jar（避免 Stash 全局污染）=====
function getSetCookie(headers) {
  if (!headers) return [];
  const sc = headers["Set-Cookie"] || headers["set-cookie"] || headers["SET-COOKIE"];
  if (!sc) return [];
  if (Array.isArray(sc)) return sc;
  // 有的实现会用换行拼起来
  return String(sc).split("\n").map((x) => x.trim()).filter(Boolean);
}

function updateJarFromHeaders(jar, headers) {
  const lines = getSetCookie(headers);
  for (const line of lines) {
    const kv = line.split(";")[0];
    const idx = kv.indexOf("=");
    if (idx > 0) {
      const name = kv.slice(0, idx).trim();
      const value = kv.slice(idx + 1).trim();
      if (name) jar[name] = value;
    }
  }
}

function jarToCookie(jar) {
  return Object.keys(jar).map((k) => `${k}=${jar[k]}`).join("; ");
}

async function fetchWithJar(method, url, jar, extraHeaders, body) {
  const headers = Object.assign(
    {
      "Accept-Language": "en",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    extraHeaders || {}
  );

  const cookie = jarToCookie(jar);
  if (cookie) headers["Cookie"] = cookie;

  const req = { url, headers, timeout: 10, "auto-cookie": false, "auto-redirect": true };
  if (method === "POST") req.body = body;

  const r = await request(method, req);
  if (!r.error && r.response && r.response.headers) updateJarFromHeaders(jar, r.response.headers);
  return r;
}

// ===== 主流程 =====
async function main() {
  const jar = {}; // 每次运行从空 jar 开始，永远不会“越测越乱”

  // 1) 拉 premium
  let r = await fetchWithJar("GET", "https://www.youtube.com/premium", jar);
  if (r.error) {
    $done({ content: "Network Error", backgroundColor: "" });
    return;
  }
  let html = String(r.data || "");

  // 2) 如果是 consent：走一次 accept 流程
  if (isConsentPage(html)) {
    const consentUrl = extractConsentUrl(html);
    if (!consentUrl) {
      const cc = extractCountryCodeFromHtml(html);
      $done({ content: cc ? `Consent Page (${cc} ${codeToFlag(cc)})` : "Consent Page", backgroundColor: "" });
      return;
    }

    // 2.1 GET consent 页
    const r2 = await fetchWithJar("GET", consentUrl, jar);
    if (r2.error) {
      $done({ content: "Network Error", backgroundColor: "" });
      return;
    }
    const cHtml = String(r2.data || "");
    const action = parseFormAction(cHtml);
    const hidden = parseHiddenInputs(cHtml);
    const btn = pickAcceptButton(cHtml);

    // 2.2 POST save（accept）
    const postObj = Object.assign({}, hidden);
    if (btn) postObj[btn.name] = btn.value;

    await fetchWithJar(
      "POST",
      action,
      jar,
      { "Content-Type": "application/x-www-form-urlencoded" },
      toFormBody(postObj)
    );

    // 2.3 再拉一次 premium
    r = await fetchWithJar("GET", "https://www.youtube.com/premium", jar);
    if (r.error) {
      $done({ content: "Network Error", backgroundColor: "" });
      return;
    }
    html = String(r.data || "");
  }

  // 3) 解析结果
  const lower = html.toLowerCase();
  let cc = extractCountryCodeFromHtml(html);

  if (isConsentPage(html)) {
    $done({ content: cc ? `Consent Page (${cc} ${codeToFlag(cc)})` : "Consent Page", backgroundColor: "" });
    return;
  }

  // CN 特判
  if (lower.includes("www.google.cn")) cc = "CN";

  if (
    lower.includes("youtube premium is not available in your country") ||
    lower.includes("premium is not available in your country")
  ) {
    $done({ content: formatWithCountry("Not Available", cc), backgroundColor: "" });
    return;
  }

  if (lower.includes("ad-free")) {
    $done({ content: formatWithCountry("Available", cc), backgroundColor: "#FF0000" });
    return;
  }

  $done({ content: "Unknown Error", backgroundColor: "" });
}

(async () => {
  main().catch(() => $done({ content: "Script Error", backgroundColor: "" }));
})();
