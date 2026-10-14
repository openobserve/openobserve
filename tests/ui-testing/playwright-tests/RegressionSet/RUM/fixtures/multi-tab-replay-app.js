const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, 'multi-tab-replay');
const CDN = 'https://browsersdk.openobserve.ai';
const SDK_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SDK_PATH_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*\.js$/;
const PAGES = { '/orders.html': 'orders.html', '/catalogue.html': 'catalogue.html' };
const STATIC = {
  '/rum-init.js': ['rum-init.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
};
const UPLOAD_TIMEOUT_MS = 20000;

const SELECTORS = {
  placeOrderBtn: '[data-test="mt-place-order-btn"]',
  orderItem: '[data-test="mt-order-item"]',
  ordersCount: '[data-test="mt-orders-count"]',
  nextProductBtn: '[data-test="mt-next-product-btn"]',
  productName: '[data-test="mt-product-name"]',
  heading: '[data-test="mt-heading"]',
};

// With four orders after the return the old player only scrambled the frame; ten make it hover a detached node and freeze.
const PLAN = { ordersBefore: 2, products: 3, ordersAfter: 10 };
const ORDERS_TAB = { heading: 'Orders desk', finalCount: `Orders placed: ${PLAN.ordersBefore + PLAN.ordersAfter}` };
const CATALOGUE_TAB = { heading: 'Catalogue browser', finalProduct: 'Viewing Notebook' };

function fetchSdkFile(version, rel, cache) {
  const key = `${version}/${rel}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(`${CDN}/${key}`).then(async (res) => {
        if (!res.ok) throw new Error(`CDN ${res.status} for ${key}`);
        return Buffer.from(await res.arrayBuffer());
      }),
    );
  }
  return cache.get(key);
}

function pageWithConfig(file, cfg) {
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  const html = fs.readFileSync(path.join(APP_DIR, file), 'utf8');
  return html.replace('<!--O2_CONFIG-->', () => `<script>window.__O2_CONFIG__=${json};</script>`);
}

/** Serves the two pages with the CDN SDK proxied same-origin, because the CDN's lazy recorder chunk fails a cross-origin import(). */
function startMultiTabReplayServer(opts) {
  if (!SDK_VERSION_PATTERN.test(opts.sdkVersion || '')) {
    return Promise.reject(new Error(`sdkVersion must be x.y.z, got "${opts.sdkVersion}"`));
  }
  const cfg = {
    clientToken: opts.clientToken,
    applicationId: opts.applicationId,
    site: opts.site,
    org: opts.org,
    service: opts.service,
    insecureHTTP: opts.insecureHTTP !== false,
  };
  const cache = new Map();
  // Files are read once here, so no part of a request URL ever reaches a filesystem path.
  const routes = new Map([
    ...Object.entries(PAGES).map(([url, file]) => [url, { type: 'text/html; charset=utf-8', body: pageWithConfig(file, cfg) }]),
    ...Object.entries(STATIC).map(([url, [file, type]]) => [url, { type, body: fs.readFileSync(path.join(APP_DIR, file)) }]),
  ]);

  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const route = routes.get(urlPath);
      if (route) {
        res.writeHead(200, { 'Content-Type': route.type }).end(route.body);
        return;
      }
      const rel = urlPath.startsWith('/sdk/') ? urlPath.slice(5) : '';
      if (!SDK_PATH_PATTERN.test(rel) || rel.includes('..')) {
        res.writeHead(404).end('Not found');
        return;
      }
      const body = await fetchSdkFile(opts.sdkVersion, rel, cache);
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(body);
    } catch (err) {
      res.writeHead(502).end(String(err && err.message));
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({
        origin,
        ordersUrl: `${origin}/orders.html`,
        catalogueUrl: `${origin}/catalogue.html`,
        sdkReachable: () => fetchSdkFile(opts.sdkVersion, 'openobserve-rum.js', cache).then(() => true, () => false),
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function nextReplayUpload(page, org) {
  // The intake sends no CORS headers to this origin, so the browser hides the response; completion is the delivery signal.
  const upload = page
    .waitForRequest((req) => req.url().includes(`/rum/v1/${org}/replay`), { timeout: UPLOAD_TIMEOUT_MS })
    .then((req) => req.response());
  // Awaited later; the noop handler only keeps an early timeout from surfacing as an unhandled rejection.
  upload.catch(() => {});
  return upload;
}

async function openRecordingTab(context, url, org) {
  const page = await context.newPage();
  const recorder = page.waitForResponse((r) => r.url().includes('/sdk/chunks/recorder-') && r.ok(), { timeout: 30000 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await recorder;
  await page.waitForFunction(() => Boolean(window.O2_RUM?.getInternalContext()?.session_id), null, { timeout: 30000 });
  return { page, firstUpload: nextReplayUpload(page, org) };
}

async function placeOrders(page, times) {
  for (let i = 0; i < times; i += 1) {
    await page.locator(SELECTORS.placeOrderBtn).click();
    for (const item of await page.locator(SELECTORS.orderItem).all()) await item.hover();
    await page.locator(SELECTORS.ordersCount).hover();
  }
}

async function browseProducts(page, times) {
  for (let i = 0; i < times; i += 1) {
    await page.locator(SELECTORS.nextProductBtn).click();
    await page.locator(SELECTORS.productName).hover();
  }
}

async function rumContext(page) {
  return page.evaluate(() => window.O2_RUM.getInternalContext());
}

/** Records one session across two tabs (orders, then catalogue beside it, then orders again), waiting for each tab's upload in turn. */
async function recordTwoTabSession(context, server, org) {
  const uploads = [];
  const orders = await openRecordingTab(context, server.ordersUrl, org);
  await placeOrders(orders.page, PLAN.ordersBefore);
  uploads.push(await orders.firstUpload);

  const catalogue = await openRecordingTab(context, server.catalogueUrl, org);
  await browseProducts(catalogue.page, PLAN.products);
  uploads.push(await catalogue.firstUpload);
  // Mouse moves only, so tab B stays on screen longer in the replay without adding nodes to its page.
  const catalogueIdle = nextReplayUpload(catalogue.page, org);
  await catalogue.page.locator(SELECTORS.heading).hover();
  await catalogue.page.locator(SELECTORS.productName).hover();
  uploads.push(await catalogueIdle);

  await orders.page.bringToFront();
  await placeOrders(orders.page, PLAN.ordersAfter);
  // The hover keeps a segment open, so the upload awaited next is the one that carries the last order.
  const ordersFlushed = nextReplayUpload(orders.page, org);
  await orders.page.locator(SELECTORS.heading).hover();
  uploads.push(await ordersFlushed);

  // A live session's newest segment is held back by the player, so one more segment must follow the last order.
  const trailing = nextReplayUpload(orders.page, org);
  await orders.page.locator(SELECTORS.placeOrderBtn).hover();
  uploads.push(await trailing);

  const a = await rumContext(orders.page);
  const b = await rumContext(catalogue.page);
  return {
    sessionId: a.session_id,
    ordersViewId: a.view.id,
    catalogueViewId: b.view.id,
    sameSession: a.session_id === b.session_id,
    uploads: uploads.length,
  };
}

module.exports = { startMultiTabReplayServer, recordTwoTabSession, ORDERS_TAB, CATALOGUE_TAB };
