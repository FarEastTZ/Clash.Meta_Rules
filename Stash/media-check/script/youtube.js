async function request(method, req) {
  return new Promise((resolve) => {
    const httpMethod = $httpClient[method.toLowerCase()];
    httpMethod(req, (error, response, data) => resolve({ error, response, data }));
  });
}

function codeToFlag(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(code.charCodeAt(0) - 65 + A, code.charCodeAt(1) - 65 + A);
}

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
    if (m && m[1]) return parseCountryCode(m[1]);
  }
  return null;
}

function makeReq(cookie) {
  return {
    url: "https://www.youtube.com/premium",
    headers: {
      "Accept-Language": "en",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Cookie": cookie,
    },
    timeout: 8,
    "auto-cookie": false,
    "auto-redirect": true,
  };
}

async function main() {
  // 1) cookie
  const cookieBashLike =
    "YSC=BiCUU3-5Gdk; " +
    "CONSENT=YES+cb.20220301-11-p0.en+FX+700; " +
    "GPS=1; " +
    "VISITOR_INFO1_LIVE=4VwPMkB7W5A; " +
    "PREF=tz=Asia.Shanghai; " +
    "_gcl_au=1.1.1809531354.1646633279";

  // 2) 兜底：如果还是 consent，再加一个 SOCS(ACCEPT ALL) 重试
  const SOCS_ACCEPT =
    "CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgLC_pwY";

  let r = await request("GET", makeReq(cookieBashLike));
  if (r.error) {
    $done({ content: "Network Error", backgroundColor: "" });
    return;
  }

  let text = String(r.data || "");
  if (isConsentPage(text)) {
    r = await request("GET", makeReq(cookieBashLike + "; SOCS=" + SOCS_ACCEPT));
    if (!r.error) text = String(r.data || "");
  }

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

  if (
    lower.includes("youtube premium is not available in your country") ||
    lower.includes("premium is not available in your country")
  ) {
    $done({ content: formatWithCountry("Not Available", countryCode), backgroundColor: "" });
    return;
  }

  if (lower.includes("ad-free")) {
    $done({ content: formatWithCountry("Available", countryCode), backgroundColor: "#FF0000" });
    return;
  }

  $done({ content: "Unknown Error", backgroundColor: "" });
}

(async () => {
  main().catch(() => $done({ content: "Script Error", backgroundColor: "" }));
})();
