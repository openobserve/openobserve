/**
 * Waiting primitives shared by the on-call page objects.
 *
 * These exist to replace fixed `waitForTimeout` settles. A fixed sleep is a
 * guess in both directions — too short and the read lands mid-repaint, too long
 * and every call pays for the worst case — and it is silent either way.
 *
 * Two DIFFERENT needs, deliberately kept apart:
 *   - `settleRows` waits for something that must happen, and FAILS loudly if it
 *     never does.
 *   - `observeUntil` waits for something that may legitimately never happen and
 *     REPORTS which, because "it did not" is one of the answers its callers
 *     return rather than an error.
 */

const { expect } = require('@playwright/test');

/** OTable's own row hook. Index-based, so it restarts at 0 on every page. */
const TABLE_ROWS = '[data-test^="o2-table-row-"]';

/**
 * A fingerprint of the rows currently drawn.
 *
 * The row index restarts at 0 on each page, so two different pages share the
 * same `data-test` set — the text has to be part of the fingerprint or a page
 * change is indistinguishable from no change at all. One round trip rather than
 * one per row, because this is sampled repeatedly while waiting.
 */
async function rowSignature(page, rowSelector = TABLE_ROWS) {
  return await page
    .locator(rowSelector)
    .evaluateAll((els) =>
      els.map((el) => `${el.getAttribute('data-test')}:${(el.textContent || '').trim().slice(0, 80)}`).join('|'));
}

/**
 * Wait until the table has stopped repainting.
 *
 * Requires several IDENTICAL consecutive samples rather than one pair: a single
 * pair taken before the repaint has even begun looks perfectly stable, which is
 * how this kind of wait passes for a fixed sleep with extra steps. Throws if the
 * list never settles, so a genuinely stuck screen is reported and not absorbed.
 */
async function settleRows(page, { rowSelector = TABLE_ROWS, samples = 3, intervalMs = 150, timeout = 20000 } = {}) {
  let previous = null;
  let repeats = 0;
  await expect
    .poll(async () => {
      const current = await rowSignature(page, rowSelector);
      repeats = current === previous ? repeats + 1 : 0;
      previous = current;
      return repeats;
    }, {
      timeout,
      intervals: [intervalMs],
      message: 'the list never stopped repainting, so anything read off it would be a mid-refetch snapshot',
    })
    .toBeGreaterThanOrEqual(samples);
}

/**
 * Poll `predicate` until it holds or the window closes, and report which.
 *
 * Deliberately NOT an assertion. Callers use this where "it never happened" is
 * a result they return to the spec — a control that issues no request, a row
 * that neither expands nor navigates — so throwing here would destroy the very
 * observation the caller exists to make. Returns as soon as the predicate holds,
 * so the full window is only ever paid when the answer really is "no".
 */
async function observeUntil(page, predicate, { timeout = 1200, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(intervalMs);
  }
}

module.exports = { TABLE_ROWS, rowSignature, settleRows, observeUntil };
