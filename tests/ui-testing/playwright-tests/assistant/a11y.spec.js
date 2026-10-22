// Copyright 2026 OpenObserve Inc.
// The accessibility matrix with the flag on: axe on every state, announcements, motion, forced colours, targets, names and focus.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test, expect } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");
const loadA11y = () => import("./harness/a11y.mjs");

const VIEWPORTS = { 1280: { width: 1280, height: 800 }, 768: { width: 768, height: 1024 }, 375: { width: 375, height: 812 } };
const THEMES = ["light", "dark"];
const SETTINGS_TABS = ["status", "access", "data", "history", "usage", "toolsets", "permissions", "activity"];
const GOLDEN = JSON.parse(readFileSync(join(__dirname, "a11y", "status-announcements.json"), "utf8"));
const MIN_TARGET_PX = 44;
const INTERACTIVE =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="switch"], [role="checkbox"], [role="option"]';

test.describe("assistant accessibility", () => {
  let assistant;
  let harness;
  let a11y;
  let state;

  const url = (path, query = "") => `${harness.ENV.appUrl}${path}?org_identifier=${harness.ENV.org}${query}`;
  const logsUrl = () => url("/logs", "&stream=e2e_automate&stream_type=logs");
  const card = () => assistant.container().locator('[data-test="assistant-approval-card"]');
  const footer = () => assistant.answer().locator('[data-test="assistant-turn-footer"]');

  async function start(context, page, { theme = "light", overrides = {} } = {}) {
    harness = await loadHarness();
    a11y = await loadA11y();
    state = harness.createMockState(overrides);
    await harness.setFlag(context, true);
    // Once per tab, so a flow that switches the theme and reloads keeps the new one.
    await context.addInitScript((value) => {
      if (sessionStorage.getItem("o2-a11y-theme-set")) return;
      localStorage.setItem("theme", value);
      sessionStorage.setItem("o2-a11y-theme-set", "1");
    }, theme);
    await a11y.recordAnnouncements(context);
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  }

  async function openOnLogs(page, via = "header") {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", /^(idle|unread)$/, { timeout: 30_000 });
    await page.mouse.move(0, 0);
    await assistant.open(via);
    await expect(assistant.composer()).toBeVisible();
  }

  // A tooltip under a resting pointer would cover the composer and enter the scan.
  async function settled(page) {
    await page.mouse.move(0, 0);
    // A focused control keeps its tooltip open, so this waits for hover tooltips only as long as they take to close.
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0, { timeout: 2_000 }).catch(() => {});
    // axe reads a fading menu's colour mid-transition, so finite animations finish first; looping ones never would.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
          .map((a) => a.finished.catch(() => {})),
      ),
    );
  }

  async function expectClean(page, flow) {
    await settled(page);
    const { blocking } = await a11y.axeScan(page, flow);
    expect.soft(blocking, `${flow}: serious or critical axe results`).toEqual([]);
  }

  async function openSettingsTab(page, tab) {
    await page.goto(url(`/settings/assistant/${tab}`), { waitUntil: "domcontentloaded" });
    await expect(assistant.settings(tab)).toBeVisible({ timeout: 30_000 });
  }

  /** Every visible interactive element inside the scope smaller than the touch minimum, by data-test. */
  function smallTargets(page, scope) {
    return page.evaluate(
      ([selector, interactive, min]) =>
        [...document.querySelectorAll(selector)]
          .flatMap((root) => [...root.querySelectorAll(interactive)])
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && !el.closest('[aria-hidden="true"]');
          })
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return Math.round(r.width) < min || Math.round(r.height) < min;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return `${el.getAttribute("data-test") ?? el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)}`;
          }),
      [scope, INTERACTIVE, MIN_TARGET_PX],
    );
  }

  /** Every sentence a region spoke since `from`, grouped by the golden's region names. */
  async function spoken(page, from) {
    const regions = Object.entries(GOLDEN.regions);
    const transient = GOLDEN.transient.map((p) => new RegExp(p));
    const out = Object.fromEntries(regions.map(([name]) => [name, []]));
    for (const { region, text } of await a11y.announcements(page, from)) {
      const name = regions.find(([, id]) => id === region)?.[0] ?? region;
      if (transient.some((re) => re.test(text))) continue;
      (out[name] ??= []).push(text);
    }
    return out;
  }

  const logLength = (page) => page.evaluate(() => window.__o2announcements.length);

  async function expectCase(page, name, from) {
    const expected = { ...Object.fromEntries(Object.keys(GOLDEN.regions).map((r) => [r, []])), ...GOLDEN.cases[name] };
    await expect.poll(() => spoken(page, from), { message: `announcements for ${name}`, timeout: 10_000 }).toEqual(expected);
  }

  for (const width of Object.keys(VIEWPORTS)) {
    for (const theme of THEMES) {
      test(`A11Y-01 axe finds nothing serious on any chat state at ${width} in ${theme}`, { tag: ["@mock"] }, async ({ context, page }) => {
        test.setTimeout(180_000);
        await page.setViewportSize(VIEWPORTS[width]);
        await start(context, page, { theme });
        const name = (s) => `chat-${s}-${width}-${theme}`;
        await openOnLogs(page);
        await expectClean(page, name("welcome"));

        await assistant.send("why 5xx?", "slow");
        await expect(assistant.status()).toBeVisible({ timeout: 15_000 });
        await expectClean(page, name("streaming"));
        await assistant.stop();
        await expect(assistant.outcome()).toHaveAttribute("data-kind", "stopped", { timeout: 15_000 });
        await expectClean(page, name("stopped"));

        await assistant.send("why 5xx?", "complete");
        await expect(footer()).toBeVisible({ timeout: 20_000 });
        await expectClean(page, name("done"));

        await assistant.send("why 5xx?", "error");
        await expect(assistant.outcome()).toHaveAttribute("data-kind", /failed/, { timeout: 15_000 });
        await expectClean(page, name("failed"));

        await assistant.send("delete stale alerts", "confirmation");
        await expect(card()).toBeVisible({ timeout: 15_000 });
        await expectClean(page, name("approval"));
        await card().locator('[data-test="assistant-approval-deny"]').click();
        await expect(card()).toBeHidden({ timeout: 15_000 });

        await assistant.send("why 5xx?", "turn_limit");
        await expect(assistant.outcome()).toBeVisible({ timeout: 15_000 });
        await expectClean(page, name("refused"));

        await assistant.send("why 5xx?", "consent");
        await expect(assistant.consentCard()).toBeVisible({ timeout: 15_000 });
        await expectClean(page, name("consent"));
        await assistant.consentCard().locator('[data-test="assistant-consent-card-cancel"]').click();

        await assistant.openHistory();
        await expectClean(page, name("history"));
      });
    }
  }

  for (const width of Object.keys(VIEWPORTS)) {
    for (const theme of THEMES) {
      test(`A11Y-01 axe finds nothing serious on any Settings tab at ${width} in ${theme}`, { tag: ["@mock"] }, async ({ context, page }) => {
        test.setTimeout(180_000);
        await page.setViewportSize(VIEWPORTS[width]);
        await start(context, page, { theme });
        for (const tab of SETTINGS_TABS) {
          await openSettingsTab(page, tab);
          await page.waitForLoadState("networkidle").catch(() => {});
          await expectClean(page, `settings-${tab}-${width}-${theme}`);
        }
      });
    }
  }

  for (const theme of THEMES) {
    test(`A11Y-01 the full view is clean at 1280, 768 and 375 in ${theme}`, { tag: ["@mock"] }, async ({ context, page }) => {
      test.setTimeout(120_000);
      await start(context, page, { theme });
      await openOnLogs(page);
      await assistant.send("why 5xx?", "complete");
      await expect(footer()).toBeVisible({ timeout: 20_000 });
      await assistant.sidebar.locator('[data-test="assistant-shell-open-in-full-view"]').click();
      await expect(assistant.full).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), `the page is in ${theme}`).toBe(theme === "dark");
      for (const width of Object.keys(VIEWPORTS)) {
        await page.setViewportSize(VIEWPORTS[width]);
        await expect(assistant.full).toBeVisible({ timeout: 15_000 });
        await expectClean(page, `full-view-${width}-${theme}`);
      }
    });
  }

  test("A11Y-02 every live region speaks the golden sentences once, in its own region", { tag: ["@mock"] }, async ({ context, page }) => {
    test.setTimeout(120_000);
    await start(context, page);
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await expectCase(page, "load", 0);

    let from = await logLength(page);
    await page.mouse.move(0, 0);
    await assistant.open("chord");
    await expectCase(page, "open", from);

    const step = async (name, act, until) => {
      await settled(page);
      from = await logLength(page);
      await act();
      await until();
      await expectCase(page, name, from);
    };
    await step("done", () => assistant.send("why 5xx?", "complete"), () => expect(footer()).toBeVisible({ timeout: 20_000 }));
    await step(
      "failed",
      () => assistant.send("why 5xx?", "error"),
      () => expect(assistant.outcome()).toHaveAttribute("data-kind", /failed/, { timeout: 15_000 }),
    );
    await step(
      "stopped",
      async () => {
        await assistant.send("why 5xx?", "slow");
        await expect(assistant.status()).toBeVisible({ timeout: 15_000 });
        await assistant.stop();
      },
      () => expect(assistant.outcome()).toHaveAttribute("data-kind", "stopped", { timeout: 15_000 }),
    );
    await step("refused", () => assistant.send("why 5xx?", "turn_limit"), () => expect(assistant.outcome()).toBeVisible({ timeout: 15_000 }));
    await step("approval", () => assistant.send("delete stale alerts", "confirmation"), () => expect(card()).toBeVisible({ timeout: 15_000 }));
    await card().locator('[data-test="assistant-approval-deny"]').click();
    await expect(card()).toBeHidden({ timeout: 15_000 });
    await expect(assistant.status()).toHaveCount(0, { timeout: 15_000 });
    await step("consent", () => assistant.send("why 5xx?", "consent"), () => expect(assistant.consentCard()).toBeVisible({ timeout: 15_000 }));
    await step(
      "consent-cancelled",
      () => assistant.consentCard().locator('[data-test="assistant-consent-card-cancel"]').click(),
      () => expect(assistant.consentCard()).toBeHidden({ timeout: 15_000 }),
    );
    await step("closed", () => assistant.composer().press("Escape"), () => expect(assistant.sidebar).toBeHidden());
  });

  test("A11Y-02 the recorder logs a sentence a region speaks again after it was cleared", { tag: ["@mock"] }, async ({ context, page }) => {
    a11y = await loadA11y();
    await a11y.recordAnnouncements(context);
    // A navigation, not setContent, so the recorder's init script watches the probe document.
    await page.route("http://a11y.probe/", (route) => route.fulfill({ contentType: "text/html", body: '<div role="status" data-test="probe-region"></div>' }));
    await page.goto("http://a11y.probe/");
    const say = (text) => page.locator('[data-test="probe-region"]').evaluate((el, t) => (el.textContent = t), text);
    for (const text of ["Done", "", "Done", "Done"]) {
      await say(text);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    }
    expect(await a11y.announcements(page)).toEqual([
      { region: "probe-region", text: "Done" },
      { region: "probe-region", text: "Done" },
    ]);
  });

  test("A11Y-02 double-read: with the sidebar visible the header region says nothing and no sentence is spoken twice", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    const from = await logLength(page);
    await page.mouse.move(0, 0);
    await assistant.open("header");
    await expect(assistant.composer()).toBeVisible();
    await assistant.send("why 5xx?", "complete");
    await expect(footer()).toBeVisible({ timeout: 20_000 });
    await expectCase(page, "double-read", from);
    const all = await a11y.announcements(page, from);
    const speakers = new Map();
    for (const { region, text } of all) speakers.set(text, new Set([...(speakers.get(text) ?? []), region]));
    expect([...speakers].filter(([, regions]) => regions.size > 1).map(([text]) => text)).toEqual([]);
  });

  test("A11Y-04 reduced motion: no animation on the root and no smooth scroll while opening, streaming and in the sheet", { tag: ["@mock", "@responsive"] }, async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => {
      const smooth = (window.__o2smooth = []);
      const watch = (proto, name) => {
        const original = proto[name];
        proto[name] = function (...args) {
          const opts = args[0];
          if (opts && typeof opts === "object" && opts.behavior === "smooth" && this.closest?.("[data-assistant-root]")) smooth.push(name);
          return original.apply(this, args);
        };
      };
      watch(Element.prototype, "scrollTo");
      watch(Element.prototype, "scrollBy");
      watch(Element.prototype, "scrollIntoView");
    });
    await start(context, page);
    // Colour, shadow and opacity fades are not motion; anything that moves, scales or resizes is.
    const FADES = /^(color|background-color|border-color|border-[a-z]+-color|outline-color|text-decoration-color|fill|stroke|box-shadow|opacity|--.*)$/;
    const animations = () =>
      page.evaluate(
        (fades) =>
          [...document.querySelectorAll("[data-assistant-root]")].flatMap((root) =>
            root
              .getAnimations({ subtree: true })
              .filter((a) => !(a.transitionProperty && new RegExp(fades).test(a.transitionProperty)))
              .map((a) => a.animationName ?? `${a.constructor.name}:${a.transitionProperty}`),
          ),
        FADES.source,
      );
    const scrollBehaviours = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("[data-assistant-root] *")]
          .filter((el) => getComputedStyle(el).scrollBehavior === "smooth")
          .map((el) => el.getAttribute("data-test") ?? el.tagName),
      );
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize(VIEWPORTS[width]);
      await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
      await expect(assistant.headerButton).toHaveAttribute("data-state", /^(idle|open|unread)$/, { timeout: 30_000 });
      await page.mouse.move(0, 0);
      if (!(await assistant.container().count())) await assistant.open("header");
      await expect(assistant.composer()).toBeVisible();
      expect(await animations(), `open at ${width}`).toEqual([]);
      await expectClean(page, `reduced-motion-open-${width}`);
      await assistant.send("why 5xx?", "slow");
      await expect(assistant.status()).toBeVisible({ timeout: 15_000 });
      const streamed = () => assistant.transcript().evaluate((el) => el.textContent.length);
      const before = await streamed();
      await expect.poll(streamed, { message: `the answer streams at ${width}`, timeout: 10_000 }).toBeGreaterThan(before);
      expect(await animations(), `streaming at ${width}`).toEqual([]);
      await expectClean(page, `reduced-motion-streaming-${width}`);
      if (width === 375) {
        await assistant.sheet.locator('[data-test="assistant-shell-sheet-peek"]').click();
        await expect(assistant.sheet).toHaveAttribute("data-snap", "peek");
        expect(await animations(), "sheet at peek").toEqual([]);
        await expectClean(page, "reduced-motion-sheet-peek-375");
      }
      await assistant.stop().catch(() => {});
      expect(await scrollBehaviours(), `scroll-behavior at ${width}`).toEqual([]);
    }
    expect(await page.evaluate(() => window.__o2smooth)).toEqual([]);
  });

  test("A11Y-05 forced colours: the four header signals differ by shape, dots and borders stay visible and axe is clean", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ forcedColors: "active" });
    await start(context, page);
    await openOnLogs(page);
    await expectClean(page, "forced-colors-sidebar");
    const light = page.locator('[data-test="assistant-header-status-light"]');
    const shots = {};
    const signal = async (name, scenario, ready, closeWhen) => {
      await settled(page);
      if (!(await assistant.sidebar.isVisible())) await assistant.open("header");
      await assistant.send("delete stale alerts", scenario);
      await ready();
      await assistant.composer().press("Escape");
      await expect(assistant.sidebar).toBeHidden();
      await closeWhen();
      await expect(light).toBeVisible({ timeout: 20_000 });
      await settled(page);
      shots[name] = {
        state: await light.getAttribute("data-state"),
        shape: await light.getAttribute("data-shape"),
        png: await assistant.headerButton.screenshot({ animations: "disabled" }),
      };
      await a11y.capture(page, `forced-colors-header-${name}`, assistant.headerButton);
      const { blocking } = await a11y.axeScan(page, `forced-colors-header-${name}`, { scope: ['[data-test="menu-link-ai-item"]'] });
      expect.soft(blocking, `header ${name}`).toEqual([]);
      const marks = await light.evaluate((el) =>
        [...el.querySelectorAll("*")]
          .filter((m) => m.getBoundingClientRect().width > 0)
          .map((m) => {
            const cs = getComputedStyle(m);
            const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.outlineWidth || "0");
            return { glyph: m.tagName.toLowerCase() === "svg", text: !!m.textContent.trim(), adjust: cs.forcedColorAdjust, border, ring: cs.boxShadow !== "none" };
          }),
      );
      // Forced colours drop backgrounds, so a mark survives only as a glyph, text, a border, a ring or an opted-out colour.
      expect(marks.some((m) => m.glyph || m.text || m.border > 0 || m.ring || m.adjust === "none"), `${name} mark is visible in forced colours`).toBe(true);
      await assistant.open("header");
    };
    await signal(
      "working",
      "slow",
      () => expect(assistant.status()).toBeVisible({ timeout: 15_000 }),
      () => expect(assistant.headerButton).toHaveAttribute("data-state", "working"),
    );
    await assistant.stop();
    await expect(assistant.outcome()).toHaveAttribute("data-kind", "stopped", { timeout: 15_000 });
    await signal(
      "needs-you",
      "confirmation",
      () => expect(card()).toBeVisible({ timeout: 15_000 }),
      () => expect(assistant.headerButton).toHaveAttribute("data-state", "needs_you", { timeout: 15_000 }),
    );
    await card().locator('[data-test="assistant-approval-deny"]').click();
    await expect(card()).toBeHidden({ timeout: 15_000 });
    await expect(assistant.status()).toHaveCount(0, { timeout: 15_000 });
    await signal(
      "failed",
      "error",
      async () => {},
      () => expect(assistant.headerButton).toHaveAttribute("data-state", "unread", { timeout: 20_000 }),
    );
    await signal(
      "unread",
      "complete",
      async () => {},
      () => expect(assistant.headerButton).toHaveAttribute("data-state", "unread", { timeout: 20_000 }),
    );
    const names = Object.keys(shots);
    expect(new Set(names.map((n) => shots[n].shape)).size, JSON.stringify(names.map((n) => [n, shots[n].state, shots[n].shape]))).toBe(4);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = PNG.sync.read(shots[names[i]].png);
        const b = PNG.sync.read(shots[names[j]].png);
        if (a.width !== b.width || a.height !== b.height) continue;
        const changed = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
        expect(changed, `${names[i]} and ${names[j]} look the same in forced colours`).toBeGreaterThan(4);
      }
    }
    await openSettingsTab(page, "status");
    await expectClean(page, "forced-colors-settings-status");
  });

  for (const width of [375, 768]) {
    test.describe(`on a touch screen at ${width}`, () => {
      test.use({ viewport: VIEWPORTS[width], hasTouch: true, isMobile: true });

      test(`A11Y-06 every assistant target is at least 44 px at ${width}`, { tag: ["@mock", "@responsive"] }, async ({ context, page }) => {
        test.setTimeout(120_000);
        await start(context, page);
        await openOnLogs(page);
        const scope = "[data-assistant-root]";
        const small = new Set(await smallTargets(page, scope));
        await assistant.send("why 5xx?", "complete");
        await expect(footer()).toBeVisible({ timeout: 20_000 });
        for (const s of await smallTargets(page, scope)) small.add(s);
        await assistant.send("delete stale alerts", "confirmation");
        await expect(card()).toBeVisible({ timeout: 15_000 });
        for (const s of await smallTargets(page, scope)) small.add(s);
        await card().locator('[data-test="assistant-approval-deny"]').click();
        for (const s of await smallTargets(page, '[data-test="menu-link-ai-item"]')) small.add(s);
        expect([...small]).toEqual([]);
      });

      if (width === 768) {
        test("A11Y-06 at 768 every row door kebab, history kebab and earlier message action opens or acts by touch", { tag: ["@mock", "@responsive"] }, async ({
          context,
          page,
        }) => {
          test.setTimeout(180_000);
          await context.grantPermissions(["clipboard-read", "clipboard-write"]);
          await start(context, page);
          await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
          await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
          const opaque = (locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).opacity) > 0.5 && getComputedStyle(el).visibility !== "hidden");
          const kebabs = page.locator('[data-test="logs-search-result-row-menu"]');
          await expect(kebabs.first()).toBeVisible({ timeout: 30_000 });
          const rows = await kebabs.count();
          for (let i = 0; i < rows; i++) {
            const kebab = kebabs.nth(i);
            expect(await opaque(kebab), `row ${i} kebab is shown without hover`).toBe(true);
            await kebab.tap();
            await expect(page.locator('[role="menu"] [data-test="ai-entry-log-row-explain"]')).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(page.locator('[role="menu"]')).toHaveCount(0);
          }

          await assistant.open("header");
          await assistant.send("why 5xx?", "complete");
          await expect(footer()).toBeVisible({ timeout: 20_000 });
          await assistant.send("and since then?", "complete");
          await expect(assistant.container().locator('[data-test="assistant-turn-footer"]')).toHaveCount(2, { timeout: 20_000 });
          const earlier = assistant.container().locator('[data-test="assistant-msg-actions"]:has([data-test="assistant-msg-copy-answer"])').first();
          expect(await opaque(earlier), "an earlier turn's message actions are shown without hover").toBe(true);
          const copy = earlier.locator('[data-test="assistant-msg-copy-answer"]');
          await copy.tap();
          await expect(copy, "the earlier answer's copy action acts on a tap").toHaveAttribute("aria-label", /copied/i);

          await assistant.openHistory();
          const kebab = assistant.history().locator('[data-test="assistant-history-row-menu"]').first();
          expect(await opaque(kebab), "the history row kebab is shown without hover").toBe(true);
          await kebab.tap();
          await expect(page.locator('[role="menu"]').filter({ visible: true }).first()).toBeVisible();
        });
      }
    });
  }

  test("A11Y-06 a fine pointer at 1280 still hides hover-only controls until hover or focus", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page);
    await openOnLogs(page);
    await assistant.send("why 5xx?", "complete");
    await expect(footer()).toBeVisible({ timeout: 20_000 });
    await assistant.send("and since then?", "complete");
    await expect(assistant.container().locator('[data-test="assistant-turn-footer"]')).toHaveCount(2, { timeout: 20_000 });
    await settled(page);
    const earlier = assistant.container().locator('[data-test="assistant-msg-actions"]').first();
    expect(await earlier.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  });

  test("A11Y-07 no positive tabindex and every button has a name", { tag: ["@mock"] }, async ({ context, page }) => {
    test.setTimeout(120_000);
    await start(context, page);
    const scan = () =>
      page.evaluate(() => {
        const roots = [...document.querySelectorAll('[data-assistant-root], [data-test="menu-link-ai-item"], [data-test^="settings-assistant-panel-"], [role="menu"], [role="dialog"]')];
        const all = roots.flatMap((r) => [r, ...r.querySelectorAll("*")]);
        const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
        const name = (el) =>
          (el.getAttribute("aria-labelledby") ?? "")
            .split(/\s+/)
            .map((id) => text(document.getElementById(id)))
            .join(" ")
            .trim() ||
          (el.getAttribute("aria-label") ?? "").trim() ||
          text(el) ||
          (el.getAttribute("title") ?? "").trim() ||
          [...el.querySelectorAll("img[alt]")].map((i) => i.alt).join(" ").trim();
        return {
          positive: all.filter((el) => el.tabIndex > 0 && el.hasAttribute("tabindex")).map((el) => el.getAttribute("data-test") ?? el.tagName),
          nameless: all.filter((el) => el.matches('button, [role="button"]') && !name(el)).map((el) => el.getAttribute("data-test") ?? el.outerHTML.slice(0, 80)),
        };
      });
    const found = { positive: new Set(), nameless: new Set() };
    const collect = async () => {
      const { positive, nameless } = await scan();
      positive.forEach((p) => found.positive.add(p));
      nameless.forEach((n) => found.nameless.add(n));
    };
    await openOnLogs(page);
    await collect();
    await assistant.send("why 5xx?", "complete");
    await expect(footer()).toBeVisible({ timeout: 20_000 });
    await collect();
    await assistant.send("delete stale alerts", "confirmation");
    await expect(card()).toBeVisible({ timeout: 15_000 });
    await collect();
    await card().locator('[data-test="assistant-approval-deny"]').click();
    await assistant.openHistory();
    await collect();
    for (const tab of SETTINGS_TABS) {
      await openSettingsTab(page, tab);
      await collect();
    }
    expect([...found.positive]).toEqual([]);
    expect([...found.nameless]).toEqual([]);
  });

  test("A11Y-08 again in dark: a docked editor's approval keeps focus in the buffer, Ctrl+I reaches Deny and the dock is clean", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    test.setTimeout(90_000);
    await start(context, page, { theme: "dark" });
    await page.goto(url("/alerts/add"), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", /idle|open/, { timeout: 30_000 });
    await page.locator('[data-test="query-mode-sql"]').click();
    await page.locator('[data-test="step2-view-editor-btn"]').click();
    const dialog = page.locator('[data-test="query-editor-dialog"]');
    await expect(dialog).toBeVisible();
    await assistant.dockToggle("alert-query").click();
    const dock = assistant.dock("alert_query");
    await expect(dock).toBeVisible();
    await harness.nextScenario(page, "permission_card");
    await dock.locator('[data-test="assistant-composer-field"]').fill("list the pods");
    await page.keyboard.press("Enter");
    const buffer = dialog.locator(".monaco-editor").first();
    await buffer.click();
    await page.keyboard.type("SELECT ");
    const pending = dock.locator('[data-test="assistant-approval-card"]');
    await expect(pending).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => !!document.activeElement?.closest(".monaco-editor"))).toBe(true);
    await expect(dock.locator('[data-test="assistant-status-region"]')).toContainText(/Press Control I to review it\.$/);
    await settled(page);
    const { blocking } = await a11y.axeScan(page, "docked-approval-1280-dark", { scope: ['[data-test="assistant-shell-docked"]'] });
    expect.soft(blocking).toEqual([]);
    await buffer.click();
    await page.keyboard.press("ControlOrMeta+i");
    await expect(pending.locator('[data-test="assistant-approval-deny"]')).toBeFocused();
  });

  /** Tabs through the page and returns every focused page control whose rect meets `cover`'s rect. */
  async function obscuredWhileTabbing(page, cover, presses = 40) {
    const hits = [];
    for (let i = 0; i < presses; i++) {
      const hit = await page.evaluate((selector) => {
        const el = document.activeElement;
        const over = document.querySelector(selector);
        if (!el || !over || el.closest("[data-assistant-root]") || el.closest(selector)) return null;
        const a = el.getBoundingClientRect();
        const b = over.getBoundingClientRect();
        if (a.height === 0 || b.height === 0) return null;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom - 1) - Math.max(a.top, b.top + 1);
        if (w <= 0 || h <= 0) return null;
        const covered = Math.round(((w * h) / (a.width * a.height)) * 100);
        return `${el.getAttribute("data-test") ?? el.tagName} ${covered}% covered`;
      }, cover);
      if (hit) hits.push(hit);
      await page.keyboard.press("Tab");
    }
    return hits;
  }

  test("A11Y-09 again at 375 with the sheet at peek: no page control Tab reaches lies under it", { tag: ["@mock", "@responsive"] }, async ({
    context,
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS[375]);
    await start(context, page);
    await openOnLogs(page);
    await assistant.sheet.locator('[data-test="assistant-shell-sheet-peek"]').click();
    await expect(assistant.sheet).toHaveAttribute("data-snap", "peek");
    await page.locator('[data-test="main-content"]').evaluate((el) => el.querySelector("button, a[href], input, [tabindex='0']")?.focus());
    expect(await obscuredWhileTabbing(page, '[data-test="assistant-shell-sheet"]')).toEqual([]);
  });

  test("A11Y-09 again at 1280: the floating sidebar never covers a focused dashboard control", { tag: ["@mock"] }, async ({ context, page }) => {
    test.setTimeout(120_000);
    await start(context, page);
    const id = await harness.createTwoColumnDashboard(`a11y floating ${Date.now()}`);
    try {
      await page.goto(url("/dashboards/view", `&dashboard=${id}&folder=default`), { waitUntil: "domcontentloaded" });
      await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
      await settled(page);
      await assistant.open("header");
      await assistant.container().locator('[data-test="assistant-thread-menu"]').click();
      await page.locator('[data-test="assistant-shell-mode-floating"]').click();
      const host = page.locator('[data-test="assistant-sidebar-host"]');
      await expect(host).toHaveAttribute("data-mode", "floating");
      await page.locator('[data-test="main-content"]').evaluate((el) => el.querySelector("button, a[href], input, [tabindex='0']")?.focus());
      const hits = await obscuredWhileTabbing(page, '[data-test="assistant-sidebar-host"][data-mode="floating"]', 60);
      expect(hits).toEqual([]);
    } finally {
      await harness.deleteDashboard(id);
    }
  });
});
