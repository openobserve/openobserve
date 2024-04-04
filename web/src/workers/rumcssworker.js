self.addEventListener("message", (e) => {
  const cssString = e.data.cssString;
  const proxyUrl = e.data.proxyUrl;
  const id = e.data.id;
  const token = e.data.token;
  const updatedCssString = replaceAbsoluteUrlsWithProxies(
    proxyUrl,
    cssString,
    token,
    ["fonts.gstatic.com", "fonts.googleapis.com"]
  );
  self.postMessage({ updatedCssString, id });
});

function replaceAbsoluteUrlsWithProxies(
  proxyUrl,
  cssString,
  token,
  excludedDomains = []
) {
  const urlRegex = /url\(\s*(['"]?)(https?:\/\/[^'"\)]+)\1\s*\)/g;

  function replaceWithProxy(match, t1, url) {
    const isExcluded = excludedDomains.some((domain) => url.includes(domain));
    if (isExcluded) {
      return match;
    }
    return `url("${proxyUrl}/${url}?proxy-token=${token}")`;
  }

  return cssString.replace(urlRegex, replaceWithProxy);
}
