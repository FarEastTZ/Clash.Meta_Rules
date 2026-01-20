// type: request
// match: ^https?:\/\/www\.youtube\.com\/premium

function setHeader(headers, key, value) {
  const want = key.toLowerCase();
  for (const k in headers) {
    if (k.toLowerCase() === want) { headers[k] = value; return; }
  }
  headers[key] = value;
}

const h = $request.headers || {};
setHeader(h, "Accept-Language", "en");
setHeader(h, "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
setHeader(h, "X-YT-MITM", "1"); // 调试用

$done({ headers: h });
