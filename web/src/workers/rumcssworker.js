self.addEventListener("message", (e) => {
  const cssString = e.data.cssString;
  const proxyUrl = e.data.proxyUrl;
  const id = e.data.id;
  const updatedCssString = replaceAbsoluteUrlsWithProxies(proxyUrl, cssString, [
    "fonts.gstatic.com",
    "fonts.googleapis.com",
  ]);
  self.postMessage({ updatedCssString, id });
});

function replaceAbsoluteUrlsWithProxies(
  proxyUrl,
  cssString,
  excludedDomains = []
) {
  const urlRegex = /url\(\s*(['"]?)(https?:\/\/[^'"\)]+)\1\s*\)/g;

  function replaceWithProxy(match, t1, url) {
    const isExcluded = excludedDomains.some((domain) => url.includes(domain));
    if (isExcluded) {
      return match;
    }
    return `url("${proxyUrl}/${url}")`;
  }

  return cssString.replace(urlRegex, replaceWithProxy);
}
