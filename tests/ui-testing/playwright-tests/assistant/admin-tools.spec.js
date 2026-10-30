// Copyright 2026 OpenObserve Inc.
// Settings › Assistant with the flag on: toolsets, permissions, activity, role access and the OSS lock.
import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant settings tools", () => {
  let assistant;
  let harness;
  let state;
  const url = (path, query = "") => `${harness.ENV.appUrl}${path}?org_identifier=${harness.ENV.org}${query}`;
  const control = (page, id) => page.locator(`[data-test="${id}"]`);
  const rows = (page, table) => page.locator(`[data-test="${table}"] tr[data-test^="o2-table-row-"]`);

  async function start(context, page, overrides = {}) {
    harness = await loadHarness();
    state = harness.createMockState(typeof overrides === "function" ? overrides() : overrides);
    await harness.setFlag(context, true);
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  }

  async function openTab(page, tab, query = "") {
    await page.goto(url(`/settings/assistant/${tab}`, query), { waitUntil: "domcontentloaded" });
    await expect(assistant.settings(tab)).toBeVisible({ timeout: 30_000 });
  }

  test("ADMIN-01 the legacy toolsets route redirects into the tab and keeps its query", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page);
    await page.goto(url("/settings/ai_toolsets", "&action=edit&id=ts_2"), { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/settings\/assistant\/toolsets\?.*action=edit.*id=ts_2/, { timeout: 30_000 });
    await expect(control(page, "ai-toolset-form-title")).toHaveText("Edit toolset");
    await expect(control(page, "ai-toolset-name-input").locator("input")).toHaveValue("pagerduty");
    for (const tab of ["toolsets", "permissions", "activity"]) {
      await openTab(page, tab);
      await expect(assistant.settingsTab(tab)).toHaveAttribute("aria-selected", "true");
    }
  });

  for (const width of [768, 1280]) {
    test(`ADMIN-08 at ${width} the toolsets refresh button shows its exact time on hover and on focus`, { tag: ["@mock"] }, async ({ context, page }) => {
      await start(context, page);
      await page.setViewportSize({ width, height: 900 });
      await openTab(page, "toolsets");
      await expect(rows(page, "settings-assistant-toolsets-table")).toHaveCount(2, { timeout: 10_000 });
      const refresh = control(page, "ai-toolsets-list-refresh-btn");
      const bubble = page.locator('[data-test="o-tooltip-content"]').filter({ hasText: "Last refreshed:" });
      await expect(refresh).not.toHaveAttribute("aria-label");
      await refresh.hover();
      await expect(bubble).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(bubble).toHaveCount(0);
      await refresh.focus();
      await expect(bubble).toBeVisible();
    });
  }

  test("ADMIN-08 the toolsets list loads without a hero flash, recovers from errors and filters", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page, { toolsetsDelayMs: 1500 });
    await page.goto(url("/settings/assistant/toolsets"), { waitUntil: "domcontentloaded" });
    await expect(control(page, "settings-assistant-toolsets-table").locator('[data-test="o2-table"]')).toHaveAttribute(
      "data-test-loading",
      "true",
      { timeout: 30_000 },
    );
    await expect(control(page, "o2-empty-state")).toHaveCount(0);
    await expect(rows(page, "settings-assistant-toolsets-table")).toHaveCount(2, { timeout: 10_000 });

    state.toolsetsDelayMs = 0;
    state.toolsetsStatus = 500;
    await control(page, "ai-toolsets-list-refresh-btn").click();
    await expect(control(page, "ai-toolsets-load-error")).toBeVisible();
    state.toolsetsStatus = 200;
    await control(page, "ai-toolsets-retry").click();
    await expect(rows(page, "settings-assistant-toolsets-table")).toHaveCount(2);

    await control(page, "ai-toolsets-search").locator("input").fill("pager");
    await expect(rows(page, "settings-assistant-toolsets-table")).toHaveCount(1);
    await expect(rows(page, "settings-assistant-toolsets-table").first()).toContainText("pagerduty");
    await control(page, "ai-toolsets-search").locator("input").fill("");

    state.toolsetsStatus = 403;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(control(page, "o2-table-forbidden")).toBeVisible({ timeout: 30_000 });

    state.toolsetsStatus = 200;
    state.toolsets = [];
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(control(page, "settings-assistant-toolsets-table").locator('[data-test="o2-empty-state"]')).toBeVisible({
      timeout: 30_000,
    });
  });

  test("ADMIN-08 health columns, the enabled switch and Test show only with toolset health", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page, {
      toolsetHealthEnabled: true,
      toolsetTestResults: [{ ok: false, duration_ms: 90, error: { code: "unauthorized", message: "The MCP server refused the credentials." } }],
    });
    await openTab(page, "toolsets");
    await expect(control(page, "ai-toolset-pagerduty-status")).toContainText("Failing since");
    await expect(control(page, "ai-toolset-pagerduty-last-error")).toHaveText("The MCP server refused the credentials.");
    await expect(control(page, "ai-toolset-kubectl-readonly-status")).toHaveText("OK");
    await control(page, "ai-toolset-kubectl-readonly-enabled").locator('[role="switch"]').click();
    await expect.poll(() => state.toolsetWrites.find((w) => w.method === "PATCH")?.body).toEqual({ enabled: false });
    await control(page, "ai-toolset-pagerduty-test").click();
    await expect(control(page, "ai-toolsets-announce")).toHaveText(
      "Test failed for pagerduty: The MCP server refused the credentials.",
    );
  });

  test("ADMIN-09 without secret merge every secret is retyped and the mask is never sent", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page);
    await openTab(page, "toolsets", "&action=edit&id=ts_2");
    await expect(control(page, "ai-toolset-retype-notice")).toBeVisible({ timeout: 30_000 });
    await control(page, "ai-toolset-save-btn").click();
    await expect(control(page, "ai-toolset-form")).toContainText("Enter the value again");
    expect(state.toolsetWrites).toEqual([]);
    await control(page, "ai-toolset-header-0-input").locator("input").fill("Token fresh-secret");
    await control(page, "ai-toolset-save-btn").click();
    await expect.poll(() => state.toolsetWrites.length).toBe(1);
    const [write] = state.toolsetWrites;
    expect(write.method).toBe("PUT");
    expect(write.body.data.headers).toEqual({ Authorization: "Token fresh-secret" });
    expect(JSON.stringify(write.body)).not.toContain("***");
  });

  test("ADMIN-09 with secret merge an untouched secret is kept without sending it", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page, { capabilitiesEnabled: true, secretMergeEnabled: true });
    await openTab(page, "toolsets", "&action=edit&id=ts_2");
    await expect(control(page, "ai-toolset-header-0-unchanged")).toBeVisible({ timeout: 30_000 });
    await expect(control(page, "ai-toolset-retype-notice")).toHaveCount(0);
    await control(page, "ai-toolset-save-btn").click();
    await expect.poll(() => state.toolsetWrites.length).toBe(1);
    expect(state.toolsetWrites[0].body.data.headers).toEqual({ Authorization: "***" });
  });

  test("ADMIN-09 with secret merge a changed URL asks for every secret again and never sends the mask", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page, { capabilitiesEnabled: true, secretMergeEnabled: true });
    await openTab(page, "toolsets", "&action=edit&id=ts_2");
    await expect(control(page, "ai-toolset-header-0-unchanged")).toBeVisible({ timeout: 30_000 });
    await control(page, "ai-toolset-mcp-url").locator("input").fill("https://mcp2.pagerduty.example/mcp");
    await expect(control(page, "ai-toolset-reenter-notice")).toContainText("Enter every secret again");
    await control(page, "ai-toolset-save-btn").click();
    const input = control(page, "ai-toolset-header-0-input").locator("input");
    await expect(input).toBeFocused();
    expect(state.toolsetWrites).toEqual([]);
    await input.fill("Token rotated");
    await control(page, "ai-toolset-save-btn").click();
    await expect.poll(() => state.toolsetWrites.length).toBe(1);
    expect(state.toolsetWrites[0].body.data).toMatchObject({
      url: "https://mcp2.pagerduty.example/mcp",
      headers: { Authorization: "Token rotated" },
    });
    expect(JSON.stringify(state.toolsetWrites[0].body)).not.toContain("***");
  });

  test("ADMIN-09 the key of a kept secret cannot be renamed and Cancel asks before discarding", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page, { capabilitiesEnabled: true, secretMergeEnabled: true });
    await openTab(page, "toolsets");
    await control(page, "ai-toolset-pagerduty-edit").click({ timeout: 30_000 });
    const key = control(page, "ai-toolset-header-0-key").locator("input");
    await expect(key).toHaveAttribute("readonly", "", { timeout: 30_000 });
    await control(page, "ai-toolset-description-input").locator("textarea").fill("Pages the on-call");
    await control(page, "ai-toolset-cancel-btn").click();
    const guard = control(page, "assistant-shell-leave-guard");
    await expect(guard).toBeVisible();
    await control(page, "assistant-shell-leave-guard-keep").click();
    await expect(control(page, "ai-toolset-form")).toBeVisible();
    await page.goBack();
    await expect(guard).toBeVisible();
    await control(page, "assistant-shell-leave-guard-discard").click();
    await expect(control(page, "settings-assistant-toolsets-tab")).toBeVisible({ timeout: 30_000 });
    expect(state.toolsetWrites).toEqual([]);
  });

  test("ADMIN-10 turning CLI approval off confirms with the command and allow-list", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page);
    await openTab(page, "toolsets", "&action=edit&id=ts_1");
    const approval = control(page, "ai-toolset-cli-approval").locator('[role="switch"]');
    await expect(approval).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await approval.click();
    await control(page, "ai-toolset-env-0-input").locator("input").fill("prod-east");
    await control(page, "ai-toolset-save-btn").click();
    const dialog = assistant.confirmDialog();
    await expect(dialog).toContainText("kubectl");
    await expect(dialog).toContainText("get, describe, logs");
    await expect(dialog.locator('[data-test="o-dialog-secondary-btn"]')).toBeFocused();
    await dialog.locator('[data-test="o-dialog-secondary-btn"]').click();
    expect(state.toolsetWrites).toEqual([]);
    await control(page, "ai-toolset-save-btn").click();
    await dialog.locator('[data-test="o-dialog-primary-btn"]').click();
    await expect.poll(() => state.toolsetWrites.length).toBe(1);
    expect(state.toolsetWrites[0].body.data.requires_confirmation).toBe(false);
  });

  test("ADMIN-11 revoking a standing approval removes the row with a toast", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page, { grantsEnabled: true });
    await openTab(page, "permissions");
    await expect(rows(page, "settings-assistant-grants-table")).toHaveCount(2, { timeout: 30_000 });
    await control(page, "settings-assistant-grant-gr_1-revoke").click();
    await expect(rows(page, "settings-assistant-grants-table")).toHaveCount(1);
    await expect(page.locator('[data-test="o-toast-message"]')).toContainText("Approval revoked");
    expect(state.log).toContain("REVOKE grant gr_1");
  });

  test("ADMIN-11 without grants the Permissions tab says so instead of listing nothing", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page);
    await openTab(page, "permissions");
    await expect(control(page, "settings-assistant-grants-unsupported")).toBeVisible({ timeout: 30_000 });
  });

  test("ADMIN-12 without activity the tab shows the degraded state and no rows", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page);
    await openTab(page, "activity");
    await expect(control(page, "settings-assistant-activity-unsupported")).toBeVisible({ timeout: 30_000 });
    await expect(control(page, "settings-assistant-activity-table")).toHaveCount(0);
  });

  test("ADMIN-12 with activity a row is undone after a confirm", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page, { activityEnabled: true });
    await openTab(page, "activity");
    await expect(rows(page, "settings-assistant-activity-table")).toHaveCount(2, { timeout: 30_000 });
    await control(page, "settings-assistant-activity-act_1-undo").click();
    await assistant.confirmDialog().locator('[data-test="o-dialog-primary-btn"]').click();
    await expect(control(page, "settings-assistant-activity-act_1-result")).toHaveText("Undone");
    await expect(control(page, "settings-assistant-activity-act_1-undo")).toHaveCount(0);
  });

  test("ADMIN-12 the server's activity rows render with who, approval and result", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page, { activityEnabled: true });
    await openTab(page, "activity");
    const table = control(page, "settings-assistant-activity-table");
    await expect(rows(page, "settings-assistant-activity-table")).toHaveCount(2, { timeout: 30_000 });
    await expect(table).toContainText("priya@example.com");
    await expect(table).toContainText("Approved by root@example.com");
    await expect(control(page, "settings-assistant-activity-act_2-result")).toHaveText("Failed: The dashboard changed since.");
    await expect(control(page, "settings-assistant-activity-act_2-undo")).toHaveCount(0);
  });

  // OpenFGA is off on the local backend, so the role reads and the save are answered here.
  async function mockRoles(context, writes) {
    await context.route(/\/api\/[^/]+\/(roles|groups|service_accounts)(\/[^?]*)?(\?.*)?$/, (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const body = (value) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": request.headers()["origin"] || "*", "access-control-allow-credentials": "true" }, body: JSON.stringify(value) });
      if (request.method() === "OPTIONS") return body({});
      if (request.method() === "PUT") {
        writes.push({ path, body: request.postDataJSON() });
        return body({});
      }
      if (/\/roles$/.test(path)) return body(["sre-oncall"]);
      return body([]);
    });
  }

  const rbac = () => ({ configPatch: { ...harness.createMockState().configPatch, rbac_enabled: true } });

  test("ADMIN-13 the role editor groups Assistant and LLM observability with one line each", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page, rbac);
    await mockRoles(context, []);
    await page.goto(url("/iam/roles/edit/sre-oncall"), { waitUntil: "domcontentloaded" });
    const rail = page.locator('[data-test="edit-role-module-rail"]');
    await expect(rail).toContainText("Assistant", { timeout: 30_000 });
    await expect(rail).toContainText("LLM observability");
    await expect(page.locator("#module-desc-ai")).toContainText("Chat with the assistant");
  });

  test("ADMIN-15 Grant chat reaches the role's chat permission in three clicks", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    const writes = [];
    await start(context, page, rbac);
    await mockRoles(context, writes);
    await openTab(page, "access");
    let clicks = 0;
    const click = async (locator) => {
      clicks += 1;
      await locator.click();
    };
    await expect(control(page, "settings-assistant-role-sre-oncall-access")).toHaveText("No chat", { timeout: 30_000 });
    await click(control(page, "settings-assistant-grant-chat-sre-oncall"));
    await expect(page).toHaveURL(/\/iam\/roles\/edit\/sre-oncall\?.*focus=ai/);
    const checkbox = page.locator(
      '[data-test="edit-role-permissions-table-body-row-ai-col-AllowPut-checkbox"] [role="checkbox"]',
    );
    await expect(checkbox).toBeFocused({ timeout: 30_000 });
    await click(checkbox);
    await click(page.locator('[data-test="edit-role-save-btn"]'));
    await expect.poll(() => writes.length).toBe(1);
    expect(clicks).toBe(3);
    expect(JSON.stringify(writes[0].body.add)).toContain("ai:");
  });

  test("ADMIN-13 the MCP page links back to the assistant's toolsets", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page);
    await openTab(page, "toolsets");
    await control(page, "settings-assistant-mcp-link").click();
    await expect(page).toHaveURL(/\/mcpServer/, { timeout: 30_000 });
    await expect(page.locator('[data-test="mcp-server-assistant-parity"]')).toBeVisible({ timeout: 30_000 });
    await control(page, "mcp-server-assistant-toolsets-link").click();
    await expect(assistant.settings("toolsets")).toBeVisible({ timeout: 30_000 });
  });

  test("ADMIN-14 Settings › Assistant is locked on OSS @edition", { tag: ["@mock", "@stack-oss"] }, async ({ context, page }) => {
    await start(context, page);
    await harness.forceOssBuild(context);
    await page.goto(url("/settings/general"), { waitUntil: "domcontentloaded" });
    const item = page.locator('[data-test="settings-assistant-tab-locked"]');
    await expect(item).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-test="settings-assistant-tab"]')).toHaveCount(0);
    await item.click();
    await expect(page).toHaveURL(/\/enterprise-features/);
    await page.goto(url("/settings/assistant/status"), { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-test="enterprise-feature-locked"]')).toBeVisible({ timeout: 30_000 });
    await expect(assistant.settings("status")).toHaveCount(0);
  });
});
