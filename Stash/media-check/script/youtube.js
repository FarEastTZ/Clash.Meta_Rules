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
    /[?&]gl=([A-Za-z]{2})(?:[&#"']|$)/, // consent 页 URL 里经常有 gl=GB
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

// 判断是否落到了 consent 页面
function isConsentPage(html) {
  const s = String(html || "").toLowerCase();
  return (
    s.includes("consent.youtube.com") ||
    s.includes("consent.google.com") ||
    s.includes("before you continue") ||
    s.includes("继续使用 youtube") ||
    s.includes("cookie") && s.includes("google")
  );
}

async function main() {
  const url = "https://www.youtube.com/premium?ucbcb=1";

  // 两个 SOCS 备选值（一个更偏“拒绝”，一个更偏“接受”）
  // 来源：社区经验（SOCS 是绕过 consent 的关键 cookie）
  const SOCS_REJECT = "CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg";
  const SOCS_ACCEPT = "CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgLC_pwY";

  function makeHeaders(socsVal) {
    return {
      "Accept-Language": "en",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      // 关键：SOCS +（可选）CONSENT
      "Cookie": `SOCS=${socsVal}; CONSENT=YES+`,
    };
  }

  // 第一次：先用 ACCEPT
  let r = await request("GET", { url, headers: makeHeaders(SOCS_ACCEPT) });
  if (r.error) {
    $done({ content: "Network Error", backgroundColor: "" });
    return;
  }

  // 如果还是 consent：再用 REJECT 重试一次
  if (isConsentPage(r.data)) {
    const r2 = await request("GET", { url, headers: makeHeaders(SOCS_REJECT) });
    if (!r2.error) r = r2;
  }

  const text = String(r.data || "");
  const lower = text.toLowerCase();
  let countryCode = extractCountry(text);

  // CN 特判
  if (lower.includes("www.google.cn")) countryCode = "CN";

  // 仍是 consent：说明你的脚本环境可能“剥离 Cookie header”或 YouTube 对该出口强制同意页
  if (isConsentPage(text)) {
    $done({
      content: countryCode
        ? `Consent Page (${countryCode} ${codeToFlag(countryCode)})`
        : "Consent Page",
      backgroundColor: "",
    });
    return;
  }

  // 不可用提示
  if (
    lower.includes("youtube premium is not available in your country") ||
    lower.includes("premium is not available in your country")
  ) {
    // 如果为 CN，显示 CN
    if (countryCode === "CN") {
      $done({ content: formatWithCountry("Not Available", "CN"), backgroundColor: "" });
      return;
    }
    $done({ content: formatWithCountry("Not Available", countryCode), backgroundColor: "" });
    return;
  }

  if (lower.includes("ad-free")) {
    $done({
      content: formatWithCountry("Available", countryCode),
      backgroundColor: "#FF0000",
    });
    return;
  }

  // Unknown 时输出调试信息
  const status = response && (response.status || response.statusCode) ? (response.status || response.statusCode) : "";
  const finalUrl = response && (response.url || response.finalUrl) ? (response.url || response.finalUrl) : "";
  const head200 = text.slice(0, 200).replace(/\s+/g, " ").trim();

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
