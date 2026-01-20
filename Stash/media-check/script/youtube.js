async function request(method, req) {
  return new Promise((resolve) => {
    const httpMethod = $httpClient[method.toLowerCase()];
    httpMethod(req, (error, response, data) => {
      resolve({ error, response, data });
    });
  });
}

// 两位国家码 -> 国旗
function codeToFlag(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(
    code.charCodeAt(0) - 65 + A,
    code.charCodeAt(1) - 65 + A
  );
}

// 两位国家码规范化
function parseCountryCode(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^([A-Za-z]{2})(?:\([^\)]*\))?$/);
  return m ? m[1].toUpperCase() : null;
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

// 从页面里提取 countryCode / gl
function extractYouTubeCountryCode(text) {
  const s = String(text || "");
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

async function main() {
  const url = "https://www.youtube.com/premium";

  const CONSENT = "YES+cb.20220301-11-p0.en+FX+700";
  const SOCS = "CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg";

  const req = {
    url,
    headers: {
      "Accept-Language": "en",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Cookie": `CONSENT=${CONSENT}; SOCS=${SOCS}`,
    },
    timeout: 5,
    // 不继承/污染 cookie
    "auto-cookie": false,
    "auto-redirect": true,
  };

  const { error, response, data } = await request("GET", req);

  if (error) {
    $done({ content: "Network Error", backgroundColor: "" });
    return;
  }

  const text = String(data || "");
  const lower = text.toLowerCase();

  let countryCode = extractYouTubeCountryCode(text);

  // CN 特判
  if (lower.includes("www.google.cn")) countryCode = "CN";

  if (isConsentPage(text)) {
    $done({
      content: countryCode
        ? `Consent Page (${countryCode} ${codeToFlag(countryCode)})`
        : "Consent Page",
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
  main().catch(() => $done({ content: "Script Error", backgroundColor: "" }));
})();
