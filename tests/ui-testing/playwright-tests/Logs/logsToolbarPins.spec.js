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
// Logs toolbar pins: the "More" menu pins view controls onto the search toolbar,
// and useToolbarPins.ts remembers the choice in localStorage. Seeds that storage
// directly, so no ingestion or server-side setup is involved.

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
    // Pin state is per-context localStorage, discarded with the context.
    testLogger.debug('No teardown required');
  });

  test('histogram is pinned by default until the user decides', {
    tag: ['@toolbarPins', '@logs', '@P0', '@all'],
  }, async () => {
    await pm.logsToolbarPinsPage.seedPinStorage();
    await pm.logsToolbarPinsPage.navigateToLogs(getOrgIdentifier());

    await pm.logsToolbarPinsPage.expectPinnedVisible('histogram');
    // A fallback, not a stored choice: nothing is written until the user toggles.
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
    // Without this flag the default re-applies each load and undoes the unpin.
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

    // The next write must recover the key, not append to the garbage.
    await pm.logsToolbarPinsPage.togglePin('sqlMode');
    const recovered = await pm.logsToolbarPinsPage.readPins();
    expect(Array.isArray(recovered)).toBe(true);
    expect(recovered).toContain('sqlMode');

    testLogger.info('Corrupt pin storage did not break the toolbar and recovered on write');
  });

  test('logs pins do not leak into the traces toolbar scope', {
    tag: ['@toolbarPins', '@logs', '@traces', '@P1', '@all'],
  }, async () => {
    // The scopes share one module-level map only within a single document, so
    // this moves by nav-rail click, never page.goto. The nav helpers assert a
    // document stamp survives, which enforces that.
    const pins = pm.logsToolbarPinsPage;
    await pins.seedPinStorage();
    await pins.navigateToLogs(getOrgIdentifier());
    await pins.stampDocument();

    // quickMode is not in the traces scope's key list.
    await pins.togglePin('quickMode');
    expect(await pins.readPins()).toContain('quickMode');

    await pins.gotoTracesViaNav();
    // Its own default being pinned proves the traces scope really instantiated.
    await pins.expectTracesPinState('savedViews', true);
    await pins.expectTracesPinState('histogram', false);
    await pins.expectTracesMetricsPinnedHidden();

    await pins.toggleTracesPin('histogram');
    const tracesPins = JSON.parse((await pins.readTracesPins()) ?? 'null');
    expect(tracesPins).toContain('savedViews');
    expect(tracesPins).toContain('histogram');
    expect(tracesPins).not.toContain('quickMode');

    // Same document, so this reads the live shared map, not storage.
    await pins.gotoLogsViaNav();
    await pins.expectPinnedVisible('quickMode');
    expect(await pins.readPins()).toContain('quickMode');
    expect(await pins.readPins()).not.toContain('savedViews');

    testLogger.info('Logs and traces pin scopes stayed isolated inside one document');
  });

  test('pinned controls render in canonical order, not click order', {
    tag: ['@toolbarPins', '@logs', '@P1', '@all'],
  }, async () => {
    // Pinned in reverse priority: insertion order would put saved views first.
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

    // Items are fitted greedily in priority order, so the survivors at any width
    // are a PREFIX of it. Asserting the prefix avoids hard-coding breakpoints,
    // which move with font metrics. Note the count is NOT monotonic in width: a
    // narrower toolbar collapses the toggle group, freeing budget for pins.
    const widths = [1700, 1300, 1100, 900, 700];
    const kept = [];
    for (const width of widths) {
      const visible = await pins.setViewportWidthAndSettle(width);
      expect(visible, `pinned items at ${width}px must be a priority prefix`).toEqual(
        pins.assertablePinOrder.slice(0, visible.length),
      );
      kept.push({ width, visible, count: visible.length });
    }
    // Guards against a sweep where nothing ever collapsed.
    expect(kept[0].count).toBe(pins.assertablePinOrder.length);

    // Take the first width that dropped anything and derive the dropped set from
    // its own count, rather than naming a control or a breakpoint.
    const collapsedAt = kept.find((entry) => entry.count < pins.assertablePinOrder.length);
    expect(collapsedAt, 'no width in the sweep dropped a pinned control').toBeDefined();
    const dropped = pins.assertablePinOrder.slice(collapsedAt.count);
    expect(collapsedAt.visible.concat(dropped)).toEqual(pins.assertablePinOrder);

    // Nothing is lost: each dropped control is off the toolbar but still pinned.
    await pins.setViewportWidthAndSettle(collapsedAt.width);
    for (const key of dropped) {
      await pins.expectCollapsedButStillPinned(key);
    }

    testLogger.info(
      `Pinned items kept per width: ${kept.map((e) => `${e.width}px:${e.count}`).join(', ')}` +
        ` | first collapse at ${collapsedAt.width}px, dropped: ${dropped.join(', ')}`,
    );
  });

  test('the syntax guide pin is tracked via the menu pin button title', {
    tag: ['@toolbarPins', '@logs', '@P2', '@all'],
  }, async () => {
    const pins = pm.logsToolbarPinsPage;
    await pins.seedPinStorage();
    await pins.navigateToLogs(getOrgIdentifier());

    await pins.openMoreMenu();
    // The pinned syntax guide control never reaches the DOM (its ODropdown root
    // drops the data-test), so its pin state is assertable only via this title.
    await pins.expectPinToggleTitle('syntaxGuide', pins.pinTitle.unpinned);

    await pins.clickPinToggle('syntaxGuide');
    await pins.expectPinToggleTitle('syntaxGuide', pins.pinTitle.pinned);
    expect(await pins.readPins()).toContain('syntaxGuide');

    await pins.closeMoreMenu();

    testLogger.info('Syntax guide pin state was tracked through the menu pin button title');
  });

  test('the function editor stays pinned and visible at every viewport width', {
    tag: ['@toolbarPins', '@logs', '@P1', '@all'],
  }, async () => {
    const pins = pm.logsToolbarPinsPage;
    // A fresh profile with the histogram default suppressed leaves nothing pinned,
    // so the sweep below proves the function editor stays put on its own.
    await pins.seedPinStorage({ pins: [], decided: true });
    await pins.navigateToLogs(getOrgIdentifier());
    await pins.expectPinnedHidden('functionEditor');

    await pins.togglePin('functionEditor');
    await pins.expectPinnedVisible('functionEditor');

    // showPinnedFunctionEditor has no width budget (SearchBar.vue:2501), so unlike
    // left-section controls it must stay visible at every width while they collapse.
    for (const width of [1700, 1300, 1100, 900, 700]) {
      await pins.setViewportWidthAndSettle(width);
      await pins.expectPinnedVisible('functionEditor');
    }

    testLogger.info('Function editor stayed pinned and visible at every viewport width');
  });
});
