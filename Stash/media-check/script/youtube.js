async function request(method, params) {
  return new Promise((resolve, reject) => {
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

// 从返回值里提取国家码：支持 "US" / "JP" / "HK" / "CN"
function parseCountryCode(raw) {
  const s = String(raw || "").trim();

  // 通用：两位字母 或 两位字母(任意内容)
  m = s.match(/^([A-Za-z]{2})(?:\([^\)]*\))?$/);
  if (m) return m[1].toUpperCase();

  return null;
}

// 从 YouTube Premium 页面 HTML/内嵌数据中提取国家码
function extractYouTubeCountryCode(html) {
  const s = String(html || "");

  // 多种可能字段：bash 脚本用的是 "countryCode"
  const patterns = [
    /"countryCode"\s*:\s*"([A-Za-z]{2})"/,          // "countryCode":"US"
    /"INNERTUBE_CONTEXT_GL"\s*:\s*"([A-Za-z]{2})"/, // "INNERTUBE_CONTEXT_GL":"US"
    /"gl"\s*:\s*"([A-Za-z]{2})"/,                   // ..."gl":"US"...（更宽松兜底）
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

// 把显示文案拼成：Available (US 🇺🇸) / Not Available (CN 🇨🇳)
function formatWithCountry(baseText, code) {
  if (!code) return baseText;
  const flag = codeToFlag(code);
  const label = `${code} ${flag}`.trim();
  return label ? `${baseText} (${label})` : baseText;
}

async function main() {
  const { error, response, data } = await request(
    "GET",
    "https://www.youtube.com/premium"
  );

  if (error) {
    $done({
      content: "Network Error",
      backgroundColor: "",
    });
    return;
  }

  const text = String(data || "");
  const lower = text.toLowerCase();

  // 先尝试从页面提取国家码
  let countryCode = extractYouTubeCountryCode(text);

  // CN 特判（参照 bash：如果页面出现 www.google.cn 直接认为 CN）
  if (lower.includes("www.google.cn")) {
    countryCode = "CN";
  }

  // 若为 CN：直接 Not Available (CN 🇨🇳)
  if (countryCode === "CN") {
    $done({
      content: formatWithCountry("Not Available", "CN"),
      backgroundColor: "",
    });
    return;
  }

  // 不可用提示（兼容你原来的判断 + bash 的常见提示）
  if (
    lower.includes("youtube premium is not available in your country") ||
    lower.includes("premium is not available in your country")
  ) {
    $done({
      content: formatWithCountry("Not Available", countryCode),
      backgroundColor: "",
    });
    return;
  }

  if (lower.includes("ad-free")) {
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
      $done({});
    });
})();
