// Copyright 2026 OpenObserve Inc.
// Sign-out, org switch, two-tab prefs and the floating card's source rule with the flag on.

import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

const SECOND_ORG = "e2e_assistant_lifecycle";
const SIGNED_OUT_ELSEWHERE = "You signed out in another tab. This answer was stopped.";

// Sign-out hard-navigates to the login page, so each cancel a tab sends is mirrored into its sessionStorage.
function keepCancels(page) {
  return page.addInitScript(() => {
    const mock = (window.__o2mock = window.__o2mock || {});
    let list = mock.cancels;
    Object.defineProperty(mock, "cancels", {
      configurable: true,
      get: () => list,
      set(value) {
        list = value;
        try {
          sessionStorage.setItem("e2e.cancels", JSON.stringify(value));
        } catch (_) {
          /* blocked storage */
        }
      },
    });
  });
}

const keptCancels = (page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("e2e.cancels") || "[]"));

// Lets a test detach a tab from the user channel, as a frozen tab would be.
function trackChannels(page) {
  return page.addInitScript(() => {
    const Native = window.BroadcastChannel;
    if (!Native) return;
    const open = (window.__e2eChannels = []);
    window.BroadcastChannel = class extends Native {
      constructor(name) {
        super(name);
        open.push(this);
      }
    };
  });
}

const readLedger = (page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("o2.assistant.liveTurns:"));
    return key ? { key, entries: JSON.parse(localStorage.getItem(key) || "[]") } : { key: null, entries: [] };
  });

