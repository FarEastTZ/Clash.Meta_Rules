async function request(method, params) {
  return new Promise((resolve, reject) => {
    const httpMethod = $httpClient[method.toLowerCase()];
    httpMethod(params, (error, response, data) => {
      resolve({ error, response, data });
    });
  });
}

// 两位国家码 -> 国旗
function codeToFlag(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x1f1e6;
  const c1 = code.charCodeAt(0) - 65 + A;
  const c2 = code.charCodeAt(1) - 65 + A;
  return String.fromCodePoint(c1, c2);
}

function parseCountryCode(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^([A-Za-z]{2})$/);
  return m ? m[1].toUpperCase() : null;
}

// 从 Premium/Consent 返回里提取国家码（countryCode/gl）
function extractCountryCodeFromText(t) {
  const s = String(t || "");
  const patterns = [
    /"countryCode"\s*:\s*"([A-Za-z]{2})"/,
    /"INNERTUBE_CONTEXT_GL"\s*:\s*"([A-Za-z]{2})"/,
    /"gl"\s*:\s*"([A-Za-z]{2})"/,
    /[?&]gl=([A-Za-z]{2})(?:[&#"'\s]|$)/,
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

function formatWithCountry(baseText, code) {
  if (!code) return baseText;
  const flag = codeToFlag(code);
  const label = `${code} ${flag}`.trim();
  return label ? `${baseText} (${label})` : baseText;
}

function isConsentPage(html) {
  const s = String(html || "").toLowerCase();
  return (
    s.includes("consent.youtube.com") ||
    s.includes("before you continue") ||
    s.includes("继续使用 youtube") ||
    (s.includes("cookie") && s.includes("google")) ||
    s.includes('action="https://consent.youtube.com/save"') ||
    s.includes("consent.youtube.com/save")
  );
}

function getHeader(resp, name) {
  const h = (resp && resp.headers) ? resp.headers : {};
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || "";
}

function pickConsentUrl(resp, html) {
  // 1) 先看 302 Location
  const loc = getHeader(resp, "Location");
  if (loc && String(loc).includes("consent.youtube.com")) return String(loc);

  // 2) 再从 HTML 里抓出 consent 链接（兜底）
  const s = String(html || "");
  const m = s.match(/https:\/\/consent\.youtube\.com\/m\?[^"'<>\s]+/i);
  if (m) return m[0];

  return "";
}

// 解析 consent 页表单：action + hidden inputs + “全部拒绝/全部接受”按钮字段
function parseConsentForm(html) {
  const s = String(html || "");
  const actionMatch = s.match(/action="(https:\/\/consent\.youtube\.com\/save[^"]*)"/i);
  const action = actionMatch ? actionMatch[1] : "https://consent.youtube.com/save";

  const inputs = {};
  // hidden inputs
  const reHidden = /<input[^>]+type="hidden"[^>]*>/gi;
  const nodes = s.match(reHidden) || [];
  for (const node of nodes) {
    const n = (node.match(/name="([^"]+)"/i) || [])[1];
    const v = (node.match(/value="([^"]*)"/i) || [])[1];
    if (n) inputs[n] = v || "";
  }

  // 按钮：中文“全部拒绝/全部接受”或英文 Reject all / Accept all
  // 取其 name/value，POST 时必须带上
  const btnRe = /<button[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/button>/gi;
  let btn;
  let rejectKV = null;
  let acceptKV = null;
  while ((btn = btnRe.exec(s)) !== null) {
    const name = btn[1];
    const value = btn[2];
    const inner = (btn[3] || "").replace(/\s+/g, " ").trim();
    if (!rejectKV && /全部拒绝|Reject all/i.test(inner)) rejectKV = { name, value };
    if (!acceptKV && /全部接受|Accept all/i.test(inner)) acceptKV = { name, value };
  }

  return { action, inputs, rejectKV, acceptKV };
}

function toFormBody(obj) {
  const parts = [];
  for (const k of Object.keys(obj)) {
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k] ?? "")));
  }
  return parts.join("&");
}

// 自动完成一次 consent：先“全部拒绝”，不行再“全部接受”
async function completeConsent(consentUrl, headers) {
  // 1) GET consent 页面
  const r1 = await request("GET", { url: consentUrl, headers });
  if (r1.error) return false;

  const form = parseConsentForm(r1.data);
  const base = Object.assign({}, form.inputs);

  async function submit(btnKV) {
    if (!btnKV) return false;
    const bodyObj = Object.assign({}, base);
    bodyObj[btnKV.name] = btnKV.value;

    const r2 = await request("POST", {
      url: form.action,
      headers: Object.assign({}, headers, {
        "Content-Type": "application/x-www-form-urlencoded",
      }),
      body: toFormBody(bodyObj),
    });

    if (r2.error) return false;
    // 成功的话通常会 302 回 continue
    return true;
  }

  // 先拒绝，再接受兜底
  if (await submit(form.rejectKV)) return true;
  if (await submit(form.acceptKV)) return true;
  return false;
}

async function main() {
  const url = "https://www.youtube.com/premium?ucbcb=1";

  const headers = {
    "Accept-Language": "en",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };

  // 第一次请求 premium
  let r = await request("GET", { url, headers });

  if (r.error) {
    $done({ content: "Network Error", backgroundColor: "" });
    return;
  }

  let text = String(r.data || "");
  let lower = text.toLowerCase();
  let cc = extractCountryCodeFromText(text) || extractCountryCodeFromText(getHeader(r.response, "Location"));

  // 如果遇到 consent：走自动同意流程，然后再请求 premium
  if (isConsentPage(text) || String(getHeader(r.response, "Location")).includes("consent.youtube.com")) {
    const consentUrl = pickConsentUrl(r.response, text);

    // 没拿到 consentUrl 也返回提示
    if (!consentUrl) {
      $done({
        content: cc ? `Consent Page (${cc} ${codeToFlag(cc)})` : "Consent Page",
        backgroundColor: "",
      });
      return;
    }

    const ok = await completeConsent(consentUrl, headers);

    // 无论 ok 与否，再拉一次 premium（有些环境需要“做完一次”才写入 cookie）
    r = await request("GET", { url, headers });
    if (r.error) {
      $done({ content: "Network Error", backgroundColor: "" });
      return;
    }

    text = String(r.data || "");
    lower = text.toLowerCase();
    cc = extractCountryCodeFromText(text) || cc;
  }

  // CN 特判（你原逻辑）
  if (lower.includes("www.google.cn")) cc = "CN";

  // 如果仍是 consent：说明 Stash 这边 cookie jar 没保存/被隔离（这时就没法继续拿到 premium 正常页）
  if (isConsentPage(text)) {
    $done({
      content: cc ? `Consent Page (${cc} ${codeToFlag(cc)})` : "Consent Page",
      backgroundColor: "",
    });
    return;
  }

  // Not Available（兼容英文 + 一点中文兜底）
  if (
    lower.includes("youtube premium is not available in your country") ||
    lower.includes("premium is not available in your country") ||
    lower.includes("在您所在的国家") && lower.includes("premium") && lower.includes("不可用")
  ) {
    if (cc === "CN") {
      $done({ content: formatWithCountry("Not Available", "CN"), backgroundColor: "" });
      return;
    }
    $done({ content: formatWithCountry("Not Available", cc), backgroundColor: "" });
    return;
  }

  // Available（英文 ad-free，和中文“无广告”兜底）
  if (lower.includes("ad-free") || lower.includes("无广告")) {
    $done({
      content: formatWithCountry("Available", cc),
      backgroundColor: "#FF0000",
    });
    return;
  }

  $done({ content: "Unknown Error", backgroundColor: "" });
}

(async () => {
  main()
    .then((_) => {})
    .catch((error) => {
      $done({ content: "Script Error", backgroundColor: "" });
    });
})();
