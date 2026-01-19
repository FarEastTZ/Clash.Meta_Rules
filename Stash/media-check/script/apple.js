async function request(method, params) {
  return new Promise((resolve) => {
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

// 从返回值里提取国家码：支持 "US" / "JP" / "HK" / "CN" / "CN(xxx)"
function parseCountryCode(raw) {
  const s = String(raw || "").trim();

  // CN 特例：CN 或 CN(任意内容)
  let m = s.match(/^CN(?:\([^\)]*\))?$/i);
  if (m) return "CN";

  // 通用：两位字母 或 两位字母(任意内容)
  m = s.match(/^([A-Za-z]{2})(?:\([^\)]*\))?$/);
  if (m) return m[1].toUpperCase();

  return null;
}

async function main() {
  const { error, response, data } = await request(
    "GET",
    "https://gspe1-ssl.ls.apple.com/pep/gcc"
  );

  if (error) {
    $done({
      content: "Network Error",
      backgroundColor: "",
    });
    return;
  }

  const code = parseCountryCode(data);
  if (code) {
    const flag = codeToFlag(code);
    $done({
      content: `${code} ${flag}`.trim(),
      backgroundColor: "#333333", // 浅黑色
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
