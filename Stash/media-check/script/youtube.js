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

// 两位国家码规范化
function parseCountryCode(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^([A-Za-z]{2})$/);
  return m ? m[1].toUpperCase() : null;
}

// 从 HTML/URL 中提取国家码：优先 countryCode，其次 gl=
function extractCountryCode(textOrUrl) {
  const s = String(textOrUrl || "");

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

// 仅判断“是否是 consent 页面”
function isConsentPage(html) {
  const s = String(html || "").toLowerCase();
  return (
    s.includes("consent.youtube.com") ||
    s.includes("before you continue") ||
    s.includes("继续使用 youtube 前须知") ||
    s.includes("我们会使用 cookie")
  );
}

// 判断 Premium 可用的关键词（兼容英文/中文）
function isPremiumAvailable(html) {
  const s = String(html || "").toLowerCase();

  // 英文（bash 依赖的）
  if (s.includes("ad-free")) return true;
  if (s.includes("background play")) return true;
  if (s.includes("downloads")) return true;

  // 中文（你截图里的典型文案）
  if (s.includes("无广告")) return true;
  if (s.includes("广告") && s.includes("干扰")) return true;
  if (s.includes("后台播放")) return true;
  if (s.includes("离线")) return true;

  return false;
}

function isPremiumNotAvailable(html) {
  const s = String(html || "").toLowerCase();
  if (s.includes("youtube premium is not available in your country")) return true;
  if (s.includes("premium is not available in your country")) return true;

  // 简单中文兜底
  if (s.includes("premium") && s.includes("不可用") && (s.includes("国家") || s.includes("地区"))) return true;

  return false;
}

async function main() {
  const url = "https://www.youtube.com/premium";

  // 1) 第一次：完全按你原始请求，不加任何头/参数，避免把原本正常的地区搞坏
  let r = await request("GET", url);

  if (r.error) {
    $done({ content: "Network Error", backgroundColor: "" });
    return;
  }

  let text = String(r.data || "");
  let lower = text.toLowerCase();

  // 先尝试拿国家码（正常 premium 页通常能拿到 countryCode）
  let countryCode = extractCountryCode(text);

  // CN 特判
  if (lower.includes("www.google.cn")) {
    countryCode = "CN";
  }

  // 2) 只有 EU/部分地区遇到 consent 时，才做第二次请求（带 CONSENT cookie）
  if (isConsentPage(text)) {
    // consent 页自身通常带 gl=GB 等，可先拿到国家码（用于兜底显示）
    countryCode = countryCode || extractCountryCode(text);

    const retryHeaders = {
      "Accept-Language": "en",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      // 用 CONSENT
      "Cookie": "CONSENT=YES+cb.20220301-11-p0.en+FX+700",
    };

    const r2 = await request("GET", { url, headers: retryHeaders });

    // 如果第二次失败，就保持 consent 结果（不影响非 EU）
    if (!r2.error) {
      r = r2;
      text = String(r.data || "");
      lower = text.toLowerCase();
      countryCode = extractCountryCode(text) || countryCode;

      if (lower.includes("www.google.cn")) countryCode = "CN";
    } else {
      $done({
        content: countryCode
          ? `Consent Page (${countryCode} ${codeToFlag(countryCode)})`
          : "Consent Page",
        backgroundColor: "",
      });
      return;
    }

    // 第二次仍是 consent
    if (isConsentPage(text)) {
      $done({
        content: countryCode
          ? `Consent Page (${countryCode} ${codeToFlag(countryCode)})`
          : "Consent Page",
        backgroundColor: "",
      });
      return;
    }
  }

  // 3) 业务输出：CN -> Not Available (CN 🇨🇳)
  if (countryCode === "CN") {
    $done({
      content: formatWithCountry("Not Available", "CN"),
      backgroundColor: "",
    });
    return;
  }

  // 4) Not Available 文案
  if (isPremiumNotAvailable(text)) {
    $done({
      content: formatWithCountry("Not Available", countryCode),
      backgroundColor: "",
    });
    return;
  }

  // 5) Available（成功时显示国家码+国旗，取不到就只显示 Available）
  if (isPremiumAvailable(text)) {
    $done({
      content: formatWithCountry("Available", countryCode),
      backgroundColor: "#FF0000",
    });
    return;
  }

  $done({
    content: "Unknown Error",
    backgroundColor: "",
  });
}

(async () => {
  main()
    .then((_) => {})
    .catch((error) => {
      $done({ content: "Script Error", backgroundColor: "" });
    });
})();
