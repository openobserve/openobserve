// Copyright 2026 OpenObserve Inc.
// Settings › Assistant with the flag on: rail, tabs, status card, Test, org policy and the member view.
import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

const TABS = ["status", "access", "data", "history", "usage"];

test.describe("assistant settings", () => {
  let assistant;
  let harness;
  let state;
  const url = (path) => `${harness.ENV.appUrl}${path}?org_identifier=${harness.ENV.org}`;

  // The suite signs in as root; a member needs the org-admin flag off as well as a non-admin role.
  const member = (overrides = {}) => ({
    role: "editor",
    configPatch: { ...harness.createMockState().configPatch, is_org_admin: false },
    ...overrides,
  });

  async function start(context, page, overrides = {}) {
    harness = await loadHarness();
    state = harness.createMockState(typeof overrides === "function" ? overrides() : overrides);
    await harness.setFlag(context, true);
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  }

  async function openTab(page, tab) {
    await page.goto(url(`/settings/assistant/${tab}`), { waitUntil: "domcontentloaded" });
    await expect(assistant.settings(tab)).toBeVisible({ timeout: 30_000 });
  }

  test("ADMIN-01 the rail item opens the page and every tab deep-links", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page);
    await page.goto(url("/settings/general"), { waitUntil: "domcontentloaded" });
    const item = page.locator('[data-test="settings-assistant-tab"]');
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.click();
    await expect(page).toHaveURL(/\/settings\/assistant\/status/);
    await expect(page.locator('[data-test="settings-assistant-page-title"]')).toHaveText("O2 Assistant");
    await expect(item).toHaveAttribute("aria-selected", "true");
    for (const tab of TABS) {
      await openTab(page, tab);
      await expect(assistant.settingsTab(tab)).toHaveAttribute("aria-selected", "true");
    }
  });

  test("ADMIN-02 status without the health probe reads Configured and offers no Test", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page);
    await openTab(page, "status");
    await expect(assistant.settingsControl("status-chip")).toHaveText("Configured");
    await expect(assistant.settingsControl("status-card")).toContainText(
      "Health check needs a newer server version.",
    );
    await expect(assistant.settingsControl("test-btn")).toHaveCount(0);
  });

  test("ADMIN-03 Test passes then fails, announced once each, without a chat", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page, {
      capabilitiesEnabled: true,
      capabilitiesTestDelayMs: 800,
      capabilitiesTestResults: [
        { ok: true, duration_ms: 1200 },
        { ok: false, duration_ms: 40, error: "connection refused" },
      ],
    });
    await openTab(page, "status");
    await expect(assistant.settingsControl("status-chip")).toHaveText("Reachable");
    // The runtime may read the chat list at any time after boot; only a chat Test starts would break "without a chat".
    const sinceOpen = state.log.length;
    const chatsBefore = state.chats.length;
    const button = assistant.settingsControl("test-btn");
    const announce = assistant.settingsControl("test-announce");
    await button.click();
    await expect(button).toBeDisabled();
    await expect(announce).toHaveText("Test passed in 1.2 s");
    await expect(button).toBeEnabled();
    await button.click();
    await expect(announce).toHaveText("Test failed: connection refused");
    await expect(assistant.settingsControl("status-last-test")).toContainText("failed · connection refused");
    expect(state.log.filter((line) => line === "TEST capabilities")).toHaveLength(2);
    expect(state.log.slice(sinceOpen).filter((line) => /^POST \/api\/[^/]+\/ai\/(chat_stream|chats)\b/.test(line))).toEqual([]);
    expect(state.chats).toHaveLength(chatsBefore);
  });

  test("ADMIN-04 turning the assistant off confirms with Cancel focused and the doors follow", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, { capabilitiesEnabled: true, settingsEnabled: true, policyEnforced: true });
    await openTab(page, "access");
    const enabled = assistant.settingsSwitch("enabled-switch");
    await expect(enabled).toHaveAttribute("aria-checked", "true");
    await enabled.click();
    await assistant.settingsControl("policy-save").click();
    const dialog = assistant.confirmDialog();
    await expect(dialog).toContainText("Running answers will be stopped. Members keep their chat history.");
    await expect(dialog.locator('[data-test="o-dialog-secondary-btn"]')).toBeFocused();
    await dialog.locator('[data-test="o-dialog-primary-btn"]').click();
    await expect(page.locator('[data-test="o-toast-message"]')).toHaveText("O2 Assistant turned off for default");
    expect(state.settingsPuts).toEqual([
      { enabled: false, permission_tier: "act_with_approval", org_sharing: true, public_sharing: true, data_sharing_level: "raw" },
    ]);
    await assistant.settingsTab("status").click();
    await expect(assistant.settingsControl("status-chip")).toHaveText("Off for this organization");
    await assistant.headerButton.click();
    await expect(page.locator('[data-test="assistant-gate-state"][data-gate="off_for_org"]')).toBeVisible();
  });

  test("ADMIN-05 without org settings the Access tab is read-only at the deployment values", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await openTab(page, "access");
    await expect(assistant.settingsControl("access-notice")).toContainText(
      "Per-organization controls need a newer server version.",
    );
    await expect(assistant.settingsSwitch("enabled-switch")).toBeDisabled();
    await expect(assistant.settingsSwitch("enabled-switch")).toHaveAttribute("aria-checked", "true");
    await expect(assistant.settingsControl("policy-save")).toHaveCount(0);
  });

  test("ADMIN-06 without an enforced policy only Act with approval is selectable", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page, { capabilitiesEnabled: true, settingsEnabled: true, policyEnforced: false });
    await openTab(page, "access");
    await expect(assistant.settingsControl("tier-read")).toBeDisabled();
    await expect(assistant.settingsControl("tier-propose")).toBeDisabled();
    await expect(assistant.settingsControl("tier-act_with_approval")).toBeEnabled();
    await expect(assistant.settingsControl("tier-needs-agent")).toHaveText(
      "Needs a newer agent version to enforce",
    );
  });

  test("ADMIN-08 a tier save under a deployment public-links lock keeps the stored public value", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, () => ({
      capabilitiesEnabled: true,
      settingsEnabled: true,
      policyEnforced: true,
      configPatch: { ...harness.createMockState().configPatch, public_ai_chat_enabled: false },
    }));
    await openTab(page, "access");
    await expect(assistant.settingsSwitch("public-sharing-switch")).toHaveAttribute("aria-checked", "false");
    await assistant.settingsControl("tier-propose").click();
    await assistant.settingsControl("policy-save").click();
    await expect(page.locator('[data-test="o-toast-message"]')).toHaveText("Assistant settings saved");
    expect(state.settingsPuts).toEqual([
      { enabled: true, permission_tier: "propose", org_sharing: true, public_sharing: true, data_sharing_level: "raw" },
    ]);
  });

  test("ADMIN-07 a member reads every tab, writes nothing, and sees one helper", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page, () => member({ settingsEnabled: true, capabilitiesEnabled: true }));
    for (const tab of TABS) {
      await openTab(page, tab);
      const helpers = assistant.settingsControl("admin-only");
      await expect(helpers).toHaveCount(["status", "access", "data"].includes(tab) ? 1 : 0);
    }
    await openTab(page, "access");
    await expect(assistant.settingsControl("ask-admin")).toBeVisible();
    await expect(assistant.settingsSwitch("enabled-switch")).toBeDisabled();
    await expect(assistant.settingsControl("policy-save")).toHaveCount(0);
    await expect(assistant.settingsControl("own-access")).toContainText("You: ");
  });

  test("GATE-10 an org turned off shows the off-for-org gate to admins and members", { tag: ["@mock"] }, async ({ context, page }) => {
    const off = { enabled: false, permission_tier: "act_with_approval", org_sharing: true, public_sharing: true, data_sharing_level: "raw" };
    await start(context, page, () => member({ capabilitiesEnabled: true, settingsEnabled: true, settings: off }));
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toBeVisible({ timeout: 30_000 });
    await assistant.headerButton.click();
    await expect(page.locator('[data-test="assistant-gate-state"][data-gate="off_for_org"]')).toBeVisible();
  });
});
