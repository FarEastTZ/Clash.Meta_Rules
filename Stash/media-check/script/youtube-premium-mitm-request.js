// Stash - HTTP Rewrite Script (type: request)
// match: ^https?:\/\/www\.youtube\.com\/premium

function setHeader(headers, key, value) {
  const want = key.toLowerCase();
  for (const k in headers) {
    if (k.toLowerCase() === want) {
      headers[k] = value;
      return;
    }
  }
  headers[key] = value;
}

function upsertCookie(headers, name, value) {
  // 强制覆盖/写入某个 cookie 键值对
  let cookieKey = null;
  for (const k in headers) {
    if (k.toLowerCase() === "cookie") {
      cookieKey = k;
      break;
    }
  }

  let cur = cookieKey ? String(headers[cookieKey] || "") : "";
  // 删除旧的同名 cookie
  const re = new RegExp("(^|;\\s*)" + name + "=[^;]*", "i");
  cur = cur.replace(re, "").replace(/^\s*;\s*|\s*;\s*$/g, "").trim();

  const kv = `${name}=${value}`;
  const next = cur ? (cur + "; " + kv) : kv;

  if (cookieKey) headers[cookieKey] = next;
  else headers["Cookie"] = next;
}

const h = $request.headers || {};

// 固定英文/UA，减少页面结构漂移
setHeader(h, "Accept-Language", "en");

// 固定浏览器 UA，减少返回异常页面概率
setHeader(
  h,
  "User-Agent",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
);

// 调试
setHeader(h, "X-Stash-YT-MITM", "1");

// 强制覆盖 CONSENT
upsertCookie(h, "CONSENT", "YES+cb.20220301-11-p0.en+FX+700");

$done({ headers: h });
