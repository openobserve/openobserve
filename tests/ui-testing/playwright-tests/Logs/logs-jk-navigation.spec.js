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

const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const { trackSearches, ingestRows } = require("../utils/auto-run-helpers.js");
const { getAuthHeaders } = require("../utils/cloud-auth.js");
const PageManager = require("../../pages/page-manager.js");

const ORG = `jknav${Date.now()}`;
const STREAM = "jk_logs";
const TOTAL = 130;

const editor = '[data-test="logs-search-bar-query-editor"] .monaco-editor';
const runBtn = '[data-test="logs-search-bar-refresh-btn"]';
const table = '[data-test="logs-search-result-logs-table"]';
const pager = '[data-test="logs-search-result-pagination"]';
const jsonContent = '[data-test="log-detail-json-content"]';

const b64 = (text) =>
  Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, ".");

const urlFor = () =>
  `/web/logs?org_identifier=${ORG}&stream=${STREAM}&stream_type=logs&period=15m&refresh=0` +
  `&sql_mode=false&quick_mode=false&show_histogram=false&query=${b64("")}`;

function fromOf(request) {
  try {
    const body = JSON.parse(request.postData() || "{}");
    const query =
      body.query && typeof body.query === "object" ? body.query : body;
    return Number(query.from ?? 0);
  } catch {
    return 0;
  }
}

async function apiTotal(request) {
  const now = Date.now() * 1000;
  const response = await request.post(
    `${process.env.ZO_BASE_URL}/api/${ORG}/_search?type=logs`,
    {
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      data: {
        query: {
          sql: `SELECT * FROM "${STREAM}"`,
          start_time: now - 3600e6,
          end_time: now,
          from: 0,
          size: 0,
          track_total_hits: true,
        },
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).total;
}

async function openResults(page) {
  await navigateToBase(page);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (/^oo_(toggle_auto_run|logs_|selected_stream_)/.test(key))
        localStorage.removeItem(key);
    }
  });
  const searches = trackSearches(page);
  await page.goto(urlFor());
  await page.locator(editor).first().waitFor({ timeout: 60000 });
  const before = searches.hits().length;
  await page.locator(runBtn).click();
  await expect
    .poll(() => searches.hits().length, { timeout: 30000 })
    .toBeGreaterThan(before);
  await expect(
    page.locator(`${table} [data-test="o2-table-row-49"]`),
  ).toBeAttached({ timeout: 60000 });
  await expect(
    page.locator('[data-test="logs-results-progress"] [role="progressbar"]'),
  ).toHaveCount(0, {
    timeout: 60000,
  });
  await page.evaluate(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.blur(),
  );
  return searches;
}

async function rowMessage(logs, n) {
  const text = await logs.logResultsRow(n).innerText();
  const match = /jk-\d+/.exec(text);
  expect(match, `row ${n} text: ${text}`).not.toBeNull();
  return match[0];
}

async function drawerShows(page, message) {
  await expect(page.locator(jsonContent)).toContainText(
    new RegExp(`message: ${message}(?!\\d)`),
    {
      timeout: 30000,
    },
  );
}

async function openRow(page, logs, n) {
  await logs.logResultsRow(n).scrollIntoViewIfNeeded();
  await logs.logResultsRow(n).click();
  await drawerShows(page, await rowMessage(logs, n));
}

async function axeScan(page, selectors, excluded = []) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== "running" ||
          a.effect?.getTiming().iterations === Infinity,
      ),
  );
  return page.evaluate(
    async ({ include, exclude }) => {
      const result = await window.axe.run(
        {
          include: include.map((selector) => [selector]),
          exclude: exclude.map((selector) => [selector]),
        },
        { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } },
      );
      return {
        passes: result.passes.length,
        violations: result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map(
            (n) =>
              `${n.target.join(" ")} :: ${n.failureSummary?.split("\n")[1] ?? ""}`,
          ),
        })),
      };
    },
    { include: selectors, exclude: excluded },
  );
}

test.describe.configure({ mode: "serial" });

