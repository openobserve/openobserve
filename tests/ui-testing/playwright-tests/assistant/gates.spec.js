// Copyright 2026 OpenObserve Inc.
// Gate flows with the flag on (GATE-01…06, 11–13); WP-05 adds the send halves through the composer.

import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant gates", () => {
  let assistant;
  let harness;
  let state;

  const url = (path) =>
    `${harness.ENV.appUrl}${path}?org_identifier=${harness.ENV.org}`;
  const probes = () =>
    state.log.filter((line) =>
      /^POST \/api\/[^/]+\/ai\/chats\/[^/]+\/cancel/.test(line),
    );

  // The suite signs in as root; a member needs the org-admin flag off as well as a non-admin role.
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

  test("GATE-01 OSS shows only the locked header door with a real pitch @edition", { tag: ["@mock", "@stack-oss"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await harness.forceOssBuild(context);
    // The network sees a real server's stream; the mock's stream shim answers in the page, so its own log is read too.
    const streamRequests = [];
    context.on("request", (request) => {
      if (/\/ai\/chat_stream$/.test(new URL(request.url()).pathname)) streamRequests.push(request.url());
    });
    const shimStreams = () =>
      page.evaluate(() => (window.__o2mock?.requests ?? []).filter((r) => /\/ai\/chat_stream/.test(r.url)).length);
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute(
      "data-state",
      "locked",
      { timeout: 30_000 },
    );
    await expect(assistant.headerButton).toHaveAttribute(
      "aria-label",
      "O2 Assistant, Enterprise and Cloud feature",
    );
    await expect(assistant.v2Ids()).toHaveCount(0);
    // WP-07: no object door renders on OSS, only the locked header button.
    await expect(page.locator('[data-test^="ai-entry-"]')).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+i");
    await expect(page.locator("[data-assistant-root]")).toHaveCount(0);
    await assistant.headerButton.click();
    const pitch = page.locator('[data-gate="not_entitled"][data-size="hero"]');
    await expect(pitch).toBeVisible();
    await expect(pitch.locator("h2")).toHaveText("Meet O2 Assistant");
    await expect(
      pitch.locator('[data-test="assistant-gate-see-plans"]'),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(assistant.headerButton).toBeFocused();
    expect(await shimStreams(), "chat_stream calls on /logs").toBe(0);
    await page.goto(url("/assistant"), { waitUntil: "domcontentloaded" });
    await expect(
      page.locator('[data-gate="not_entitled"][data-size="hero"]'),
    ).toBeVisible({ timeout: 30_000 });
    expect(await shimStreams(), "chat_stream calls on /assistant").toBe(0);
    expect(streamRequests).toEqual([]);
  });

  test("GATE-02 not configured hides the door from members", { tag: ["@mock", "@stack-ee-noagent"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, () =>
      member({ aiEnabled: false, role: "editor" }),
    );
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-test="main-content"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(assistant.headerButton).toHaveCount(0);
    await page.goto(url("/assistant"), { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Page not found")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("GATE-02 not configured mutes the door for admins and opens the setup card", { tag: ["@mock", "@stack-ee-noagent"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, { aiEnabled: false });
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "off", {
      timeout: 30_000,
    });
    await expect(assistant.headerButton).toHaveAttribute(
      "aria-label",
      "O2 Assistant, not set up",
    );
    await expect(assistant.headerButton).not.toHaveAttribute(
      "aria-disabled",
      /.*/,
    );
    await assistant.headerButton.click();
    await expect(
      page.locator(
        '[data-gate="not_configured"] [data-test="assistant-gate-setup"]',
      ),
    ).toBeVisible();
    await page.goto(url("/assistant"), { waitUntil: "domcontentloaded" });
    await expect(
      page.locator('[data-gate="not_configured"][data-size="hero"]'),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("GATE-02 below lg the setup sheet closes by Escape and hands focus back", { tag: ["@mock", "@stack-ee-noagent"] }, async ({ context, page }) => {
    await start(context, page, { aiEnabled: false });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "off", { timeout: 30_000 });
    await assistant.headerButton.click();
    const sheet = page.locator('[data-test="assistant-header-gate-sheet"]');
    await expect(sheet.locator('[data-gate="not_configured"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(assistant.headerButton).toBeFocused();
    await assistant.headerButton.click();
    await sheet.locator('[data-test="assistant-header-gate-sheet-close"]').click();
    await expect(sheet).toHaveCount(0);
  });

  test("GATE-03 a viewer's row door is locked, focusable and opens the reason, nothing else", { tag: ["@mock", "@stack-ee", "@stack-cloud"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, () => member({ role: "viewer" }));
    await page.goto(
      `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs&period=1d`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(assistant.headerButton).toHaveAttribute("data-state", "locked", { timeout: 30_000 });
    const cell = await assistant.logRowCell();
    await cell.focus();
    const door = page.locator('.o2-table-cell-hover-actions [data-test="ai-entry-log-row-explain"]');
    await expect(door).toHaveAttribute("aria-disabled", "true");
    await expect(door).toHaveAttribute("aria-label", "Explain this log row, locked: ask an admin for AI access");
    await door.focus();
    await page.keyboard.press("Enter");
    const reason = page.locator('[data-test="assistant-gate-state"][data-size="popover"]');
    await expect(reason).toBeVisible();
    // The reason must outlive the focus move into it, not flash for one frame (U2).
    await page.waitForTimeout(500);
    await expect(reason).toBeVisible();
    await expect(page.locator("[data-assistant-root]").filter({ visible: true })).toHaveCount(0);
    const events = await harness.captureTelemetry(page);
    expect(events.filter((e) => e.name === "ai_entry_clicked").at(-1)?.properties).toMatchObject({
      sends: false,
      gate: "no_permission",
    });
  });

  test("GATE-03 a viewer is locked before the first keystroke and can ask an admin", { tag: ["@mock", "@stack-ee", "@stack-cloud"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, () => member({ role: "viewer" }));
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute(
      "data-state",
      "locked",
      { timeout: 30_000 },
    );
    await expect(assistant.headerButton).toHaveAttribute(
      "aria-label",
      "O2 Assistant, locked",
    );
    await assistant.headerButton.click();
    const gate = assistant.sidebar.locator(
      '[data-gate="no_permission"][data-size="inline"]',
    );
    await expect(gate).toBeVisible();
    await expect(gate.locator("h2")).toHaveText(
      "O2 Assistant isn't available to your role",
    );
    await expect(
      gate.locator('[data-test="assistant-gate-ask-admin"]'),
    ).toBeFocused();
    await gate.locator('[data-test="assistant-gate-ask-admin"]').click();
    await expect(assistant.askAdmin()).toBeVisible();
    await expect(assistant.askAdmin().locator("textarea")).toHaveValue(
      /grant me O2 Assistant access/,
    );
    await page.keyboard.press("Escape");
    await expect(
      assistant.sidebar.locator('[data-test="assistant-composer"]'),
    ).toHaveCount(0);
    await assistant.sidebar
      .locator('[data-test="assistant-shell-open-in-full-view"]')
      .click();
    const hero = page.locator('[data-gate="no_permission"][data-size="hero"]');
    await expect(hero).toBeVisible({ timeout: 30_000 });
    await expect(
      hero.locator('[data-test="assistant-gate-ask-admin"]'),
    ).toBeFocused();
    await expect(
      page.locator('[data-test="assistant-container-status"]'),
    ).not.toHaveText(/closed/);
    expect(
      state.log.filter((line) => line.includes("/ai/chat_stream")),
    ).toEqual([]);
  });

  test("GATE-04 a custom role refused by the access probe is locked and cached", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, () =>
      member({ role: "custom", probeStatus: 403 }),
    );
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute(
      "data-state",
      "locked",
      { timeout: 30_000 },
    );
    expect(probes()).toHaveLength(1);
    const cached = await page.evaluate(() =>
      Object.keys(sessionStorage).some((key) =>
        key.startsWith("o2.assistant.denied:"),
      ),
    );
    expect(cached).toBe(true);
    await page.goto(url("/alerts"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute(
      "data-state",
      "locked",
      { timeout: 30_000 },
    );
    expect(probes()).toHaveLength(1);
  });

  test("GATE-11 a custom role the probe admits chats without the notice", { tag: ["@mock", "@stack-ee"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, () => member({ role: "custom" }));
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", {
      timeout: 30_000,
    });
    await expect.poll(() => probes().length).toBe(1);
    await assistant.open("header");
    await expect(
      page.locator('[data-test="assistant-gate-unknown-notice"]'),
    ).toHaveCount(0);
    await assistant.send("hello", "complete");
    await expect
      .poll(() => page.evaluate(() => window.__o2mock.requests.length))
      .toBe(1);
  });

  test("GATE-12 with RBAC off everyone chats and nothing is probed", { tag: ["@mock", "@stack-ee"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, () => {
      const base = member({ role: "user" });
      return {
        ...base,
        configPatch: { ...base.configPatch, rbac_enabled: false },
      };
    });
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", {
      timeout: 30_000,
    });
    await assistant.open("header");
    await expect(assistant.welcome).toBeVisible();
    expect(probes()).toEqual([]);
  });

  test("GATE-13 a probe that cannot settle keeps the composer live with the notice", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, () =>
      member({ role: "custom", probeDelayMs: 8_000 }),
    );
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", {
      timeout: 30_000,
    });
    await assistant.open("header");
    const notice = page.locator('[data-test="assistant-gate-unknown-notice"]');
    await expect(notice).toHaveText(
      "Your role may not include O2 Assistant. If sending fails, ask an admin.",
    );
    // The first admitted send settles the role, so the notice goes (WP-05 send half).
    await assistant.send("hello", "complete");
    await expect(notice).toHaveCount(0);
  });

  test("GATE-06 a 403 mid-session swaps the container to the G2 gate", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", {
      timeout: 30_000,
    });
    await assistant.open("header");
    await assistant.send("can I chat?", "forbidden_403");
    await expect(assistant.gate()).toBeVisible();
    await expect(assistant.container().locator('[data-test="assistant-composer"]')).toHaveCount(0);
  });

  test("GATE-05 B-06 overrides the heuristic", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page, () =>
      member({
        role: "custom",
        capabilitiesEnabled: true,
        capabilities: { can_chat: true },
      }),
    );
    await page.goto(url("/logs"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", {
      timeout: 30_000,
    });
    await assistant.open("header");
    await expect(
      page.locator('[data-test="assistant-gate-unknown-notice"]'),
    ).toHaveCount(0);
    expect(probes()).toEqual([]);
  });
});
