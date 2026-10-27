// Copyright 2026 OpenObserve Inc.
// Flows that only mean something against a real server: no mock is installed and every assertion is structural.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

const STACKS = ["@stack-ee", "@stack-ee-noagent", "@stack-oss", "@stack-cloud"];
// The app's own /config, at the API root or under the /web base path, and no other API that ends in /config.
const CONFIG_PATH = /^\/(web\/)?config$/;
const VIEWER = { user: process.env.ASSISTANT_E2E_VIEWER_EMAIL, pass: process.env.ASSISTANT_E2E_MEMBER_PASSWORD };

test.describe("assistant on a real server", () => {
  let assistant;
  let harness;
  let config;

  const logsUrl = () => `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;
  const streamCalls = [];

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    await harness.installMocks(context);
    streamCalls.length = 0;
    config = undefined;
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (CONFIG_PATH.test(path)) response.json().then((body) => (config = body), () => {});
      if (/\/ai\/chat_stream$/.test(path)) streamCalls.push(response.status());
    });
    assistant = new AssistantPage(page);
  });

  /** Keeps only the AI switches of /config (booleans, never values) so the run report says what the server provided. */
  function recordServer(flow) {
    const switches = Object.fromEntries(
      Object.entries(config ?? {}).filter(([k, v]) => typeof v === "boolean" && /(^|_)ai(_|$)|assistant|agent/.test(k)),
    );
    const dir = join(harness.OUT, "server");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${flow}.json`), JSON.stringify({ flow, switches }, null, 2));
    return switches;
  }

  test("STACK-01 a stack run installs no mock and the header button settles from the real config", { tag: STACKS }, async ({ page }) => {
    await harness.login(page);
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton.or(page.locator('[data-test="main-content"]')).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => config, { timeout: 15_000 }).toBeTruthy();
    expect(await page.evaluate(() => ({ mock: typeof window.__o2mock, scenarios: typeof window.__O2MOCK_SCENARIOS__ }))).toEqual({
      mock: "undefined",
      scenarios: "undefined",
    });
    if (await assistant.headerButton.count()) {
      await expect(assistant.headerButton).toHaveAttribute("data-state", /^(idle|open|locked|off)$/, { timeout: 30_000 });
    }
    recordServer("stack-01");
  });

  test("STACK-02 a seeded viewer signs in on a real server and the header button settles locked", { tag: ["@stack-ee"] }, async ({ page }) => {
    test.skip(!VIEWER.user || !VIEWER.pass, "set ASSISTANT_E2E_VIEWER_EMAIL and ASSISTANT_E2E_MEMBER_PASSWORD (the nightly seeds the member)");
    await harness.login(page, VIEWER);
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect.poll(() => config, { timeout: 15_000 }).toBeTruthy();
    await expect(assistant.headerButton).toHaveAttribute("data-state", "locked", { timeout: 30_000 });
    await assistant.headerButton.click();
    await expect(assistant.sidebar.locator('[data-gate="no_permission"]')).toBeVisible();
    await expect(page.locator('[data-test="assistant-composer"]')).toHaveCount(0);
    recordServer("stack-02");
  });

  test("SMOKE-02 a v2 turn on a real server reaches done with a footer and the done event", { tag: ["@stack-ee"] }, async ({ page }) => {
    await harness.login(page);
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await page.mouse.move(0, 0);
    await assistant.open("header");
    await expect(assistant.sidebar).toBeVisible();
    await assistant.send("why 5xx? [replay:complete]");
    await expect.poll(() => streamCalls.length, { timeout: 30_000 }).toBe(1);
    expect(streamCalls[0]).toBe(200);
    await expect(assistant.answer().locator('[data-test="assistant-turn-footer"]')).toBeVisible({ timeout: 120_000 });
    await expect(assistant.status()).toHaveCount(0);
    await expect(assistant.transcript()).not.toHaveAttribute("aria-busy", "true");
    const ended = (await harness.exportTelemetry(page, "smoke-02")).filter((e) => e.name === "ai_turn_ended");
    expect(ended.at(-1)?.properties.outcome).toBe("done");
    recordServer("smoke-02");
  });
});
