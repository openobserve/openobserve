const http = require('http');

const HEADING = 'Snippet storefront';
const ADD_ITEM_BTN = '[data-test="snippet-add-item-btn"]';

function pageHtml({ install, init }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${HEADING}</title>
  ${install}
</head>
<body>
  <h1>${HEADING}</h1>
  <button data-test="snippet-add-item-btn" type="button">Add item</button>
  <ul data-test="snippet-items"></ul>
  ${init}
  <script>
    document.querySelector('[data-test="snippet-add-item-btn"]').addEventListener('click', function () {
      var item = document.createElement('li');
      item.textContent = 'Item added';
      document.querySelector('[data-test="snippet-items"]').appendChild(item);
    });
  </script>
</body>
</html>`;
}

/** Returns why the SDK bundle the install snippet points at cannot be downloaded, or '' when it can. */
async function snippetBundleDownloadError(url) {
  try {
    const res = await fetch(url);
    return res.ok ? '' : `HTTP ${res.status}`;
  } catch (err) {
    return String(err?.cause?.code || err?.message || err);
  }
}

/** Serves the onboarding snippets from a local origin, because the bug only shows when the page's origin differs from the CDN's. */
function startSnippetAppServer(snippets) {
  const body = pageHtml(snippets);
  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
      return;
    }
    res.writeHead(404).end('Not found');
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/index.html`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

module.exports = { startSnippetAppServer, snippetBundleDownloadError, HEADING, ADD_ITEM_BTN };
