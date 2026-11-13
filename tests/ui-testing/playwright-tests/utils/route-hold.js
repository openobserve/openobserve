// Copyright 2026 OpenObserve Inc.

/** Parks every GET to `url` until release(); `requested` resolves once the first one arrives. */
async function holdGet(page, url) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let markRequested;
  const requested = new Promise((resolve) => {
    markRequested = resolve;
  });
  await page.route(url, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    markRequested();
    await gate;
    return route.fallback();
  });
  return { requested, release };
}

module.exports = { holdGet };
