async function request(method, params) {
  return new Promise((resolve, reject) => {
    const httpMethod = $httpClient[method.toLowerCase()];
    httpMethod(params, (error, response, data) => {
      resolve({ error, response, data });
    });
  });
}

// 两位国家码 -> 国旗 Emoji（US -> 🇺🇸）
function codeToFlag(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x1f1e6;
  const c1 = code.charCodeAt(0) - 65 + A;
  const c2 = code.charCodeAt(1) - 65 + A;
  return String.fromCodePoint(c1, c2);
}

// country 可能是 "us" 这种，统一转成 "US 🇺🇸"
function formatCountryWithFlag(country) {
  const cc = String(country || "").trim().toUpperCase();
  const flag = codeToFlag(cc);
  return `${cc} ${flag}`.trim();
}

async function checkTitle(id) {
  const { error, response, data } = await request(
    "GET",
    `https://www.netflix.com/title/${id}`
  );

  if (error) {
    return "";
  }

  let url = response.headers["X-Originating-Url"];
  if (!url) {
    return "";
  }
  const loc = url.split("/")[3];
  if (loc === "title") {
    return "us";
  }
  return loc.split("-")[0];
}

async function main() {
  var country = await checkTitle(70143836);
  if (country) {
    const cc = formatCountryWithFlag(country);
    $done({
      content: `No Restriction (${cc})`,
      backgroundColor: "#E50914",
    });
    return;
  }

  country = await checkTitle(80197526);
  if (country) {
    const cc = formatCountryWithFlag(country);
    $done({
      content: `Originals Only (${cc})`,
      backgroundColor: "#E50914",
    });
    return;
  }

  $done({
    content: "Not Available",
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
