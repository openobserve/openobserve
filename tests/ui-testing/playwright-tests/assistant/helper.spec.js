// Copyright 2026 OpenObserve Inc.
// The inline query helper in the editors with the flag on: proposals as a diff, Stop, refusals, consent and gates.

import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant inline query helper", () => {
  let assistant;
  let harness;
  let state;

  const url = (path) =>
    `${harness.ENV.appUrl}${path}${path.includes("?") ? "&" : "?"}org_identifier=${harness.ENV.org}`;
  // e2e_automate is ingested by the suite's global setup; the helper refuses to run without a stream.
  const logsPath = "/logs?stream=e2e_automate&stream_type=logs&period=15m";

  const member = (overrides) => ({
    configPatch: {
      ...harness.createMockState().configPatch,
      is_org_admin: false,
    },
    ...overrides,
  });

  async function start(context, page, overrides = {}) {
    harness = await loadHarness();
    state = harness.createMockState(
      typeof overrides === "function" ? overrides() : overrides,
    );
    await harness.setFlag(context, true);
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  }

  const logsEditor = (page) =>
    page
      .locator('[data-test="logs-search-bar-query-editor"] .monaco-editor')
      .first();

  // The Logs query editor's own text, never the diff's two models.
  async function logsQuery(page, retries = 2) {
    return readLogsQuery(page).catch(async (error) => {
      // The Logs page can still reload once right after its editor shows.
      if (retries === 0 || !/context was destroyed/.test(String(error)))
        throw error;
      await page.waitForLoadState("domcontentloaded");
      await expect(logsEditor(page)).toBeVisible({ timeout: 30_000 });
      return logsQuery(page, retries - 1);
    });
  }

  function readLogsQuery(page) {
    return page.evaluate(() => {
      const editors = window.monaco?.editor?.getEditors?.() ?? [];
      const own = editors.find((e) => {
        const node = e.getContainerDomNode();
        return (
          node.closest('[data-test="logs-search-bar-query-editor"]') &&
          !node.closest('[data-test="assistant-diff-block"]')
        );
      });
      return own?.getValue() ?? null;
    });
  }

  async function openLogs(page, readyState = "idle") {
    await page.goto(url(logsPath), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute(
      "data-state",
      readyState,
      { timeout: 30_000 },
    );
    await expect(logsEditor(page)).toBeVisible({ timeout: 30_000 });
  }

  // Ctrl+I from the Logs editor opens its helper row with the prompt focused.
  async function openHelper(page) {
    await logsEditor(page).click();
    await page.keyboard.press("ControlOrMeta+i");
    const row = assistant.helper("logs");
    await expect(row).toBeVisible();
    await expect(
      row.locator('[data-test="inline-helper-prompt"] textarea'),
    ).toBeFocused();
    return row;
  }

  async function ask(page, row, text, scenario) {
    await harness.nextScenario(page, scenario);
    await row.locator('[data-test="inline-helper-prompt"] textarea').fill(text);
    await page.keyboard.press("Enter");
  }

  const streamBodies = (page) =>
    page.evaluate(() =>
      window.__o2mock.requests.map((r) => JSON.parse(r.body || "{}")),
    );

  test("HELP-01 the helper proposes a diff; the editor is unchanged until Accept and Reject restores it", { tag: ["@mock", "@stack-ee"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await openLogs(page);
    const row = await openHelper(page);
    const before = await logsQuery(page);
    await ask(page, row, "errors per service", "nl_sql");
    const diff = assistant.diff();
    await expect(diff).toBeVisible({ timeout: 30_000 });
    await expect(
      diff.locator('[data-test="assistant-diff-reject"]'),
    ).toBeFocused();
    expect(await logsQuery(page)).toBe(before);
    await diff.locator('[data-test="assistant-diff-reject"]').click();
    await expect(diff).toBeHidden();
    expect(await logsQuery(page)).toBe(before);
  });

  test("HELP-05 the helper reads the editor live: an edit after open moves the mode chip and reaches the request", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await openLogs(page);
    await logsEditor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("show me the errors please");
    const row = await openHelper(page);
    const mode = row.locator('[data-test="inline-helper-chip-mode"]');
    await expect(mode).toHaveText("Replaces current text");
    await logsEditor(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(
      "SELECT * FROM \"e2e_automate\" WHERE level = 'error'",
    );
    await expect(mode).toHaveText("Edits current query");
    await row.locator('[data-test="inline-helper-prompt"] textarea').click();
    await ask(page, row, "per service", "nl_sql");
    await expect(assistant.diff()).toBeVisible({ timeout: 30_000 });
    const last = (await streamBodies(page)).at(-1);
    expect(JSON.stringify(last)).toContain("level = 'error'");
  });

  test("HELP-06 a follow-up after Accept refines the accepted query", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await openLogs(page);
    const row = await openHelper(page);
    await ask(page, row, "errors per service", "nl_sql_e2e");
    const diff = assistant.diff();
    await expect(diff).toBeVisible({ timeout: 30_000 });
    await diff.locator('[data-test="assistant-diff-accept"]').click();
    await expect(diff).toBeHidden();
    await expect.poll(() => logsQuery(page)).toContain("GROUP BY service_name");
    await expect(
      row.locator('[data-test="inline-helper-chip-mode"]'),
    ).toHaveText("Edits current query");
    await ask(page, row, "only the last hour", "nl_sql_e2e");
    // The scenario answers with the query just accepted, so the helper reads it as no change.
    await expect(row).toContainText("The query already does that.", {
      timeout: 30_000,
    });
    const last = (await streamBodies(page)).at(-1);
    expect(JSON.stringify(last)).toContain("GROUP BY service_name");
  });

  test("HELP-02 a helper turn is ephemeral and never lands in the sidebar's chat", { tag: ["@mock", "@stack-ee"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await openLogs(page);
    const row = await openHelper(page);
    await ask(page, row, "errors per service", "nl_sql");
    await expect(assistant.diff()).toBeVisible({ timeout: 30_000 });
    const bodies = await streamBodies(page);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].ephemeral).toBe(true);
    await assistant
      .diff()
      .locator('[data-test="assistant-diff-reject"]')
      .click();
    await assistant.open("header");
    await expect(assistant.composer()).toBeVisible();
    await expect(assistant.container()).not.toContainText("errors per service");
  });

  test("HELP-03 an answer that needs the chat says so and hands the prompt over with its chips", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await openLogs(page);
    const row = await openHelper(page);
    await ask(
      page,
      row,
      "compare this week's errors with last week's",
      "nl_needs_chat",
    );
    const line = row.locator('[data-test="inline-helper-line"]');
    await expect(line).toContainText("This needs the assistant.", {
      timeout: 30_000,
    });
    await line.locator('[data-test="inline-helper-open-chat"]').click();
    await expect(assistant.composer()).toHaveValue(
      /compare this week's errors with last week's/,
      {
        timeout: 15_000,
      },
    );
    await expect(assistant.chips().first()).toBeVisible();
  });

  test("HELP-04 Stop cancels the server turn and nothing changes", { tag: ["@mock", "@stack-ee"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await openLogs(page);
    const row = await openHelper(page);
    const before = await logsQuery(page);
    await ask(page, row, "errors per service", "slow");
    const stop = row.locator('[data-test="inline-helper-stop"]');
    await expect(stop).toBeVisible({ timeout: 15_000 });
    await stop.click();
    await expect(row.locator('[data-test="inline-helper-line"]')).toContainText(
      "Stopped. Nothing changed.",
    );
    await expect
      .poll(() => page.evaluate(() => (window.__o2mock.cancels || []).length))
      .toBeGreaterThan(0);
    expect(await logsQuery(page)).toBe(before);
  });

  test("ERR-11 a refusal in the helper is one line under the row with a role-aware action, never a toast", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await openLogs(page);
    const row = await openHelper(page);
    await ask(page, row, "errors per service", "credits_exhausted");
    const error = row.locator('[data-test="inline-helper-error"]');
    await expect(error).toHaveCount(1, { timeout: 15_000 });
    await expect(error.locator("button").first()).toBeVisible();
    await expect(page.locator('[data-test="o-toast-message"]')).toHaveCount(0);
  });

  test("CONS-11 consent in the helper is a compact card in the row; Cancel reads Not sent", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await openLogs(page);
    const row = await openHelper(page);
    await ask(page, row, "errors per service", "consent");
    const card = row.locator('[data-test="assistant-consent-card"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[role="dialog"]').filter({ visible: true }),
    ).toHaveCount(0);
    await card.locator('[data-test="assistant-consent-card-cancel"]').click();
    await expect(row.locator('[data-test="inline-helper-line"]')).toContainText(
      "Not sent.",
    );
  });

  test("A11Y-08 a docked editor with a pending approval works from the keys alone", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    test.setTimeout(90_000);
    await start(context, page);
    await page.goto(url("/alerts/add"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute(
      "data-state",
      /idle|open/,
      { timeout: 30_000 },
    );
    await page.locator('[data-test="query-mode-sql"]').click();
    await page.locator('[data-test="step2-view-editor-btn"]').click();
    const dialog = page.locator('[data-test="query-editor-dialog"]');
    await expect(dialog).toBeVisible();
    await assistant.dockToggle("alert-query").click();
    const dock = assistant.dock("alert_query");
    await expect(dock).toBeVisible();
    await harness.nextScenario(page, "permission_card");
    await dock
      .locator('[data-test="assistant-composer-field"]')
      .fill("list the pods");
    await page.keyboard.press("Enter");
    const buffer = dialog.locator(".monaco-editor").first();
    await buffer.click();
    await page.keyboard.type("SELECT ");
    const card = dock.locator('[data-test="assistant-approval-card"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest(".monaco-editor"),
      ),
    ).toBe(true);
    await expect(
      dock.locator('[data-test="assistant-status-region"]'),
    ).toContainText("Press Control I to review it.");
    await page.keyboard.press("ControlOrMeta+i");
    await expect(
      card.locator('[data-test="assistant-approval-deny"]'),
    ).toBeFocused();
    await expect(
      page.locator('[data-test="inline-helper"]').filter({ visible: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden({ timeout: 15_000 });
    await buffer.click();
    await page.keyboard.press("ControlOrMeta+i");
    await expect(
      dock.locator('[data-test="assistant-composer-field"]'),
    ).toBeFocused();
    await buffer.click();
    await page.keyboard.press("Control+m");
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest(".monaco-editor"),
      ),
    ).toBe(false);
    await page.keyboard.press("Escape");
    await page
      .locator("body")
      .click({ position: { x: 1, y: 1 } })
      .catch(() => undefined);
    await page.keyboard.press("Shift+?");
    await expect(
      page.locator('[data-test="shortcut-cheatsheet-row-editorTabFocusMode"]'),
    ).toBeVisible();
  });

  test("GATE-03 a viewer sees the helper door locked and the chord never opens the row", { tag: ["@mock", "@stack-ee", "@stack-cloud"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, () => member({ role: "viewer" }));
    await openLogs(page, "locked");
    const door = assistant.helperDoor("logs");
    await expect(door).toBeVisible();
    await expect(door).toHaveAttribute("aria-disabled", "true");
    await logsEditor(page).click();
    await page.keyboard.press("ControlOrMeta+i");
    await expect(page.locator('[data-test="inline-helper"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__o2mock.requests.length)).toBe(0);
  });

  test("GATE-01 OSS renders no helper door in the editor @edition", { tag: ["@mock", "@stack-oss"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await harness.forceOssBuild(context);
    await openLogs(page, "locked");
    await expect(
      page.locator('[data-test="inline-helper-toolbar"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-test="ai-entry-query-generate"]'),
    ).toHaveCount(0);
  });
});
