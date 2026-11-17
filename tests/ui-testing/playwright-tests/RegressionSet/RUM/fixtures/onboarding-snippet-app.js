const http = require('http');
const { nextReplayUpload } = require('./multi-tab-replay-app.js');

const HEADING = 'Snippet storefront';
const ADD_ITEM_BTN = '[data-test="snippet-add-item-btn"]';
const CDN_HOST = 'browsersdk.openobserve.ai';
const RECORDER_CHUNK = /browsersdk\.openobserve\.ai\/[^/]+\/chunks\/recorder-[^/]*\.js/;
const RECORDER_FAILURE = /Recorder failed to start|Failed to load module script/;
const CDN_LOAD_TIMEOUT_MS = 30000;

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

/** The snippet page as a browser tab sees it, with the SDK's recorder failures and failed CDN requests collected. */
class SnippetAppPage {
  constructor(page, org) {
    this.page = page;
    this.org = org;
    this.addItemBtn = page.locator(ADD_ITEM_BTN);
    this.recorderFailures = [];
    this.cdnFailures = [];
  }

  /** Start it before the first goto, so a failure while the page loads is not missed. */
  watchRecorderFailures() {
    this.page.on('console', (msg) => {
      if (RECORDER_FAILURE.test(msg.text())) this.recorderFailures.push(msg.text());
    });
    this.page.on('requestfailed', (req) => {
      if (req.url().includes(CDN_HOST)) this.cdnFailures.push(`${req.url()}: ${req.failure()?.errorText}`);
    });
  }

  nextReplayUpload() {
    return nextReplayUpload(this.page, this.org);
  }

  /** Opens the page and returns the recorder chunk's URL, status and content type as the CDN answered them. */
  async openAndAwaitRecorderChunk(url) {
    const recorderChunk = this.page.waitForResponse((r) => RECORDER_CHUNK.test(r.url()), { timeout: CDN_LOAD_TIMEOUT_MS });
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    const chunk = await recorderChunk.catch((err) => {
      throw new Error(`No recorder chunk arrived from the CDN. Failed CDN requests: ${JSON.stringify(this.cdnFailures)}. With none, the page never asked for it, which is what a snippet without crossOrigin does. ${err.message}`);
    });
    return { url: chunk.url(), status: chunk.status(), contentType: chunk.headers()['content-type'] };
  }

  /** Awaits an upload from nextReplayUpload(), naming the recorder failures when none came. */
  async awaitReplayUpload(upload) {
    await upload.catch((err) => {
      throw new Error(`The recorder chunk loaded but no replay upload followed. SDK recorder failures: ${JSON.stringify(this.recorderFailures)}. ${err.message}`);
    });
  }

  async clickAddItem() {
    await this.addItemBtn.click();
  }

  async sessionId() {
    return this.page.evaluate(() => window.O2_RUM.getInternalContext()?.session_id);
  }
}

module.exports = { startSnippetAppServer, snippetBundleDownloadError, SnippetAppPage, HEADING };
