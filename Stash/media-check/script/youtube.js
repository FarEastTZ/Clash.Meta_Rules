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
  const baseHeaders = {
    "Accept-Language": "en",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Cookie": "CONSENT=YES+cb.20220301-11-p0.en+FX+700",
  };

  // 建议带上 ucbcb=1（有时可减少 cookie banner/跳转），不影响正常页
  const url = "https://www.youtube.com/premium?ucbcb=1";

  let { error, response, data } = await request("GET", { url, headers: baseHeaders });

  if (error) {
    $done({
      content: "Network Error",
      backgroundColor: "",
    });
    return;
  }

  // 如果仍然拿到 consent 页：再重试一次
  if (isConsentPage(data)) {
    const retry = await request("GET", { url, headers: baseHeaders });
    if (!retry.error) {
      error = retry.error;
      response = retry.response;
      data = retry.data;
    }
  }

  const text = String(data || "");
  const lower = text.toLowerCase();

  // 先尝试从页面提取国家码
  let countryCode = extractYouTubeCountryCode(text);

  // CN 特判（参照 bash：如果页面出现 www.google.cn 直接认为 CN）
  if (lower.includes("www.google.cn")) {
    countryCode = "CN";
  }

  // 如果还是 consent 页：这里就没法判断 Premium 是否可用
  // 但至少把国家码显示出来，避免 Unknown Error 不可读
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
