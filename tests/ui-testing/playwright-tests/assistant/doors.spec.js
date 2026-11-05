// Copyright 2026 OpenObserve Inc.
// WP-07 doors with the flag on (DOOR-01…12, SEC-05, PERF-01; `99` §6.8).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

// The query helper door is `ai-entry-query-generate` in every host (`60` §6, door id table).
const DOOR_ID = /^ai-entry-[a-z-]+-(explain|troubleshoot|add|ask|fix|generate)$/;
const fixture = (name) => JSON.parse(readFileSync(join(__dirname, "harness", "fixtures", name), "utf8"));

test.describe("assistant doors", () => {
  let assistant;
  let harness;

  const logsUrl = (extra = "") =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs&period=1d${extra}`;

  const table = (page) => page.locator('[data-test="logs-search-result-logs-table"]');
  const cell = (page, row = 0, col = 0) =>
    table(page).locator("tbody tr").filter({ has: page.locator("td[data-o2-focus-cell]") }).nth(row).locator("td[data-o2-focus-cell]").nth(col);
  const toolbar = (page) => page.locator(".o2-table-cell-hover-actions");
  const streamRequests = (page) => page.evaluate(() => window.__o2mock.requests.length);
  const lastRequest = (page) => page.evaluate(() => JSON.parse(window.__o2mock.requests.at(-1)?.body ?? "null"));
  const streamBodies = (page) => page.evaluate(() => window.__o2mock.requests.map((r) => r.body ?? ""));
  const api = (path) => `${harness.ENV.apiOrigin}/api/${harness.ENV.org}${path}`;
  const auth = () => ({ authorization: `Basic ${Buffer.from(`${harness.ENV.user}:${harness.ENV.pass}`).toString("base64")}` });
  const entryEvents = async (page) =>
    (await harness.captureTelemetry(page)).filter((e) => e.name === "ai_entry_clicked").map((e) => e.properties);

  async function gotoLogs(page, extra) {
    await page.goto(logsUrl(extra), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await assistant.logRowCell();
  }

  // Keyboard route: the first cell holds the table's one tab stop and opens the toolbar on focus.
  async function focusRowToolbar(page, row = 0) {
    await cell(page, row).focus();
    await expect(toolbar(page)).toBeVisible();
  }

  async function tabTo(page, dataTest, max = 12) {
    for (let i = 0; i < max; i += 1) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => document.activeElement?.getAttribute("data-test"));
      if (id === dataTest) return;
    }
    throw new Error(`Tab never reached ${dataTest}`);
  }

  async function openRecordDrawer(page) {
    await cell(page, 0, 1).click();
    const drawer = page.locator('[data-test="log-detail-tab-container"]').filter({ visible: true });
    await expect(drawer).toBeVisible();
    return drawer;
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    await harness.installMocks(context, harness.createMockState());
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("DOOR-01 explains a log row by keyboard in one activation", { tag: ["@mock", "@stack-ee", "@responsive"] }, async ({ page }) => {
    await gotoLogs(page);
    await focusRowToolbar(page);
    await tabTo(page, "ai-entry-log-row-explain");
    await page.keyboard.press("Enter");
    await expect(assistant.transcript()).toContainText("Explain this log row from stream `e2e_automate`");
    await expect.poll(() => streamRequests(page)).toBe(1);
    expect(JSON.stringify(await lastRequest(page))).toContain("Log row");
    expect((await entryEvents(page)).at(-1)).toMatchObject({
      entry_kind: "object_verb",
      entry_verb: "explain",
      object_kind: "log_row",
      sends: true,
      gate: "available",
    });
  });

  const stagedLabels = (page) =>
    page.evaluate(async () => {
      const m = await import("/web/src/composables/assistant/index.ts");
      const state = m.assistantStore.state;
      const session = state.sessions[state.shell.activeSid ?? ""];
      return (session?.composer.chips ?? []).filter((c) => c.provenance === "door").map((c) => String(c.label));
    });

  async function fieldMenuItem(page, index, dataTest) {
    await page.locator('[data-test="log-detail-json-tab"]').first().click();
    const rows = page.locator('[data-test="log-detail-json-content"] [data-test^="log-detail-row-"]');
    await rows.nth(index).locator('[data-test="log-details-include-exclude-field-btn"]').click();
    const item = page.locator(`[role="menu"] [data-test="${dataTest}"]`);
    await expect(item).toBeVisible();
    return item;
  }

  test("DOOR-02 Add field to chat keeps the record drawer open beside the pinned panel, ticks, and sends only on Send", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await gotoLogs(page);
    await assistant.open("header");
    const drawer = await openRecordDrawer(page);
    await (await fieldMenuItem(page, 0, "ai-entry-log-field-add")).click();
    await expect(drawer).toBeVisible();
    // The harness rows carry one field, so the second add is the record itself.
    const record = page.locator('[data-test="ai-entry-log-record-add"]');
    await record.click();
    await expect(drawer).toBeVisible();
    await expect(record).toHaveAttribute("data-door-state", "added");
    const panel = assistant.container();
    await expect(panel).toBeVisible();
    const doorChips = assistant.chips().filter({ hasText: /(Field|Log row) · / });
    await expect(doorChips).toHaveCount(2);
    // The drawer stops at the panel's edge instead of covering it (U4).
    const [drawerBox, panelBox] = [await drawer.boundingBox(), await panel.boundingBox()];
    expect(drawerBox.x + drawerBox.width).toBeLessThanOrEqual(panelBox.x + 1);
    expect(await streamRequests(page)).toBe(0);
    await panel.locator('[data-test="assistant-send"]').click();
    await expect.poll(() => streamRequests(page)).toBe(1);
    await expect(drawer).toBeVisible();
  });

  test("DOOR-02 after a reload with the panel pinned, the record drawer still stops at the panel's edge", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await gotoLogs(page);
    await assistant.open("header");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(assistant.container()).toBeVisible({ timeout: 30_000 });
    await assistant.logRowCell();
    const drawer = await openRecordDrawer(page);
    const [drawerBox, panelBox] = [await drawer.boundingBox(), await assistant.container().boundingBox()];
    expect(Math.abs(drawerBox.x + drawerBox.width - panelBox.x)).toBeLessThanOrEqual(1);
    // Escape inside the panel belongs to the panel, never to the drawer beside it.
    await assistant.composer().focus();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeVisible();
  });

  test("DOOR-02 Explain from an open record drawer opens the panel beside it without remounting the drawer", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await gotoLogs(page);
    const drawer = await openRecordDrawer(page);
    const tableTab = page.locator('[data-test="log-detail-table-tab"]').first();
    await tableTab.click();
    await expect(tableTab).toHaveAttribute("aria-selected", "true");
    await page.evaluate(() => {
      window.__drawerBody = document.querySelector('[data-test="log-detail-tab-container"]');
    });
    await page.locator('[data-test="ai-entry-log-record-explain"]').click();
    await expect(assistant.container()).toBeVisible();
    await expect.poll(() => streamRequests(page)).toBe(1);
    await expect(drawer).toBeVisible();
    await expect(tableTab).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => window.__drawerBody?.isConnected)).toBe(true);
    // The drawer slides to its new edge, so the gap is read once it settles.
    await expect
      .poll(async () => {
        const [drawerBox, panelBox] = [await drawer.boundingBox(), await assistant.container().boundingBox()];
        return Math.round(drawerBox.x + drawerBox.width - panelBox.x);
      })
      .toBeLessThanOrEqual(1);
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest("[data-assistant-root]")))
      .toBe(true);
  });

  test("DOOR-02 with the panel hidden, Add field from the record drawer leaves the toast's Open usable", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await gotoLogs(page);
    const drawer = await openRecordDrawer(page);
    await (await fieldMenuItem(page, 0, "ai-entry-log-field-add")).click();
    const open = page.locator('[data-test="o-toast-action-btn"]').filter({ hasText: "Open" }).first();
    await expect(open).toBeVisible();
    await open.focus();
    await expect(open).toBeFocused();
    await open.click();
    await expect(assistant.container()).toBeVisible();
    await expect(assistant.chips().filter({ hasText: /Field · / })).toHaveCount(1);
    await expect(drawer).toBeVisible();
  });

  test("DOOR-02 closing the pinned panel keeps the record drawer, its tab and the focus", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await gotoLogs(page);
    await assistant.open("header");
    const drawer = await openRecordDrawer(page);
    const tableTab = page.locator('[data-test="log-detail-table-tab"]').first();
    await tableTab.click();
    await expect(tableTab).toHaveAttribute("aria-selected", "true");
    await page.evaluate(() => {
      window.__drawerBody = document.querySelector('[data-test="log-detail-tab-container"]');
    });
    await assistant.close();
    await expect(assistant.container()).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await expect(tableTab).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => window.__drawerBody?.isConnected)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => !!document.activeElement?.closest('[data-test="logs-search-result-detail-dialog"]')),
      )
      .toBe(true);
  });

  test("DOOR-12 a second Add never removes the chip", { tag: ["@mock"] }, async ({ page }) => {
    await gotoLogs(page);
    await openRecordDrawer(page);
    await (await fieldMenuItem(page, 0, "ai-entry-log-field-add")).click();
    const again = await fieldMenuItem(page, 0, "ai-entry-log-field-add");
    await expect(again).toHaveAttribute("data-door-state", "added");
    await again.click();
    await again.click().catch(() => undefined);
    await expect.poll(() => stagedLabels(page)).toHaveLength(1);
    expect(await streamRequests(page)).toBe(0);
  });

  test("DOOR-03 explains three selected rows as one chip with a reproducing query, capped above 20", { tag: ["@mock"] }, async ({ page }) => {
    await gotoLogs(page);
    const boxes = table(page).locator('tbody [role="checkbox"]');
    for (let i = 0; i < 3; i += 1) await boxes.nth(i).click();
    const door = page.locator('[data-test="ai-entry-log-rows-explain"]');
    await expect(door).toContainText("Explain these 3 rows");
    await door.click();
    await expect(assistant.transcript()).toContainText("Explain these 3 log rows from `e2e_automate`");
    await expect(assistant.transcript()).toContainText("Query · reproduces the rows");
    await page.locator('[data-test="logs-search-result-selection-clear"]').click();
    for (let i = 0; i < 21; i += 1) await boxes.nth(i).click();
    await expect(door).toHaveAttribute("aria-disabled", "true");
  });

  test("CTX-05 a door refuses the 21st row with the cap line and no In chat tick", { tag: ["@mock"] }, async ({ page }) => {
    await gotoLogs(page);
    const boxes = table(page).locator('tbody [role="checkbox"]');
    for (let i = 0; i < 21; i += 1) await boxes.nth(i).click();
    const door = page.locator('[data-test="ai-entry-log-rows-explain"]');
    await expect(door).toHaveAttribute("aria-disabled", "true");
    await door.hover();
    await expect(page.getByText("Select up to 20 rows to explain at once", { exact: true }).first()).toBeVisible();
    // The door stays focusable and clickable while inert, so the activation is forced past Playwright's aria-disabled check.
    await door.click({ force: true });
    await door.press("Enter");
    await page.waitForTimeout(500);
    await expect(door).toHaveAttribute("data-door-state", "unavailable");
    expect(await streamRequests(page)).toBe(0);
    expect(await stagedLabels(page)).toEqual([]);
  });

  test("DOOR-05 the empty-state door names SQL mode and the absolute range", { tag: ["@mock"] }, async ({ page }) => {
    await gotoLogs(page);
    await page.locator('[data-test="logs-search-bar-sql-mode-toggle-btn"]').click().catch(() => undefined);
    const editor = page.locator('[data-test="logs-search-bar-query-editor"] .monaco-editor').first();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type('SELECT * FROM "e2e_automate" WHERE code = 987654');
    // While the page's own search is in flight this button is Cancel, which would kill the run instead.
    await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toHaveAttribute("title", "Run query", { timeout: 30_000 });
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    const door = page.locator('[data-test="ai-entry-empty-result-troubleshoot"]');
    await expect(door).toBeVisible({ timeout: 30_000 });
    await door.click();
    const prompt = assistant.transcript();
    await expect(prompt).toContainText("This SQL query returned no rows from `e2e_automate` over");
    await expect(prompt).toContainText("What in this SQL excludes rows?");
    await expect(prompt).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  test("DOOR-08 a row Explain while an answer runs is staged and sent only on Send", { tag: ["@mock"] }, async ({ page }) => {
    await gotoLogs(page);
    await assistant.open("header");
    await assistant.send("first question", "slow");
    await expect(assistant.composerState()).toHaveAttribute("data-state", /running|busy|working|streaming/);
    await focusRowToolbar(page);
    await tabTo(page, "ai-entry-log-row-explain");
    await page.keyboard.press("Enter");
    await expect(assistant.container()).toContainText("Added to the chat. Send it when the current answer finishes.");
    expect(await streamRequests(page)).toBe(1);
  });

  test("DOOR-11 a send door never sends over an unfinished draft", { tag: ["@mock"] }, async ({ page }) => {
    await gotoLogs(page);
    await assistant.open("header");
    await assistant.composer().fill("half a thought");
    await focusRowToolbar(page);
    await tabTo(page, "ai-entry-log-row-explain");
    await page.keyboard.press("Enter");
    await expect(assistant.composer()).toHaveValue(/half a thought\nExplain this log row/);
    await expect(assistant.container()).toContainText("Added to your message. Press Send when ready.");
    expect(await streamRequests(page)).toBe(0);
    expect((await entryEvents(page)).at(-1)).toMatchObject({ sends: false });
  });

  test("DOOR-09 every door id on Logs follows the pattern and the header keeps menu-link-ai-item", { tag: ["@mock"] }, async ({ page }) => {
    await gotoLogs(page);
    await focusRowToolbar(page);
    await openRecordDrawer(page);
    const ids = await page.locator('[data-test^="ai-entry-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-test")));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids.filter((id) => id !== "ai-entry-secondary")) expect(id).toMatch(DOOR_ID);
    await expect(page.locator('[data-test="menu-link-ai-item"]')).toHaveCount(1);
  });

  test("DOOR-10 a deep link stages and never sends, and strips its keys", { tag: ["@mock"] }, async ({ page }) => {
    await gotoLogs(page);
    await page.goto(`${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&assistant=explain&object=alert&ref=does-not-exist`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Couldn't find that item to ask about").first()).toBeVisible({ timeout: 30_000 });
    await expect(assistant.container()).toBeVisible();
    await expect.poll(() => page.url()).not.toContain("assistant=");
    expect(await streamRequests(page)).toBe(0);
  });

  test("DOOR-10 a deep link to a real alert stages its chip and prompt, sends nothing, and never fetches a path-shaped ref", { tag: ["@mock"] }, async ({ page }) => {
    const alert = fixture("doors-alert.json");
    const fetched = [];
    await page.context().route(/\/api\/v2\/[^/]+\/alerts\/[^?]+/, (route) => {
      fetched.push(new URL(route.request().url()).pathname);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": route.request().headers()["origin"] || "*", "access-control-allow-credentials": "true" },
        body: JSON.stringify(alert),
      });
    });
    await gotoLogs(page);
    await page.goto(`${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&assistant=troubleshoot&object=alert&ref=${alert.id}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(assistant.composer()).toHaveValue(/attached Alert block/, { timeout: 30_000 });
    await expect(assistant.chips().filter({ hasText: "Checkout 5xx" })).toHaveCount(1);
    await expect.poll(() => page.url()).not.toContain("assistant=");
    expect(await streamRequests(page)).toBe(0);
    await page.goto(`${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&assistant=explain&object=alert&ref=..%2F..%2Fusers`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Couldn't find that item to ask about").first()).toBeVisible({ timeout: 30_000 });
    expect(fetched).toEqual([`/api/v2/${harness.ENV.org}/alerts/${alert.id}`]);
  });

  test("DOOR-04 panel Explain sends the panel as a chip into a dashboard thread", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    const created = await page.request.post(api("/dashboards?folder=default"), { headers: auth(), data: fixture("doors-dashboard.json") });
    expect(created.ok()).toBe(true);
    const id = (await created.json()).v5.dashboardId;
    try {
      await page.goto(`${harness.ENV.appUrl}/dashboards/view?org_identifier=${harness.ENV.org}&dashboard=${id}&folder=default&tab=default`, {
        waitUntil: "domcontentloaded",
      });
      await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
      const panelTitle = page.getByText("Codes by count").first();
      await expect(panelTitle).toBeVisible({ timeout: 30_000 });
      await panelTitle.hover();
      const door = page.locator('[data-test="ai-entry-panel-explain"]').first();
      await expect(door).toBeVisible();
      await door.click();
      const prompt = assistant.transcript();
      await expect(prompt).toContainText("Explain the dashboard panel in the attached Panel block (table).");
      await expect(prompt).toContainText("Panel · Codes by count");
      await expect(assistant.container()).toContainText("Dashboard · WP-07 doors");
      await expect.poll(() => streamRequests(page)).toBe(1);
      expect((await streamBodies(page)).at(-1)).toContain("Codes by count");
    } finally {
      await page.request.delete(api(`/dashboards/${id}?folder=default`), { headers: auth() });
    }
  });

  test("SEC-05 a secret in a row is redacted before it reaches the wire", { tag: ["@mock"] }, async ({ page }) => {
    const { PAYLOADS } = await import("./harness/fixtures/payloads.mjs");
    const row = PAYLOADS.secret_in_row;
    const ingested = await page.request.post(api("/e2e_secret_row/_json"), {
      headers: auth(),
      data: [{ ...row, _timestamp: Date.now() * 1000 }],
    });
    expect(ingested.ok()).toBe(true);
    await page.goto(
      `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_secret_row&stream_type=logs&period=1d&quick_mode=false`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await expect(async () => {
      const run = page.locator('[data-test="logs-search-bar-refresh-btn"]');
      await expect(run).toHaveAttribute("title", "Run query", { timeout: 5_000 });
      await run.click();
      await expect(cell(page)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await focusRowToolbar(page);
    await tabTo(page, "ai-entry-log-row-explain");
    await page.keyboard.press("Enter");
    await expect.poll(() => streamRequests(page)).toBe(1);
    const body = (await streamBodies(page)).at(-1);
    expect(body).not.toContain("hunter22");
    expect(body).not.toContain(row.token);
    expect(body).toContain("[redacted]");
  });

  test("PERF-01 door activations paint their tick within 100 ms p95 at 4× CPU throttle", { tag: ["@mock"] }, async ({ page }) => {
    await gotoLogs(page);
    // The composer holds at most 20 rows, so each round starts from an empty one.
    const clearChips = () =>
      page.evaluate(async () => {
        const m = await import("/web/src/composables/assistant/index.ts");
        const state = m.assistantStore.state;
        const sid = state.shell.activeSid;
        for (const chip of [...(state.sessions[sid ?? ""]?.composer.chips ?? [])]) m.assistantStore.removeChip(sid, chip.id);
      });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    // Two untimed Adds under the throttle load the prompt builders and warm the toast; a built bundle fetches them as one chunk.
    for (const row of [20, 21]) {
      await focusRowToolbar(page, row);
      await tabTo(page, "ai-entry-log-row-add");
      await page.keyboard.press("Enter");
      await expect(page.locator('[data-test="ai-entry-log-row-add"][data-door-state="added"]')).toBeVisible();
    }
    const times = [];
    for (const round of [0, 1]) {
      await clearChips();
      for (let i = 0; i < 10; i += 1) {
        await focusRowToolbar(page, round * 10 + i);
        await tabTo(page, "ai-entry-log-row-add");
        // Timed in the page from the keydown to the first frame after the tick, so no CDP round trip is counted.
        await page.evaluate(() => {
          const door = document.activeElement;
          window.__perf = null;
          let start = 0;
          document.addEventListener("keydown", () => (start = performance.now()), { capture: true, once: true });
          const done = new MutationObserver(() => {
            if (door.getAttribute("data-door-state") !== "added") return;
            done.disconnect();
            requestAnimationFrame(() => (window.__perf = performance.now() - start));
          });
          done.observe(door, { attributes: true, attributeFilter: ["data-door-state"] });
        });
        await page.keyboard.press("Enter");
        await expect.poll(() => page.evaluate(() => window.__perf)).not.toBeNull();
        times.push(await page.evaluate(() => window.__perf));
      }
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const order = times.map(Math.round);
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    test.info().annotations.push({ type: "perf-01", description: JSON.stringify({ order, p95: Math.round(p95) }) });
    // CI runners differ in speed, so there the numbers are recorded and the local run is the gate.
    if (!process.env.CI) expect(p95).toBeLessThanOrEqual(100);
  });

  test("touch: the row kebab mirrors the doors below md with 2.75rem items", { tag: ["@mock"] }, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoLogs(page);
    const kebab = page.locator('[data-test="logs-search-result-row-menu"]').first();
    await expect(kebab).toBeVisible();
    await kebab.click();
    const item = page.locator('[role="menu"] [data-test="ai-entry-log-row-explain"]');
    await expect(item).toBeVisible();
    const box = await item.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('[role="menu"]')).toContainText("Sends this row and asks the assistant to explain it");
  });

  test("DOOR-06 the DBM fix door opens its own Database thread, not the open chat", { tag: ["@mock"] }, async ({ page }) => {
    const deadlocks = fixture("doors-deadlocks.json");
    deadlocks.hits[0].timestamp = (Date.now() - 10 * 60_000) * 1000;
    await page.context().route(/\/db_monitoring\/deadlocks/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": route.request().headers()["origin"] || "*", "access-control-allow-credentials": "true" },
        body: JSON.stringify(deadlocks),
      }),
    );
    await page.goto(`${harness.ENV.appUrl}/infra/databases/deadlocks?org_identifier=${harness.ENV.org}&period=1h`, {
      waitUntil: "domcontentloaded",
    });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await assistant.open("header");
    await assistant.send("first question");
    await expect.poll(() => streamRequests(page)).toBe(1);
    // A busy chat keeps a send door's prompt as a draft (DOOR-08), so the open chat must be idle here.
    await expect(assistant.composerState()).not.toHaveAttribute("data-state", /running|busy|working|streaming/, { timeout: 30_000 });
    await page.locator('[data-test="dbm-deadlocks-table"] tbody tr').first().click();
    const door = page.locator('[data-test="ai-entry-dbm-finding-fix"]');
    await expect(door).toBeVisible();
    await door.click();
    await expect.poll(() => streamRequests(page)).toBe(2);
    await expect(assistant.container()).toContainText("Database · orders-db");
    await expect(assistant.transcript()).not.toContainText("first question");
    expect((await streamBodies(page)).at(-1)).not.toContain("first question");
  });
});
