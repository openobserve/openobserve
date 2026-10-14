// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.
//
// Logs toolbar pins — the "More" menu lets an operator pin view controls out
// onto the search toolbar, and the choice is remembered across sessions in
// localStorage (web/src/composables/useToolbarPins.ts).
//
// Covers:
//   - the histogram is pinned by default, until the user decides otherwise
//   - unpinning the default survives a reload (the "decided" flag)
//   - a pin survives a reload
//   - an unknown key in stored pins is ignored, and dropped on the next write
//   - corrupt pin storage falls back to the defaults instead of throwing
//   - logs pins never leak into the traces toolbar's own scope
//   - pinned controls render in canonical order, not the order they were clicked
//   - a pinned control that no longer fits collapses back into the More menu
//
// Creates nothing server-side: the toolbar renders regardless of query state and
// every precondition is seeded into localStorage, which dies with the browser
// context. No cleanup.spec.js entry is needed.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe('Logs toolbar pins', () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async () => {
    // Pins live only in this context's localStorage, so there is nothing to tear
    // down — the context is discarded between tests.
    testLogger.debug('No teardown required: pin state is per-context localStorage');
  });

  test('histogram is pinned by default until the user decides', {
    tag: ['@toolbarPins', '@logs', '@P0', '@all'],
  }, async () => {
    // No stored pins and no decided flag — the default-pin fallback applies.
    await pm.logsToolbarPinsPage.seedPinStorage();
    await pm.logsToolbarPinsPage.navigateToLogs(getOrgIdentifier());

    await pm.logsToolbarPinsPage.expectPinnedVisible('histogram');
    // The default is a fallback, not a stored choice: nothing is written until
    // the user actually toggles something.
    expect(await pm.logsToolbarPinsPage.readHistogramDecidedFlag()).toBeNull();

    testLogger.info('Histogram renders pinned on a profile that never chose');
  });

  test('unpinning the histogram survives a reload', {
    tag: ['@toolbarPins', '@logs', '@P0', '@all'],
  }, async () => {
    await pm.logsToolbarPinsPage.seedPinStorage();
    await pm.logsToolbarPinsPage.navigateToLogs(getOrgIdentifier());
    await pm.logsToolbarPinsPage.expectPinnedVisible('histogram');

    await pm.logsToolbarPinsPage.togglePin('histogram');
    await pm.logsToolbarPinsPage.expectPinnedHidden('histogram');
    // Without this flag the default-pin fallback re-applies on every load and
    // silently undoes the user's choice.
    expect(await pm.logsToolbarPinsPage.readHistogramDecidedFlag()).toBe('true');

    await pm.logsToolbarPinsPage.reload();
    await pm.logsToolbarPinsPage.expectPinnedHidden('histogram');

    testLogger.info('Unpinned histogram stayed unpinned across a reload');
  });

  test('a pinned control survives a reload', {
    tag: ['@toolbarPins', '@logs', '@P0', '@all'],
  }, async () => {
    await pm.logsToolbarPinsPage.seedPinStorage();
    await pm.logsToolbarPinsPage.navigateToLogs(getOrgIdentifier());
    await pm.logsToolbarPinsPage.expectPinnedHidden('functionEditor');

    await pm.logsToolbarPinsPage.togglePin('functionEditor');
    await pm.logsToolbarPinsPage.expectPinnedVisible('functionEditor');
    expect(await pm.logsToolbarPinsPage.readPins()).toContain('functionEditor');

    await pm.logsToolbarPinsPage.reload();
    await pm.logsToolbarPinsPage.expectPinnedVisible('functionEditor');

    testLogger.info('Pinned function editor persisted across a reload');
  });

  test('an unknown stored pin is ignored and dropped on the next write', {
    tag: ['@toolbarPins', '@logs', '@P1', '@all'],
  }, async () => {
    // A key outside the logs scope must never reach the toolbar, and must not
    // survive the next persist — otherwise it accumulates forever.
    await pm.logsToolbarPinsPage.seedPinStorage({ pins: ['bogus', 'sqlMode'], decided: true });
    await pm.logsToolbarPinsPage.navigateToLogs(getOrgIdentifier());

    await pm.logsToolbarPinsPage.expectPinnedVisible('sqlMode');

    await pm.logsToolbarPinsPage.togglePin('quickMode');
    const pins = await pm.logsToolbarPinsPage.readPins();
    expect(pins).toContain('sqlMode');
    expect(pins).toContain('quickMode');
    expect(pins).not.toContain('bogus');

    testLogger.info('Unknown pin key was filtered out and not re-persisted');
  });

  test('corrupt pin storage falls back to the defaults', {
    tag: ['@toolbarPins', '@logs', '@P1', '@all'],
  }, async () => {
    await pm.logsToolbarPinsPage.seedPinStorage({ pins: 'not json at all' });
    // navigateToLogs asserts the toolbar rendered at all, which is the point here.
    await pm.logsToolbarPinsPage.navigateToLogs(getOrgIdentifier());

    await pm.logsToolbarPinsPage.expectPinnedVisible('histogram');

    // And the next write recovers the key rather than appending to the garbage:
    // a pin toggle must leave a valid array behind.
    await pm.logsToolbarPinsPage.togglePin('sqlMode');
    const recovered = await pm.logsToolbarPinsPage.readPins();
    expect(Array.isArray(recovered)).toBe(true);
    expect(recovered).toContain('sqlMode');

    testLogger.info('Corrupt pin storage did not break the toolbar and recovered on write');
  });

  test('logs pins do not leak into the traces toolbar scope', {
    tag: ['@toolbarPins', '@logs', '@traces', '@P1', '@all'],
  }, async () => {
    // useToolbarPins keeps ONE module-level scopeStates map for both scopes, and
    // that map is only genuinely shared while both scopes are instantiated in the
    // same document. So this test moves between Logs and Traces by nav-rail click
    // (client-side routing) — a page.goto would reload the SPA and rebuild the map
    // per page, leaving only storage-key isolation under test, which
    // useToolbarPins.spec.ts already covers. gotoTracesViaNav/gotoLogsViaNav
    // assert a document stamp survives, so the one-document premise is enforced
    // rather than assumed.
    const pins = pm.logsToolbarPinsPage;
    await pins.seedPinStorage();
    await pins.navigateToLogs(getOrgIdentifier());
    await pins.stampDocument();

    // quickMode is a logs-only key: it is not in the traces scope's key list.
    await pins.togglePin('quickMode');
    expect(await pins.readPins()).toContain('quickMode');

    await pins.gotoTracesViaNav();
    // The traces scope is really instantiated — its own default is pinned — so
    // the assertions below are about isolation, not about an absent scope.
    await pins.expectTracesPinState('savedViews', true);
    await pins.expectTracesPinState('histogram', false);
    await pins.expectTracesMetricsPinnedHidden();

    // Writing the traces scope must persist only traces keys, and must not pick
    // up the logs-only pin through the shared map.
    await pins.toggleTracesPin('histogram');
    const tracesPins = JSON.parse((await pins.readTracesPins()) ?? 'null');
    expect(tracesPins).toContain('savedViews');
    expect(tracesPins).toContain('histogram');
    expect(tracesPins).not.toContain('quickMode');

    // Back on Logs in the SAME document, so the logs scope is read from the live
    // shared map rather than re-read from storage: the traces write must have left
    // both the in-memory state and the stored key alone.
    await pins.gotoLogsViaNav();
    await pins.expectPinnedVisible('quickMode');
    expect(await pins.readPins()).toContain('quickMode');
    expect(await pins.readPins()).not.toContain('savedViews');

    testLogger.info('Logs and traces pin scopes stayed isolated inside one document');
  });

  test('pinned controls render in canonical order, not click order', {
    tag: ['@toolbarPins', '@logs', '@P1', '@all'],
  }, async () => {
    // Pinned in reverse priority, so insertion order would put saved views first.
    await pm.logsToolbarPinsPage.seedPinStorage({ pins: [], decided: true });
    await pm.logsToolbarPinsPage.navigateToLogs(getOrgIdentifier());

    await pm.logsToolbarPinsPage.togglePin('savedViews');
    await pm.logsToolbarPinsPage.togglePin('quickMode');
    await pm.logsToolbarPinsPage.togglePin('histogram');

    const order = await pm.logsToolbarPinsPage.getVisiblePinnedOrder();
    expect(order).toEqual(['histogram', 'quickMode', 'savedViews']);

    testLogger.info(`Pinned controls rendered in canonical order: ${order.join(' -> ')}`);
  });

  test('a pinned control that no longer fits collapses into the More menu', {
    tag: ['@toolbarPins', '@logs', '@P2', '@all'],
  }, async () => {
    const pins = pm.logsToolbarPinsPage;
    // Every left-section control pinned, then the toolbar is starved of width.
    await pins.seedPinStorage({ pins: pins.leftSectionOrder, decided: true });
    await pins.navigateToLogs(getOrgIdentifier());

    // Pinned items are fitted greedily in priority order, so whatever survives at
    // a given width must be a PREFIX of that order — asserting the prefix pins the
    // documented behaviour ("histogram kept longest") without hard-coding the
    // breakpoints, which depend on font metrics and would be flaky across hosts.
    //
    // The count is NOT monotonic in viewport width: as the toolbar narrows, the
    // toggle group collapses to icons and then to a dropdown, which shrinks
    // baseReservedWidth (440 -> 230 -> 120) and can FREE budget for pins. So only
    // the prefix shape is asserted per width, never "narrower means fewer".
    const widths = [1700, 1300, 1100, 900, 700];
    const kept = [];
    for (const width of widths) {
      // Resizing recomputes availableLeftWidth off a ResizeObserver, so the set
      // has to settle before it is read — otherwise this races the recompute.
      const visible = await pins.setViewportWidthAndSettle(width);
      expect(visible, `pinned items at ${width}px must be a priority prefix`).toEqual(
        pins.assertablePinOrder.slice(0, visible.length),
      );
      kept.push({ width, visible, count: visible.length });
    }
    const counts = kept.map((entry) => entry.count);
    // All of them fit when there is room, and some width in the sweep drops one —
    // otherwise the prefix assertions above never exercised a collapse.
    expect(kept[0].count).toBe(pins.assertablePinOrder.length);
    expect(Math.min(...counts)).toBeLessThan(pins.assertablePinOrder.length);

    // Nothing is lost: saved views has dropped off the toolbar at the narrowest
    // width, yet the More menu still reports it as pinned — only the rendering
    // collapsed. Asserted on the set rather than on a count, so no pixel
    // threshold is baked in.
    expect(kept[kept.length - 1].visible).not.toContain('savedViews');
    await pins.expectCollapsedButStillPinned('savedViews');

    testLogger.info(
      `Pinned items kept per width: ${kept.map((e) => `${e.width}px:${e.count}`).join(', ')}`,
    );
  });
});
