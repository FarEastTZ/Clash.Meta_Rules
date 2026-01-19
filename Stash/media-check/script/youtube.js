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
  let m = s.match(/^([A-Za-z]{2})(?:\([^\)]*\))?$/);
  if (m) return m[1].toUpperCase();
  return null;
}

// 从 YouTube Premium 页面 HTML/内嵌数据中提取国家码
function extractYouTubeCountryCode(html) {
  const s = String(html || "");
  const patterns = [
    /"countryCode"\s*:\s*"([A-Za-z]{2})"/,
    /"INNERTUBE_CONTEXT_GL"\s*:\s*"([A-Za-z]{2})"/,
    /"gl"\s*:\s*"([A-Za-z]{2})"/,
    /[?&]gl=([A-Za-z]{2})(?:[&#"'\s]|$)/, // URL 里 gl=GB 这类
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
    s.includes("consent.google.com") ||
    s.includes("before you continue") ||
    s.includes("继续使用 youtube") ||
    (s.includes("cookie") && s.includes("google"))
  );
}

async function main() {
  const url = "https://www.youtube.com/premium?ucbcb=1";

  const SOCS_ACCEPT = "CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgLC_pwY";
  function makeHeaders() {
    return {
      "Accept-Language": "en",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Cookie": `SOCS=${SOCS_ACCEPT}; CONSENT=YES+`,
    };
  }

  let r = await request("GET", { url, headers: makeHeaders() });

  if (r.error) {
    $done({ content: "Network Error", backgroundColor: "" });
    return;
  }

  const text = String(r.data || "");
  const lower = text.toLowerCase();

  // 1) 国家码：优先从页面内容提取；同时也从 response 里的 Location 兜底（如果有）
  let countryCode = extractYouTubeCountryCode(text);
  const hdrs = (r.response && r.response.headers) ? r.response.headers : {};
  const location = hdrs.Location || hdrs.location || "";
  if (!countryCode && location) {
    // 若是 302/跳转场景，Location 里可能带 gl=GB
    countryCode = extractYouTubeCountryCode(location);
  }

  // 2) CN 特判：如果页面出现 www.google.cn
  if (lower.includes("www.google.cn")) countryCode = "CN";

  // 3) Consent 页：直接显示 Consent Page (XX 🇽🇽) 
  if (isConsentPage(text) || String(location).toLowerCase().includes("consent.youtube.com")) {
    $done({
      content: countryCode
        ? `Consent Page (${countryCode} ${codeToFlag(countryCode)})`
        : "Consent Page",
      backgroundColor: "",
    });
    return;
  }

  // 4) Not Available 判断（兼容两种常见文案）
  if (
    lower.includes("youtube premium is not available in your country") ||
    lower.includes("premium is not available in your country")
  ) {
    // CN 显示 Not Available (CN 🇨🇳)
    if (countryCode === "CN") {
      $done({ content: formatWithCountry("Not Available", "CN"), backgroundColor: "" });
      return;
    }
    $done({ content: formatWithCountry("Not Available", countryCode), backgroundColor: "" });
    return;
  }

  // 5) Available：以前只显示 Available，现在加国家码
  if (lower.includes("ad-free")) {
    $done({
      content: formatWithCountry("Available", countryCode),
      backgroundColor: "#FF0000",
    });
    return;
  }

  // 6) Unknown：输出调试信息
  const status = (r.response && (r.response.status || r.response.statusCode)) ? (r.response.status || r.response.statusCode) : "";
  const head120 = text.slice(0, 120).replace(/\s+/g, " ").trim();

  $done({
    content: `Unknown Error | HTTP:${status}${countryCode ? " | CC:" + countryCode : ""}${location ? " | Loc:" + location.slice(0, 60) + "..." : ""} | Head:${head120}`,
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
