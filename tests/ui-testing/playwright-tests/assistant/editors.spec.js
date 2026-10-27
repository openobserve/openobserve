// Copyright 2026 OpenObserve Inc.
// Docked editors, Insert as diff and the sidebar width model with the flag on.

import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant editors and width", () => {
  let assistant;
  let harness;
  let state;

  const url = (path) =>
    `${harness.ENV.appUrl}${path}${path.includes("?") ? "&" : "?"}org_identifier=${harness.ENV.org}`;

  async function ready(page) {
    await expect(assistant.headerButton).toHaveAttribute("data-state", /idle|open/, {
      timeout: 30_000,
    });
  }

  // The alert form's SQL tab opens the full query editor dialog, one of the five docked hosts.
  async function openAlertQueryDialog(page) {
    await page.goto(url("/alerts/add"), { waitUntil: "domcontentloaded" });
    await ready(page);
    const sql = page.locator('[data-test="query-mode-sql"]');
    await sql.waitFor({ state: "visible", timeout: 30_000 });
    await sql.click();
    await page.locator('[data-test="step2-view-editor-btn"]').click();
    const dialog = page.locator('[data-test="query-editor-dialog"]');
    await expect(dialog).toBeVisible();
    return dialog;
  }

  // The dialog's own SQL editor, never the diff's two models.
  async function sqlInEditor(page) {
    return page.evaluate(() => {
      const editors = window.monaco?.editor?.getEditors?.() ?? [];
      const own = editors.filter((e) => {
        const node = e.getContainerDomNode();
        return node.closest('[data-test="query-editor-dialog"]') && !node.closest('[data-test="assistant-diff-block"]');
      });
      return own.map((e) => e.getValue()).find((v) => /^\s*(--[^\n]*\n)?\s*select/i.test(v)) ?? "";
    });
  }

  async function typeSql(page, dialog, sql) {
    const editor = dialog.locator(".monaco-editor").first();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(sql);
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    state = harness.createMockState();
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("SHELL-03 Escape in a docked chat closes the chat only; the dialog and its SQL stay, and × closes it too", { tag: ["@mock", "@stack-ee"] }, async ({
    page,
  }) => {
    const dialog = await openAlertQueryDialog(page);
    await typeSql(page, dialog, 'SELECT * FROM "default" WHERE level = \'error\'');
    const before = await sqlInEditor(page);
    await assistant.dockToggle("alert-query").click();
    const dock = assistant.dock("alert_query");
    await expect(dock).toBeVisible();
    await expect(assistant.dockToggle("alert-query")).toHaveAttribute("aria-pressed", "true");
    await expect(dock.locator('[data-test="assistant-composer-field"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dock).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(assistant.dockToggle("alert-query")).toBeFocused();
    await expect(assistant.dockToggle("alert-query")).toHaveAttribute("aria-pressed", "false");
    expect(await sqlInEditor(page)).toBe(before);
    await assistant.dockToggle("alert-query").click();
    await expect(dock).toBeVisible();
    await dock.locator('[data-test="assistant-shell-close"]').click();
    await expect(dock).toBeHidden();
    await expect(dialog).toBeVisible();
    expect(await sqlInEditor(page)).toBe(before);
  });

  test("EVID-02 Insert as diff in the docked alert editor: preview, Accept, label, Revert; nothing runs or saves", { tag: ["@mock", "@stack-ee"] }, async ({
    page,
  }) => {
    const dialog = await openAlertQueryDialog(page);
    await typeSql(page, dialog, 'SELECT * FROM "default"');
    const original = await sqlInEditor(page);
    await assistant.dockToggle("alert-query").click();
    const dock = assistant.dock("alert_query");
    await expect(dock).toBeVisible();
    await assistant.send("errors per service", "nl_sql");
    const insert = dock.locator('[data-test="assistant-query-insert"]').last();
    await expect(insert).toBeVisible({ timeout: 30_000 });
    const searchesBefore = state.log.filter((r) => /_search/.test(r.url ?? "")).length;
    const searchCalls = [];
    page.on("request", (r) => {
      if (/\/_search|\/alerts\/?[^/]*$/.test(r.url()) && r.method() !== "GET") searchCalls.push(r.url());
    });
    await insert.click();
    const diff = assistant.diff();
    await expect(diff).toBeVisible();
    await expect(diff).toHaveAttribute("aria-label", "Proposed change to the alert query");
    await expect(diff.locator('[data-test="assistant-diff-reject"]')).toBeFocused();
    await expect(diff.locator('[data-test="assistant-diff-status"]')).toContainText(
      "Proposed SQL · not checked · from O2 Assistant",
    );
    expect(await sqlInEditor(page)).toBe(original);
    await diff.locator('[data-test="assistant-diff-accept"]').click();
    await expect(diff).toBeHidden();
    await expect.poll(() => sqlInEditor(page)).toContain("SELECT service_name, count(*) AS errors");
    await expect(assistant.aiLabel()).toContainText("Written by O2 Assistant");
    await expect(dock.locator('[data-test="assistant-composer-field"]')).toBeFocused();
    await assistant.aiLabel().locator('[data-test="ai-label-revert"]').click();
    await expect(assistant.aiLabel()).toBeHidden();
    await expect.poll(() => sqlInEditor(page)).toBe(original);
    expect(searchCalls).toEqual([]);
    expect(state.log.filter((r) => /_search/.test(r.url ?? "")).length).toBe(searchesBefore);
    await expect(dialog).toBeVisible();
  });

  test("EVID-02 Reject leaves the editor byte-identical and Escape in the bar rejects", { tag: ["@mock", "@stack-ee"] }, async ({
    page,
  }) => {
    const dialog = await openAlertQueryDialog(page);
    await typeSql(page, dialog, 'SELECT *   FROM "default"\nWHERE  1 = 1');
    await assistant.dockToggle("alert-query").click();
    await assistant.send("errors per service", "nl_sql");
    const insert = assistant.dock("alert_query").locator('[data-test="assistant-query-insert"]').last();
    await expect(insert).toBeVisible({ timeout: 30_000 });
    const original = await sqlInEditor(page);
    expect(original).toContain("WHERE  1 = 1");
    await insert.click();
    await expect(assistant.diff()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(assistant.diff()).toBeHidden();
    await expect(dialog).toBeVisible();
    expect(await sqlInEditor(page)).toBe(original);
    await insert.click();
    await assistant.diff().locator('[data-test="assistant-diff-reject"]').click();
    expect(await sqlInEditor(page)).toBe(original);
    await expect(assistant.aiLabel()).toHaveCount(0);
  });

  test("SHELL-09 a docked chat never navigates: the link card renders and the route stays", { tag: ["@mock", "@stack-ee"] }, async ({
    page,
  }) => {
    await openAlertQueryDialog(page);
    await assistant.dockToggle("alert-query").click();
    const before = page.url();
    const opened = (await harness.captureTelemetry(page)).filter((e) => e.name === "ai_container_opened").length;
    await assistant.send("open payments errors", "navigation_card");
    const card = assistant.dock("alert_query").locator('[data-test="assistant-link-card"]').last();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    expect(page.url()).toBe(before);
    const after = (await harness.captureTelemetry(page)).filter((e) => e.name === "ai_container_opened").length;
    expect(after).toBe(opened);
  });

  test("SHELL-06 the editor closed mid-turn: the turn keeps running and the previous placement returns", { tag: ["@mock"] }, async ({
    page,
  }) => {
    await page.goto(url("/alerts/add"), { waitUntil: "domcontentloaded" });
    await ready(page);
    await assistant.open("header");
    await expect(assistant.sidebar).toBeVisible();
    const sql = page.locator('[data-test="query-mode-sql"]');
    await sql.click();
    await page.locator('[data-test="step2-view-editor-btn"]').click();
    await assistant.dockToggle("alert-query").click();
    const dock = assistant.dock("alert_query");
    await expect(dock).toBeVisible();
    await expect(assistant.sidebar).toBeHidden();
    await assistant.send("why do errors spike", "slow");
    await expect(assistant.headerButton).toHaveAttribute("data-state", /working|open/);
    await page.locator('[data-test="query-editor-dialog"] [data-test="add-alert-back-btn"]').click();
    await expect(page.locator('[data-test="query-editor-dialog"]')).toBeHidden();
    await expect(assistant.sidebar).toBeVisible();
    await expect(assistant.headerButton).toHaveAttribute("data-state", /working|open/);
    const closed = (await harness.captureTelemetry(page)).filter((e) => e.name === "ai_container_closed");
    expect(closed.map((e) => e.properties.reason)).toContain("host_closed");
  });

  test("SHELL-07 the drag handle stores a width that survives a reload; a page that needs its width opens floating", { tag: ["@mock"] }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await ready(page);
    await assistant.open("header");
    const host = assistant.sidebarHost();
    await expect(host).toHaveAttribute("data-mode", "pinned");
    const mainBefore = await page.locator('main[data-test="main-content"]').evaluate((m) => m.getBoundingClientRect().width);
    const handle = assistant.resizeHandle();
    const box = await handle.boundingBox();
    const startWidth = Number(await handle.getAttribute("aria-valuenow"));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - (30 - startWidth) * 16, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "30");
    const mainAfter = await page.locator('main[data-test="main-content"]').evaluate((m) => m.getBoundingClientRect().width);
    expect(mainAfter).toBeLessThan(mainBefore);
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "29");
    // Keyboard focus must be visible on the handle itself, not only through the panel border.
    const bar = handle.locator("span");
    await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).width)).toBe("4px");
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "30");
    await expect
      .poll(async () => (await harness.captureTelemetry(page)).filter((e) => e.name === "ai_panel_resized").length)
      .toBeGreaterThan(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready(page);
    await expect(host).toHaveAttribute("data-mode", "pinned");
    await expect(assistant.resizeHandle()).toHaveAttribute("aria-valuenow", "30");
    await assistant.close();
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith("o2.assistant.sidebar:")) localStorage.removeItem(key);
    });
    const dashboardId = await harness.createTwoColumnDashboard(`SHELL-07 ${Date.now()}`);
    await page.goto(url(`/dashboards/view?dashboard=${dashboardId}&folder=default&tab=default`), {
      waitUntil: "domcontentloaded",
    });
    await ready(page);
    // The header door sits above the floating card, so it opens floating like any other door here.
    await assistant.open("header");
    await expect(host).toHaveAttribute("data-mode", "floating");
  });

  test("DOOR-07 a log field's regex hand-off opens one assistant: the regex drawer's dock, prefilled", { tag: ["@mock"] }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url("/logs?stream=e2e_automate&stream_type=logs&period=1d"), {
      waitUntil: "domcontentloaded",
    });
    await ready(page);
    await assistant.logRowCell();
    const cell = page
      .locator('[data-test="logs-search-result-logs-table"] tbody tr')
      .filter({ has: page.locator("td[data-o2-focus-cell]") })
      .first()
      .locator("td[data-o2-focus-cell]")
      .nth(1);
    await expect(cell).toBeVisible({ timeout: 30_000 });
    await cell.click();
    await expect(page.locator('[data-test="log-detail-tab-container"]').filter({ visible: true })).toBeVisible();
    await page.locator('[data-test="log-detail-json-tab"]').first().click();
    const rows = page.locator('[data-test="log-detail-json-content"] [data-test^="log-detail-row-"]');
    await rows.first().locator('[data-test="log-details-include-exclude-field-btn"]').click();
    await page.locator('[role="menu"] [data-test="ai-entry-regex-field-ask"]').click();
    await expect(page).toHaveURL(/regex_patterns.*from=logs/);
    const dock = assistant.dock("regex");
    await expect(dock).toBeVisible({ timeout: 30_000 });
    await expect(dock.locator('[data-test="assistant-composer-field"]')).toHaveValue(
      /Which regex matches values like the sample/,
    );
    await expect(dock.locator("[data-assistant-chip]")).toContainText(["Field ·"]);
    await expect(assistant.sidebar).toBeHidden();
    await expect(page.locator('[data-test="add-regex-pattern-open-close-ai-btn"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__o2mock.requests.length)).toBe(0);
  });

  test("SHELL-11 on a phone the docked proposal is reviewable: peek, the bar in view, Reject focused, then half @responsive", { tag: ["@mock", "@responsive"] }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const dialog = await openAlertQueryDialog(page);
    await assistant.dockToggle("alert-query").click();
    const sheet = page.locator('[data-test="assistant-dock-sheet"]');
    await expect(sheet).toBeVisible();
    await assistant.send("errors per service", "nl_sql");
    await sheet.locator('[data-test="assistant-query-more"]').last().click({ timeout: 30_000 });
    await page.locator('[role="menu"] [data-test="assistant-query-insert"]').click();
    await expect(sheet).toHaveAttribute("data-snap", "peek");
    // On a phone the diff spans the dialog's width and reads as wrapping lines, not two narrow gutters.
    await expect(assistant.diff()).toHaveAttribute("data-mode", "lines");
    expect((await assistant.diff().boundingBox()).width).toBeGreaterThanOrEqual(370);
    const reject = assistant.diff().locator('[data-test="assistant-diff-reject"]');
    await expect(reject).toBeInViewport();
    await expect(reject).toBeFocused();
    await reject.click();
    await expect(sheet).toHaveAttribute("data-snap", "half");
    await expect(sheet.locator('[data-test="assistant-composer-field"]')).toBeFocused();
    await expect(dialog).toBeVisible();
  });
});