test.describe("Logs J/K navigation (item 4a)", () => {
  test.beforeAll(async ({ request }) => {
    const now = Date.now() * 1000;
    await ingestRows(
      request,
      ORG,
      STREAM,
      Array.from({ length: TOTAL }, (_, i) => ({
        _timestamp: now - 10 * 60e6 + i * 1e6,
        level: i % 3 ? "info" : "warn",
        message: `jk-${i}`,
      })),
    );
    await expect.poll(() => apiTotal(request), { timeout: 120000 }).toBe(TOTAL);
  });

  test(
    "J opens row 0 with focus on the panel; J J K; Esc returns to the row; ↓ then J (J1)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      await openResults(page);

      await logs.pressLogRowKey("j");
      await expect(page.locator(logs.logDetailDialog)).toBeVisible();
      await drawerShows(page, await rowMessage(logs, 0));
      await logs.expectActiveLogRow(0);
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.activeElement?.hasAttribute("data-o2-drawer"),
          ),
        )
        .toBe(true);

      await logs.pressLogRowKey("j");
      await logs.pressLogRowKey("j");
      await logs.pressLogRowKey("k");
      await drawerShows(page, await rowMessage(logs, 1));
      await expect(page.locator(logs.logsDetailNavLive)).toHaveText(
        "Log 2 of 50, page 1",
      );
      await expect(page.locator(logs.logDetailDialog)).toContainText(
        "Log 2 of 50 · Page 1",
      );

      await page.keyboard.press("Escape");
      await expect(page.locator(logs.logDetailDialog)).toBeHidden();
      await expect(logs.logResultsRow(1)).toBeFocused();
      await logs.expectActiveLogRow(1);

      await page.keyboard.press("ArrowDown");
      await expect(logs.logResultsRow(2)).toBeFocused();
      await expect(page.locator(logs.logDetailDialog)).toBeHidden();
      await logs.pressLogRowKey("j");
      await drawerShows(page, await rowMessage(logs, 3));
    },
  );

  test(
    "the Table tab is kept when stepping (AC1.6)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      await openResults(page);
      await logs.pressLogRowKey("j");
      await page.locator(logs.logDetailTableTab).click();
      await expect(page.locator(logs.logDetailTableTab)).toHaveAttribute(
        "data-state",
        "active",
      );
      await logs.pressLogRowKey("j");
      await expect(page.locator(logs.logDetailTableTab)).toHaveAttribute(
        "data-state",
        "active",
      );
      await expect(page.locator(logs.logDetailDialog)).toContainText(
        new RegExp(`${await rowMessage(logs, 1)}(?!\\d)`),
      );
    },
  );

  test(
    "J on row 50 crosses to page 2 inside the open drawer, and K comes back (J2, AC2.1-AC2.3)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      const searches = await openResults(page);
      await openRow(page, logs, 49);
      const page1Last = await rowMessage(logs, 49);

      const schemaReads = [];
      page.on("request", (req) => {
        if (/\/streams\/[^/]+\/schema/.test(req.url()))
          schemaReads.push(req.url());
      });
      const before = searches.hits().length;
      await logs.pressLogRowKey("j");
      await expect.poll(() => searches.hits().length).toBe(before + 1);
      await expect(page.locator(logs.logDetailDialog)).toBeVisible();
      await drawerShows(page, "jk-79");
      await expect(page.locator(logs.logDetailDialog)).toContainText(
        "Log 1 of 50 · Page 2",
      );
      expect(searches.all().filter((r) => r.type === "hits")).toHaveLength(
        before + 1,
      );
      await page.waitForLoadState("networkidle");
      expect(schemaReads).toEqual([]);
      await expect(page.locator(`${pager} [aria-current="page"]`)).toHaveText(
        "2",
      );
      await logs.expectActiveLogRow(0);
      await expect(page.locator(logs.logDetailPageLoading)).toHaveCount(0);
      await expect(page.locator(logs.logDetailDialog)).toContainText(
        "Log 1 of 50 · Page 2",
      );

      await logs.pressLogRowKey("k");
      await drawerShows(page, page1Last);
      await logs.expectActiveLogRow(49);
    },
  );

  test(
    "a held J walks to the last row but does not cross a page (AC2.5)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      const searches = await openResults(page);
      await openRow(page, logs, 47);
      const before = searches.hits().length;
      await page.keyboard.down("j");
      await page.keyboard.down("j");
      await page.keyboard.down("j");
      await page.keyboard.down("j");
      await page.keyboard.up("j");
      await drawerShows(page, await rowMessage(logs, 49));
      await expect(page.locator(logs.logsDetailNavLive)).toHaveText(
        "Last result",
      );
      expect(searches.hits().length).toBe(before);

      await logs.pressLogRowKey("j");
      await expect.poll(() => searches.hits().length).toBe(before + 1);
      await drawerShows(page, "jk-79");
    },
  );

  test(
    "the last row of the last page is an edge; Next is disabled and nothing is requested (AC2.4, AC3.3)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      const searches = await openResults(page);
      await page.locator(`${pager} button`, { hasText: /^3$/ }).click();
      await expect(logs.logResultsRow(29)).toBeAttached({ timeout: 30000 });
      await expect(logs.logResultsRow(30)).toHaveCount(0);
      await openRow(page, logs, 29);
      const before = searches.hits().length;
      await logs.pressLogRowKey("j");
      await expect(page.locator(logs.logsDetailNavLive)).toHaveText(
        "Last result",
      );
      expect(searches.hits().length).toBe(before);
      await expect(page.locator(logs.logDetailNextBtn)).toBeDisabled();
    },
  );

  test(
    "a failing page closes the drawer with an error and announces it outside (AC2.6)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      await openResults(page);
      await openRow(page, logs, 49);
      await page.route("**/_search_stream**", (route) =>
        fromOf(route.request()) > 0
          ? route.fulfill({
              status: 500,
              contentType: "application/json",
              body: '{"code":500,"message":"boom"}',
            })
          : route.continue(),
      );
      await logs.pressLogRowKey("j");
      await expect(page.locator(logs.logDetailDialog)).toBeHidden({
        timeout: 30000,
      });
      await expect(page.locator(logs.logsRowNavLive)).toHaveText(
        "Couldn't load page 2",
      );
      await expect(page.locator(`${table} [data-active-row]`)).toHaveCount(0);
      await page.unroute("**/_search_stream**");
    },
  );

  test(
    "Esc during the load cancels it; nothing reopens and no row is highlighted (AC2.8)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      await openResults(page);
      await openRow(page, logs, 49);
      let release;
      const held = new Promise((resolve) => (release = resolve));
      await page.route("**/_search_stream**", async (route) => {
        if (fromOf(route.request()) > 0) await held;
        await route.continue();
      });
      await logs.pressLogRowKey("j");
      await expect(page.locator(logs.logDetailPageLoading)).toBeVisible();
      await expect(page.locator(logs.logDetailNextBtn)).toBeVisible();
      await expect(page.locator(logs.logDetailDialog)).toContainText(
        "Loading page 2…",
      );
      await page.keyboard.press("Escape");
      await expect(page.locator(logs.logDetailDialog)).toBeHidden();
      release();
      await expect(logs.logResultsRow(0)).toContainText("jk-79", {
        timeout: 30000,
      });
      await expect(page.locator(logs.logDetailDialog)).toBeHidden();
      await expect(page.locator(`${table} [data-active-row]`)).toHaveCount(0);
      await page.unroute("**/_search_stream**");
    },
  );

  test(
    "a mouse page change clears the highlight; the next J opens page 2 row 0 (AC2.13)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      await openResults(page);
      await openRow(page, logs, 17);
      await page.keyboard.press("Escape");
      await logs.expectActiveLogRow(17);
      const schemaReads = [];
      page.on("request", (req) => {
        if (/\/streams\/[^/]+\/schema/.test(req.url()))
          schemaReads.push(req.url());
      });
      await page.locator(`${pager} button`, { hasText: /^2$/ }).click();
      await expect(logs.logResultsRow(0)).toContainText("jk-79", {
        timeout: 30000,
      });
      await expect(page.locator(`${table} [data-active-row]`)).toHaveCount(0);
      await expect(
        page.locator(
          '[data-test="logs-results-progress"] [role="progressbar"]',
        ),
      ).toHaveCount(0, {
        timeout: 60000,
      });
      await page.waitForLoadState("networkidle");
      expect(schemaReads).toEqual([]);
      await page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement.blur(),
      );
      await logs.pressLogRowKey("j");
      await drawerShows(page, "jk-79");
    },
  );

  test(
    "Prev/Next show J and K keycaps, and Next crosses a page like J (J3)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      await openResults(page);
      await openRow(page, logs, 0);
      await expect(page.locator(logs.logDetailNextKbd)).toContainText("J");
      await expect(page.locator(logs.logDetailPreviousKbd)).toContainText("K");
      await expect(page.locator(logs.logDetailPreviousBtn)).toBeDisabled();

      await page.keyboard.press("Escape");
      await openRow(page, logs, 49);
      await expect(page.locator(logs.logDetailNextBtn)).toBeEnabled();
      await page.locator(logs.logDetailNextBtn).click();
      await drawerShows(page, "jk-79");
      await expect(page.locator(logs.logDetailPreviousBtn)).toBeEnabled();
    },
  );

  test(
    "the cheatsheet lists the new rows, and J does nothing behind it (J4, AC5.6)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      await openResults(page);
      await page.keyboard.press("Shift+?");
      for (const id of [
        "logsNextRow",
        "logsPrevRow",
        "logsRowFocusMove",
        "logsRowOpen",
        "logsDetailClose",
        "tracesNextRow",
        "tracesPrevRow",
        "tracesRowOpen",
      ]) {
        await expect(
          page.locator(`[data-test="shortcut-cheatsheet-row-${id}"]`),
        ).toBeAttached();
      }
      await expect(
        page.locator('[data-test="shortcut-cheatsheet-row-traceNextSpan"]'),
      ).toContainText("Next visible span");
      await page.keyboard.press("j");
      await expect(
        page.locator('[data-test="logs-search-result-detail-dialog"]'),
      ).toHaveCount(0);
    },
  );

  test(
    "typing j and k in the query editor selects nothing; after a refresh J opens row 0 (AC5.2, AC5.3)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      const searches = await openResults(page);
      await openRow(page, logs, 5);
      await page.keyboard.press("Escape");
      await page.locator(editor).first().click();
      await page.keyboard.type("jk");
      await expect(page.locator(logs.logDetailDialog)).toBeHidden();
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Backspace");

      const before = searches.hits().length;
      await page.locator(runBtn).click();
      await expect
        .poll(() => searches.hits().length, { timeout: 30000 })
        .toBeGreaterThan(before);
      await expect(page.locator(`${table} [data-active-row]`)).toHaveCount(0, {
        timeout: 30000,
      });
      await expect(
        page.locator(
          '[data-test="logs-results-progress"] [role="progressbar"]',
        ),
      ).toHaveCount(0, {
        timeout: 60000,
      });
      await page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement.blur(),
      );
      await logs.pressLogRowKey("j");
      await drawerShows(page, await rowMessage(logs, 0));
    },
  );

  test(
    "live regions are polite and visually hidden; only the open row has aria-current (J8, AC8.1)",
    {
      tag: ["@jkNavigation", "@logs"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      await openResults(page);
      await logs.pressLogRowKey("j");
      await logs.pressLogRowKey("j");
      for (const selector of [logs.logsDetailNavLive, logs.logsRowNavLive]) {
        const region = page.locator(selector);
        await expect(region).toHaveAttribute("aria-live", "polite");
        await expect(region).toHaveAttribute("aria-atomic", "true");
        await expect(region).toHaveClass(/sr-only/);
      }
      await expect(page.locator(`${table} [aria-current]`)).toHaveCount(1);
    },
  );

  test(
    "axe finds no violations on the J/K surfaces with the drawer open (AC8.2)",
    {
      tag: ["@jkNavigation", "@logs", "@a11y"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logs = pm.logsPage;
      await openResults(page);
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });

      await logs.pressLogRowKey("j");
      await logs.pressLogRowKey("j");
      await expect(page.locator(logs.logsDetailNavLive)).toHaveText(
        "Log 2 of 50, page 1",
      );
      const drawerScan = await axeScan(
        page,
        [
          logs.logDetailDialog,
          logs.logsRowNavLive,
          `${table} [data-active-row]`,
        ],
        [
          `${logs.logDetailDialog} .select-noof-records`,
          `${logs.logDetailDialog} label`,
          `${logs.logDetailDialog} [role="tab"]`,
        ],
      );
      expect(drawerScan.passes).toBeGreaterThan(0);
      expect(drawerScan.violations).toEqual([]);

      await page.keyboard.press("Escape");
      await expect(logs.logResultsRow(1)).toBeFocused();
      const rowScan = await axeScan(page, [
        `${table} [data-active-row]`,
        logs.logsRowNavLive,
      ]);
      expect(rowScan.passes).toBeGreaterThan(0);
      expect(rowScan.violations).toEqual([]);

      await page.keyboard.press("Shift+?");
      await expect(
        page.locator('[data-test="shortcut-cheatsheet-row-logsNextRow"]'),
      ).toBeVisible();
      const sheetScan = await axeScan(page, [
        '[role="dialog"]:has([data-test="shortcut-cheatsheet-row-logsNextRow"])',
      ]);
      expect(sheetScan.passes).toBeGreaterThan(0);
      const preexisting = {
        "scrollable-region-focusable": /^\.px-dialog-content-px /,
        "color-contrast":
          /\.text-accent\b|\.tracking-wider\.uppercase|> \.opacity-60 /,
      };
      const newViolations = sheetScan.violations
        .map((v) => ({
          ...v,
          nodes: v.nodes.filter((n) => !preexisting[v.id]?.test(n)),
        }))
        .filter((v) => v.nodes.length);
      expect(newViolations).toEqual([]);
    },
  );
});
