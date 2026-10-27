// Copyright 2026 OpenObserve Inc.
// SMOKE-01 (99 §6.1, 00 §3.3): with assistant_v2 off the legacy assistant behaves as on main and no v2 surface renders.

import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

// The legacy chat, regex toggle and NL bar are enterprise-only, so these run only in the assistant_editions job.
test.describe("SMOKE-01 legacy assistant with the flag off @edition", () => {
  test.describe.configure({ mode: "serial" });

  let assistant;
  let harness;

  // e2e_automate is ingested by the suite's global setup; the NL toggle stays disabled until a stream is selected.
  const logsUrl = () => `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;

  test.beforeEach(async ({ context, page }) => {
    test.skip(!process.env.O2_VITE_DEV, "edition rewrite needs the Vite dev server");
    harness = await loadHarness();
    await harness.setFlag(context, false);
    await harness.installMocks(context, harness.createMockState());
    await harness.login(page);
    await harness.forceEnterpriseBuild(context);
    assistant = new AssistantPage(page);
  });

  test("header button opens the legacy sidebar and a complete turn answers", { tag: ["@mock"] }, async ({ page }) => {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.legacy.headerButton).toBeVisible();
    await assistant.openLegacy();
    await expect(assistant.v2Ids()).toHaveCount(0);

    await harness.nextScenario(page, "complete", { speed: 4 });
    await assistant.sendLegacy("Why did checkout start throwing 5xx errors?");
    await expect(page.locator('[data-test="o2-ai-chat-thumbs-up-btn"]').last()).toBeVisible({
      timeout: 30_000,
    });
    const requests = await page.evaluate(() => window.__o2mock.requests.map((r) => r.scenario));
    expect(requests).toEqual(["complete"]);
    await expect(assistant.v2Ids()).toHaveCount(0);
  });

  test("a docked host (regex pattern editor) opens its embedded chat", { tag: ["@mock"] }, async ({ page }) => {
    await page.goto(`${harness.ENV.appUrl}/settings/regex_patterns?org_identifier=${harness.ENV.org}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-test="regex-pattern-list-add-pattern-btn"]').click();
    await expect(assistant.legacy.regexToggle).toBeVisible();
    await assistant.legacy.regexToggle.click();
    await expect(assistant.legacy.composer).toBeVisible();
    await expect(assistant.v2Ids()).toHaveCount(0);
  });

  test("the logs NL bar sends through chat_stream", { tag: ["@mock"] }, async ({ page }) => {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await assistant.legacy.nlToggle.click();
    await expect(assistant.legacy.nlInput).toBeVisible();
    await harness.nextScenario(page, "nl_sql", { speed: 4 });
    await assistant.legacy.nlInput.fill("errors per service in the last 15 minutes");
    await assistant.legacy.nlInput.press("Enter");
    await expect
      .poll(() => page.evaluate(() => window.__o2mock.requests.length), { timeout: 15_000 })
      .toBe(1);
    await expect(assistant.v2Ids()).toHaveCount(0);
  });
});

// Runs only in the assistant_editions job (Vite dev server); the edition rewrite skips on the embedded bundle.
test.describe("SMOKE-01 legacy header across editions @edition", () => {
  let harness;
  let assistant;

  test.beforeEach(async ({ context, page }) => {
    test.skip(!process.env.O2_VITE_DEV, "edition rewrite needs the Vite dev server");
    harness = await loadHarness();
    await harness.setFlag(context, false);
    await harness.installMocks(context, harness.createMockState());
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("an OSS build locks the header button instead of opening the chat @edition", { tag: ["@mock"] }, async ({ context, page }) => {
    await harness.forceOssBuild(context);
    await page.goto(`${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(assistant.legacy.headerButton).toBeVisible();
    await assistant.legacy.headerButton.click();
    await expect(page.locator('[data-test="enterprise-upgrade-dialog"]')).toBeVisible();
    await expect(assistant.legacy.composer).toBeHidden();
    await expect(assistant.v2Ids()).toHaveCount(0);
  });

  test("a Cloud build opens the legacy sidebar from the header @edition", { tag: ["@mock"] }, async ({ context, page }) => {
    await harness.forceCloudBuild(context);
    await page.goto(`${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}`, {
      waitUntil: "domcontentloaded",
    });
    await assistant.openLegacy();
    await expect(assistant.v2Ids()).toHaveCount(0);
  });
});
