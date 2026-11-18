// Copyright 2026 OpenObserve Inc.
// Shell flows with the flag on (SHELL-01, 02, 08, 12, the full view and A11Y-09); WP-05 adds the composer halves.

import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";
import { BRAND } from "../../utils/brand.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant shell", () => {
  let assistant;
  let harness;

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;

  async function gotoLogs(page) {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", {
      timeout: 30_000,
    });
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.installMocks(context, harness.createMockState());
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test(
    "SHELL-01 the chord opens the sidebar, focuses it and never closes it",
    { tag: ["@mock", "@stack-ee", "@responsive"] },
    async ({ page }) => {
      await gotoLogs(page);
      await assistant.blurPage();
      await assistant.open("chord");
      await expect(page).toHaveURL(/\/logs\?/);
      await expect(assistant.sidebar).toBeVisible();
      const focusedInside = () =>
        page.evaluate(
          () => !!document.activeElement?.closest("[data-assistant-root]"),
        );
      await expect.poll(focusedInside).toBe(true);
      await expect(assistant.composer()).toBeFocused();
      await page.keyboard.press("Control+i");
      await expect(assistant.sidebar).toBeVisible();
      const events = await harness.captureTelemetry(page);
      expect(
        events
          .filter((e) => e.name === "ai_shortcut")
          .map((e) => e.properties.effect),
      ).toEqual(expect.arrayContaining(["open"]));
    },
  );

  test(
    "SHELL-01 the chord works the moment the header reports idle, before the async host loads",
    { tag: ["@mock", "@stack-ee"] },
    async ({ page }) => {
      await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
      await expect(assistant.headerButton).toHaveAttribute(
        "data-state",
        "idle",
        { timeout: 30_000 },
      );
      await page.keyboard.press("Control+i");
      await expect(assistant.sidebar).toBeVisible();
      await expect(assistant.composer()).toBeFocused();
      await expect(
        assistant.sidebar.locator('[data-test="assistant-status-region"]'),
      ).toHaveText("O2 Assistant opened.");
    },
  );

  test(
    "SHELL-02 row-door variant: Escape hands focus back to the cell whose toolbar holds the door",
    { tag: ["@mock", "@responsive"] },
    async ({ page }) => {
      await page.goto(`${logsUrl()}&period=1d`, {
        waitUntil: "domcontentloaded",
      });
      await expect(assistant.headerButton).toHaveAttribute(
        "data-state",
        "idle",
        { timeout: 30_000 },
      );
      const cell = await assistant.logRowCell();
      await cell.focus();
      const toolbar = page.locator(".o2-table-cell-hover-actions");
      await expect(toolbar).toBeVisible();
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press("Tab");
        if (
          (await page.evaluate(() =>
            document.activeElement?.getAttribute("data-test"),
          )) === "logs-search-result-ai-btn"
        )
          break;
      }
      await page.keyboard.press("Enter");
      await expect(assistant.sidebar).toBeVisible();
      await assistant.composer().focus();
      await page.keyboard.press("Escape");
      await expect(assistant.sidebar).toBeHidden();
      await expect(cell).toBeFocused();
    },
  );

  test(
    "SHELL-02 Escape closes the menu first, then the container, and focus returns to the button",
    { tag: ["@mock", "@responsive"] },
    async ({ page }) => {
      await gotoLogs(page);
      await assistant.open("header");
      await expect(assistant.headerButton).toHaveAttribute(
        "data-state",
        "open",
      );
      await expect(assistant.headerButton).toHaveAttribute(
        "aria-label",
        "Close O2 Assistant",
      );
      // The header button's tooltip stays open under a resting pointer and covers the thread header.
      await page.mouse.move(0, 0);
      await assistant.sidebar
        .locator('[data-test="assistant-thread-title-button"]')
        .click();
      const menu = page.locator('[role="menu"]');
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(assistant.sidebar).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(assistant.sidebar).toBeHidden();
      await expect(assistant.headerButton).toBeFocused();
      await expect(
        page.locator('[data-test="assistant-container-status"]'),
      ).toHaveText("O2 Assistant closed.");
      await expect(assistant.headerButton).toHaveAttribute(
        "data-state",
        "idle",
      );
    },
  );

  test(
    "the empty sidebar shows the starters under the chrome",
    { tag: ["@mock"] },
    async ({ page }) => {
      await gotoLogs(page);
      await assistant.open("header");
      await expect(assistant.welcome).toHaveAttribute(
        "data-test",
        "assistant-welcome",
      );
      await expect(assistant.welcome).toHaveAttribute(
        "data-variant",
        "compact",
      );
      await expect(
        assistant.sidebar.locator('[data-test="assistant-thread-logo"]'),
      ).toHaveCount(0);
      await expect(assistant.sidebar).toHaveAttribute(
        "aria-label",
        BRAND.autobot,
      );
      await expect(
        assistant.sidebar.locator('[data-test="assistant-shell-close"]'),
      ).toHaveAttribute("aria-label", "Close O2 Assistant");
      const aiRequests = await page.evaluate(
        () => window.__o2mock.requests.length,
      );
      expect(aiRequests).toBe(0);
    },
  );

  test(
    "Full page opens Home's AI tab in a new tab, whose bar lists Full page, Side and Floating in that order",
    { tag: ["@mock"] },
    async ({ page }) => {
      await gotoLogs(page);
      await assistant.open("header");
      const tab = await assistant.placeFullInNewTab();
      // This page stays where it was; the new tab is Home's AI tab at Full density.
      await expect(page).toHaveURL(/\/logs\?/);
      await expect(tab.page).toHaveURL(/[?&]tab=ai&thread=/);
      await expect(tab.full).toBeVisible({ timeout: 30_000 });
      await expect(
        tab.page.locator('[data-test="assistant-welcome"][data-variant="roomy"]'),
      ).toBeVisible();
      await expect(tab.page).toHaveTitle("OpenObserve - Home");
      const landmarks = tab.page.locator(
        `aside[aria-label="${BRAND.autobot}"], [role="region"][aria-label="${BRAND.autobot}"]`,
      );
      await expect(landmarks.filter({ visible: true })).toHaveCount(1);
      await expect(tab.headerButton).toHaveAttribute("data-state", "open");
      const places = await tab.full
        .locator('[data-test^="assistant-shell-place-"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-test")));
      expect(places).toEqual([
        "assistant-shell-place-full",
        "assistant-shell-place-sidebar",
        "assistant-shell-place-window",
      ]);
    },
  );

  test(
    "SHELL-08 below lg the sidebar is a non-modal snap sheet that insets the page",
    { tag: ["@mock", "@responsive"] },
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await gotoLogs(page);
      await assistant.open("header");
      const sheet = assistant.sheet;
      await expect(sheet).toHaveAttribute("role", "dialog");
      await expect(sheet).toHaveAttribute("aria-modal", "false");
      await expect(sheet).toHaveAttribute("aria-label", BRAND.autobot);
      // At 812 px a half sheet leaves the transcript under 240 px, so it opens full.
      await expect(sheet).toHaveAttribute("data-snap", "full");
      const focusedInside = () =>
        page.evaluate(
          () => !!document.activeElement?.closest("[data-assistant-root]"),
        );
      await expect.poll(focusedInside).toBe(true);
      await expect(assistant.composer()).toBeFocused();
      await expect(
        sheet.locator('[data-test="assistant-status-region"]'),
      ).toHaveText("O2 Assistant opened.");
      const handle = sheet.locator(
        '[data-test="assistant-shell-sheet-handle"]',
      );
      await handle.focus();
      await page.keyboard.press("ArrowDown");
      await expect(sheet).toHaveAttribute("data-snap", "half");
      await page.keyboard.press("ArrowDown");
      await expect(sheet).toHaveAttribute("data-snap", "peek");
      await expect(
        sheet.locator('[data-test="assistant-shell-sheet-peek-row"]'),
      ).toContainText("New chat");
      await sheet
        .locator('[data-test="assistant-shell-sheet-peek-row"]')
        .click();
      await expect(sheet).toHaveAttribute("data-snap", "half");
      await handle.click();
      await expect(sheet).toHaveAttribute("data-snap", "full");
      await handle.click();
      await expect(sheet).toHaveAttribute("data-snap", "half");
      const inset = await page.evaluate(() =>
        Number(
          document.documentElement.style.getPropertyValue(
            "--o-assistant-inset-bottom",
          ),
        ),
      );
      expect(inset).toBeGreaterThan(300);
      const padding = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".o2-content-scroll"))
            .paddingBottom,
      );
      expect(parseFloat(padding)).toBeGreaterThan(300);
      await expect(
        page.locator('[data-test="assistant-container-status"]'),
      ).toHaveText("Collapsed.");
    },
  );

  test(
    "A11Y-09 no page control Tab reaches lies under the sheet",
    { tag: ["@mock", "@responsive"] },
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await gotoLogs(page);
      await assistant.open("header");
      // The sheet opens full at 812 px; the page is only reachable beside a half sheet.
      await expect(assistant.sheet).toHaveAttribute("data-snap", "full");
      await assistant.sheet
        .locator('[data-test="assistant-shell-sheet-handle"]')
        .focus();
      await page.keyboard.press("ArrowDown");
      await expect(assistant.sheet).toHaveAttribute("data-snap", "half");
      // The sheet slides to its new snap, so its top is read once it reaches half.
      await expect
        .poll(() => assistant.sheet.evaluate((el) => el.getBoundingClientRect().top))
        .toBeGreaterThanOrEqual(812 / 2 - 1);
      const sheetTop = await assistant.sheet.evaluate(
        (el) => el.getBoundingClientRect().top,
      );
      await page.locator('[data-test="main-content"]').evaluate((el) => {
        const first = el.querySelector(
          "button, a[href], input, [tabindex='0']",
        );
        first?.focus();
      });
      const obscured = [];
      for (let i = 0; i < 40; i++) {
        const hit = await page.evaluate((top) => {
          const el = document.activeElement;
          if (
            !el ||
            el.closest("[data-assistant-root]") ||
            !el.closest('[data-test="main-content"]')
          )
            return null;
          const rect = el.getBoundingClientRect();
          if (rect.height === 0) return null;
          return rect.bottom > top + 1
            ? (el.getAttribute("data-test") ?? el.tagName)
            : null;
        }, sheetTop);
        if (hit) obscured.push(hit);
        await page.keyboard.press("Tab");
      }
      expect(obscured).toEqual([]);
      const contentBottom = await page
        .locator(".o2-content-scroll")
        .evaluate(
          (el) =>
            el.getBoundingClientRect().bottom -
            parseFloat(getComputedStyle(el).paddingBottom),
        );
      expect(contentBottom).toBeLessThanOrEqual(sheetTop + 1);
    },
  );

  test(
    "SHELL-12 Escape in the composer closes and never stops a running turn; an IME Escape does nothing",
    { tag: ["@mock", "@responsive"] },
    async ({ page }) => {
      await gotoLogs(page);
      await assistant.open("header");
      await assistant.send("keep going", "slow");
      await expect(
        assistant.container().locator('[data-test="assistant-stop"]'),
      ).toBeVisible();
      await assistant
        .composer()
        .dispatchEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
        });
      await expect(assistant.sidebar).toBeVisible();
      await assistant.composer().press("Escape");
      await expect(assistant.sidebar).toBeHidden();
      await expect(
        page.locator('[data-test="assistant-container-status"]'),
      ).toHaveText("O2 Assistant closed. Still answering in the background.");
      await expect(assistant.headerButton).toHaveAttribute(
        "data-state",
        "working",
      );
      expect(
        await page.evaluate(() => (window.__o2mock.cancels || []).length),
      ).toBe(0);
    },
  );
});
