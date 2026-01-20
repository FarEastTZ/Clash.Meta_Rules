async function request(method, params) {
  return new Promise((resolve) => {
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
  const m = s.match(/^([A-Za-z]{2})(?:\([^\)]*\))?$/);
  return m ? m[1].toUpperCase() : null;
}

// 从 YouTube Premium 页面 HTML/内嵌数据中提取国家码（优先 countryCode，其次 gl）
function extractYouTubeCountryCode(htmlOrUrl) {
  const s = String(htmlOrUrl || "");

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
    (s.includes("cookie") && s.includes("google"))
  );
}

async function main() {
  const { error, response, data } = await request("GET", "https://www.youtube.com/premium");

  if (error) {
    $done({ content: "Network Error", backgroundColor: "" });
    return;
  }

  const text = String(data || "");
  const lower = text.toLowerCase();

  // countryCode 优先从正文提取；如果 response 有 Location 也兜底提取一下
  const hdrs = (response && response.headers) ? response.headers : {};
  const location = hdrs.Location || hdrs.location || "";
  let countryCode = extractYouTubeCountryCode(text) || extractYouTubeCountryCode(location);

  // CN 特判
  if (lower.includes("www.google.cn")) countryCode = "CN";

  if (isConsentPage(text) || String(location).includes("consent.youtube.com")) {
    $done({
      content: countryCode ? `Consent Page (${countryCode} ${codeToFlag(countryCode)})` : "Consent Page",
      backgroundColor: "",
    });
    return;
  }

  // CN -> Not Available (CN 🇨🇳)
  if (countryCode === "CN") {
    $done({ content: formatWithCountry("Not Available", "CN"), backgroundColor: "" });
    return;
  }

  // 不可用文案
  if (
    lower.includes("youtube premium is not available in your country") ||
    lower.includes("premium is not available in your country")
  ) {
    $done({ content: formatWithCountry("Not Available", countryCode), backgroundColor: "" });
    return;
  }

  // 可用
  if (lower.includes("ad-free")) {
    $done({ content: formatWithCountry("Available", countryCode), backgroundColor: "#FF0000" });
    return;
  }

  $done({ content: "Unknown Error", backgroundColor: "" });
}

(async () => {
  main()
    .then(() => {})
    .catch(() => $done({ content: "Script Error", backgroundColor: "" }));
})();