test.describe("assistant lifecycle", () => {
  let harness;
  let state;
  let secondOrg;

  const url = (path, org = harness.ENV.org) =>
    `${harness.ENV.appUrl}${path}${path.includes("?") ? "&" : "?"}org_identifier=${org}`;

  async function ready(assistant) {
    await expect(assistant.headerButton).toHaveAttribute("data-state", /idle|open|unread|working/, {
      timeout: 30_000,
    });
  }

  async function openLogs(page, org) {
    const assistant = new AssistantPage(page);
    await page.goto(url("/logs?stream=e2e_automate&stream_type=logs", org), {
      waitUntil: "domcontentloaded",
    });
    await ready(assistant);
    return assistant;
  }

  async function startTurn(assistant, text, scenario = "hang_tool") {
    await assistant.open("header");
    await assistant.send(text, scenario);
    await expect(assistant.status()).toBeVisible();
  }

  async function signOut(page) {
    await page.locator('[data-test="header-my-account-profile-icon"]').click();
    await page.locator('[data-test="menu-link-logout-item"]').click();
  }

  // The login page's own requests must settle before the context closes, or their mocked routes throw.
  async function atLogin(page) {
    await page.waitForURL(/\/login/);
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  async function switchOrg(page, identifier) {
    await page.locator('[data-test="navbar-organizations-select-trigger"]').click();
    await page
      .locator(`[data-test="organization-menu-item-label-item-label"][data-test-org-identifier="${identifier}"]`)
      .click();
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    state = harness.createMockState();
    await harness.installMocks(context, state);
    await harness.login(page);
    secondOrg = await harness.ensureOrg(SECOND_ORG);
  });

  test("XTAB-05 sign-out in B asks first, cancels A's answer and A stops without a reload", { tag: ["@mock", "@stack-ee"] }, async ({
    context,
    page,
  }) => {
    const a = await openLogs(page);
    await startTurn(a, "why 5xx?");
    await expect.poll(async () => (await readLedger(page)).entries.length).toBe(1);
    const [{ sid }] = (await readLedger(page)).entries;
    await page.evaluate(() => (window.__e2eNoReload = true));
    const [b] = await harness.twoTabs(context);
    await keepCancels(b);
    await openLogs(b);
    await signOut(b);
    const dialog = new AssistantPage(b).lifecycleDialog("sign_out");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Answers are still running");
    await expect(b.locator('[data-test="assistant-shell-sign-out-stop"]')).toBeFocused();
    await b.locator('[data-test="assistant-shell-sign-out-stop"]').click();
    await atLogin(b);
    expect((await keptCancels(b)).some((c) => c.url.includes(`/chats/${sid}/cancel`) && c.keepalive)).toBe(true);
    await expect(a.outcome()).toContainText(SIGNED_OUT_ELSEWHERE);
    await expect(a.outcome()).toHaveAttribute("data-code", "signed_out");
    expect(await page.evaluate(() => window.__e2eNoReload)).toBe(true);
    // Signing in again in B lifts A's lock without a reload: Send works again.
    await a.composer().fill("hello again");
    const send = a.container().locator('[data-test="assistant-send"]');
    await expect(send).toBeDisabled();
    await harness.login(b);
    await expect(send).toBeEnabled();
    expect(await page.evaluate(() => window.__e2eNoReload)).toBe(true);
  });

  test("XTAB-07 recall and width are read-merge-write across two tabs", { tag: ["@mock"] }, async ({ context, page }) => {
    const a = await openLogs(page);
    const [tabB] = await harness.twoTabs(context);
    const b = await openLogs(tabB);
    await a.open("header");
    // A hidden tab's timers are throttled, so each tab streams its answer to the end while in front.
    const sendAndSettle = async (tab, assistant, text) => {
      await tab.bringToFront();
      await assistant.send(text, "complete");
      await expect(assistant.composerState()).toHaveAttribute("data-state", "empty", { timeout: 20_000 });
    };
    await sendAndSettle(page, a, "one");
    await tabB.bringToFront();
    await b.open("header");
    await sendAndSettle(tabB, b, "two");
    await sendAndSettle(page, a, "three");
    await a.composer().click();
    await page.keyboard.press("ArrowUp");
    await expect(a.composer()).toHaveValue("three");
    await page.keyboard.press("ArrowUp");
    await expect(a.composer()).toHaveValue("two");
    await page.keyboard.press("ArrowUp");
    await expect(a.composer()).toHaveValue("one");
    await a.close();
    await tabB.bringToFront();
    const handle = b.resizeHandle();
    await handle.focus();
    await tabB.keyboard.press("End");
    const width = await handle.getAttribute("aria-valuenow");
    await page.bringToFront();
    await a.open("header");
    await expect(a.resizeHandle()).toHaveAttribute("aria-valuenow", width);
  });

  test("LIFE-01 org switch → Keep: the answer keeps running in its org and never shows in the next one", { tag: ["@mock", "@stack-ee"] }, async ({
    page,
  }) => {
    const a = await openLogs(page);
    await startTurn(a, "why 5xx in default?", "slow");
    await a.close();
    await switchOrg(page, secondOrg);
    const dialog = a.lifecycleDialog("org_switch");
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-test="assistant-shell-org-switch-keep"]')).toBeFocused();
    await page.locator('[data-test="assistant-shell-org-switch-keep"]').click();
    await expect(page).toHaveURL(new RegExp(`org_identifier=${secondOrg}`));
    expect(await page.evaluate(() => window.__o2mock.cancels ?? [])).toHaveLength(0);
    await ready(a);
    await a.open("header");
    await expect(a.container()).not.toContainText("why 5xx in default?");
    await a.close();
    await switchOrg(page, harness.ENV.org);
    await expect(page).toHaveURL(new RegExp(`org_identifier=${harness.ENV.org}`));
    await ready(a);
    await a.open("header");
    await expect(a.transcript()).toContainText("why 5xx in default?");
  });

  test("LIFE-02 org switch → Stop cancels the running answer and nothing streams on", { tag: ["@mock"] }, async ({ page }) => {
    const a = await openLogs(page);
    await startTurn(a, "why 5xx before switching?");
    await a.close();
    await switchOrg(page, secondOrg);
    await page.locator('[data-test="assistant-shell-org-switch-stop"]').click();
    await expect(page).toHaveURL(new RegExp(`org_identifier=${secondOrg}`));
    await expect
      .poll(() => page.evaluate(() => (window.__o2mock.cancels ?? []).map((c) => c.url)))
      .toEqual([expect.stringContaining(`/api/${harness.ENV.org}/ai/chats/`)]);
    const streams = await page.evaluate(() => window.__o2mock.requests.length);
    await switchOrg(page, harness.ENV.org);
    await ready(a);
    await a.open("header");
    await expect(a.outcome()).toHaveAttribute("data-kind", "stopped");
    expect(await page.evaluate(() => window.__o2mock.requests.length)).toBe(streams);
  });

  test("XTAB-08 sign-out reaches a tab in another org: it cancels its own answer and the ledger empties", { tag: ["@mock", "@stack-ee"] }, async ({
    context,
    page,
  }) => {
    await keepCancels(page);
    const a = await openLogs(page, secondOrg);
    await startTurn(a, "why 5xx in the second org?");
    await expect
      .poll(async () => (await readLedger(page)).entries.map((e) => e.org))
      .toEqual([secondOrg]);
    const [b] = await harness.twoTabs(context);
    await keepCancels(b);
    await openLogs(b);
    await signOut(b);
    const started = Date.now();
    await b.locator('[data-test="assistant-shell-sign-out-stop"]').click();
    await expect(a.outcome()).toContainText(SIGNED_OUT_ELSEWHERE, { timeout: 5_000 });
    expect(Date.now() - started).toBeLessThan(5_000);
    await expect
      .poll(async () => (await page.evaluate(() => window.__o2mock.cancels ?? [])).map((c) => c.url))
      .toContainEqual(expect.stringContaining(`/api/${secondOrg}/ai/chats/`));
    await atLogin(b);
    const fromB = await keptCancels(b);
    expect(fromB.some((c) => c.url.includes(`/api/${secondOrg}/ai/chats/`) && c.keepalive)).toBe(true);
    expect((await readLedger(page)).entries).toEqual([]);
  });

  test("XTAB-11 sign-out cancels a turn that started before the tab opened, from the ledger alone", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await trackChannels(page);
    const a = await openLogs(page);
    await startTurn(a, "why 5xx while frozen?");
    await expect.poll(async () => (await readLedger(page)).entries.length).toBe(1);
    const ledger = await readLedger(page);
    const [entry] = ledger.entries;
    await page.evaluate(
      ({ key, entries }) =>
        localStorage.setItem(
          key,
          JSON.stringify([...entries, { org: "default", sid: "stale-sid", origin: "chat", turnId: "t0", at: Date.now() - 2 * 3600_000 }]),
        ),
      ledger,
    );
    await page.evaluate(() => window.__e2eChannels.forEach((channel) => channel.close()));
    const [b] = await harness.twoTabs(context);
    await keepCancels(b);
    await openLogs(b, secondOrg);
    await signOut(b);
    await b.locator('[data-test="assistant-shell-sign-out-stop"]').click();
    await atLogin(b);
    const fromB = await keptCancels(b);
    expect(fromB.some((c) => c.url.includes(`/api/${entry.org}/ai/chats/${entry.sid}/cancel`) && c.keepalive)).toBe(true);
    expect(fromB.some((c) => c.url.includes("stale-sid"))).toBe(false);
  });

  test("SHELL-10 floating never covers the panel it explains; a left-column panel still opens floating", { tag: ["@mock", "@stack-ee"] }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const assistant = new AssistantPage(page);
    const dashboardId = await harness.createTwoColumnDashboard(`SHELL-10 ${Date.now()}`);
    await page.goto(url(`/dashboards/view?dashboard=${dashboardId}&folder=default&tab=default`), {
      waitUntil: "domcontentloaded",
    });
    await ready(assistant);
    const panel = (title) =>
      page.locator(`[data-test="dashboard-panel-container"][data-test-panel-title="${title}"]`);
    const explain = async (title) => {
      await panel(title).hover();
      await harness.nextScenario(page, "complete");
      await panel(title).locator('[data-test="ai-entry-panel-explain"]').click();
      await assistant.container().first().waitFor({ state: "visible" });
    };
    const storedMode = () =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((k) => k.startsWith("o2.assistant.sidebar:"))
          .map((k) => JSON.parse(localStorage.getItem(k) || "{}").mode ?? null),
      );
    const host = assistant.sidebarHost();
    await explain("Right panel");
    await expect(host).toHaveAttribute("data-mode", "pinned");
    await expect(panel("Right panel")).toHaveAttribute("data-assistant-source", "");
    await expect(panel("Right panel")).toHaveClass(/ring-2/);
    // The ring is drawn, not only named: the panel's own box shadow carries it.
    expect(await panel("Right panel").evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
    expect((await storedMode()).filter(Boolean)).toEqual([]);
    await assistant.close();
    await expect(panel("Right panel")).not.toHaveAttribute("data-assistant-source", "");
    await explain("Left panel");
    await expect(host).toHaveAttribute("data-mode", "floating");
    await expect(panel("Left panel")).not.toHaveAttribute("data-assistant-source", "");
  });
});
