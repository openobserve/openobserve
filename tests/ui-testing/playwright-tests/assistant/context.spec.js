// Copyright 2026 OpenObserve Inc.
// WP-05 composer and context tray flows with the flag on (CTX-01..05, SEC-11, ERR-14; `99` §6.8).

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");
const loadPayloads = () => import("./harness/fixtures/payloads.mjs");

// One 1×1 PNG; its bytes go through the real FileReader path.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test.describe("assistant composer and context", () => {
  let assistant;
  let harness;

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;

  async function openOnLogs(page) {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await assistant.open("header");
    await expect(assistant.composer()).toBeVisible();
  }

  // Pastes `count` PNGs into the composer the way a clipboard does.
  async function pasteImages(page, count) {
    await page.evaluate(
      ({ count, base64 }) => {
        const box = document.querySelector('[data-assistant-root] [data-test="assistant-composer-field"]');
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        for (let i = 0; i < count; i++) {
          const data = new DataTransfer();
          data.items.add(new File([bytes], "image.png", { type: "image/png" }));
          box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        }
      },
      { count, base64: PNG_BASE64 },
    );
  }

  // Mentions the first stream through the @ menu, the composer's own way to add context.
  async function mentionStream(page) {
    const box = assistant.composer();
    await box.click();
    await box.pressSequentially("@e2e");
    const option = page.locator('[data-test="assistant-mention-option"][data-kind="stream"]').first();
    await expect(option).toBeVisible();
    await box.press("ArrowDown");
    await page.keyboard.press("Enter").catch(() => undefined);
  }

  // Stages chips straight into the store; only the Vite dev server serves the module (`@edition`).
  async function stageChips(page, chips) {
    await page.evaluate(async (list) => {
      const m = await import("/web/src/composables/assistant/index.ts");
      const store = m.assistantStore;
      const sid = store.state.shell.activeSid;
      for (const chip of list) store.addChip(sid, chip);
    }, chips);
  }

  const requests = (page) => page.evaluate(() => window.__o2mock.requests.map((r) => JSON.parse(r.body)));

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    await harness.installMocks(context, harness.createMockState());
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("CTX-01 the time chip is first and the popover tells sent from not read", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    const first = assistant.chips().first();
    await expect(first).toHaveAttribute("data-test", "assistant-context-chip-time");
    await expect(first).toContainText("Time ·");
    await expect(assistant.chips().nth(1)).toContainText("Stream · e2e_automate");
    await assistant.tray().locator('[data-test="assistant-context-sees"]').click();
    const popover = page.locator('[data-test="assistant-context-sees-popover"]');
    await expect(popover).toBeVisible();
    const sent = popover.locator('[data-test="assistant-context-sees-sent"]');
    for (const label of ["Organization", "Page", "Time range", "Streams", "Timezone"])
      await expect(sent).toContainText(label);
    await expect(popover.locator('[data-test="assistant-context-sees-not_read"]')).toContainText("Quick mode");
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(assistant.tray().locator('[data-test="assistant-context-sees"]')).toBeFocused();
  });

  test("CTX-01 Tab past a chip popover's last control moves on and stays there; the time range opens by keyboard", { tag: ["@mock"] }, async ({
    page,
  }) => {
    await openOnLogs(page);
    const stream = assistant.chips().nth(1).locator('[data-test="assistant-context-chip-button"]');
    await stream.click();
    const popover = page.locator('[data-test="assistant-chip-popover"]');
    await expect(popover).toBeVisible();
    const inPopover = () => page.evaluate(() => !!document.activeElement?.closest("[data-o-popover-content]"));
    for (let i = 0; i < 8 && (await inPopover()); i += 1) await page.keyboard.press("Tab");
    await expect(popover).toBeHidden();
    // The exit animation runs after Tab moved focus on; the popover must not pull it back to the chip.
    await page.waitForTimeout(400);
    await expect(assistant.chips().nth(1).locator('[data-test="assistant-context-chip-remove"]')).toBeFocused();
    // The pointer still rests on the stream chip, whose hover tooltip would cover the time chip until it leaves.
    await page.mouse.move(0, 0);

    await assistant.chips().first().locator('[data-test="assistant-context-chip-button"]').click();
    const trigger = page.locator('[data-test="assistant-context-time-picker"] [data-test="datetimerange-trigger"]');
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-test="datetimerange-popup"]')).toBeVisible();
  });

  test("CTX-02 a refused turn gives back the text, the chips and the images", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await mentionStream(page);
    await expect(assistant.chips()).toHaveCount(3);
    await pasteImages(page, 1);
    await expect(page.locator('[data-test="assistant-image-strip"] li').filter({ visible: true })).toHaveCount(1);
    await assistant.composer().fill("why is it slow?");
    await page.evaluate(() => (window.__o2mock.next = "turn_limit"));
    await assistant.composer().press("Enter");
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    await expect(assistant.composer()).toHaveValue("why is it slow?");
    await expect(assistant.chips()).toHaveCount(3);
    await expect(page.locator('[data-test="assistant-image-strip"] li').filter({ visible: true })).toHaveCount(1);
  });

  test("CTX-03 an IME Enter never sends; the Enter after composition sends once", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    const box = assistant.composer();
    await box.click();
    await page.keyboard.insertText("にほん");
    await box.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
    await box.dispatchEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true });
    await page.waitForTimeout(300);
    expect(await requests(page)).toHaveLength(0);
    await box.press("Enter");
    await box.press("Enter");
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    await page.waitForTimeout(500);
    expect(await requests(page)).toHaveLength(1);
    expect((await requests(page))[0].messages.at(-1).content).toBe("にほん");
  });

  test("CTX-04 a draft survives a reload in its tab and a second tab starts empty", { tag: ["@mock"] }, async ({ page, context }) => {
    await openOnLogs(page);
    await assistant.composer().fill("half a thought");
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(assistant.composer()).toHaveValue("half a thought", { timeout: 30_000 });
    await expect(assistant.container().locator('[data-test="assistant-composer-status"]')).toHaveText("Draft restored");
    const second = await context.newPage();
    const other = new AssistantPage(second);
    await second.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await other.open("header");
    await expect(other.composer()).toHaveValue("");
    await second.close();
  });

  test("CTX-05 caps are stated where the control is; attached data stays under 32 KB", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await pasteImages(page, 6);
    await expect(page.locator('[data-test="assistant-image-strip"] li').filter({ visible: true })).toHaveCount(4);
    await expect(assistant.tray().locator('[data-test="assistant-context-cap"]')).toHaveText(
      "Up to 4 images, 2 MB each",
    );
    await expect(page.locator('[data-test="o2-toast"], [role="alert"]').filter({ hasText: "images" })).toHaveCount(0);
  });

  test("CTX-05 the store refuses rows past 32 KB, and a multi-row chip is cut on the wire @edition", { tag: ["@mock"] }, async ({
    page,
  }) => {
    test.skip(!harness.ENV.viteDev, "stages rows through the dev server's module graph");
    await openOnLogs(page);
    // Honest sizes: the store's 32 KB cap refuses the rows that do not fit.
    const results = await page.evaluate(async () => {
      const m = await import("/web/src/composables/assistant/index.ts");
      const store = m.assistantStore;
      const sid = store.state.shell.activeSid;
      return Array.from({ length: 12 }, (_, i) => {
        const data = { message: "x".repeat(4 * 1024), i };
        return store.addChip(sid, {
          id: `row-${i}`,
          kind: "log_row",
          label: `Log row ${i}`,
          data,
          sizeBytes: m.byteSize(data),
          provenance: "door",
          sent: "serialized",
        });
      });
    });
    expect(results.filter((r) => r.ok).length).toBeLessThan(12);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, cap: "bytes" });
    await page.evaluate(async () => {
      const m = await import("/web/src/composables/assistant/index.ts");
      const store = m.assistantStore;
      const sid = store.state.shell.activeSid;
      store.setDraft(sid, { chips: [] });
      // A 30-row legacy relay stays one array chip, cut to fit before it is staged.
      const rows = Array.from({ length: 30 }, (_, i) => ({ i, message: "y".repeat(2 * 1024), _o2_id: `${i}` }));
      for (const chip of m.legacyPayloadToChips(JSON.stringify(rows)).chips) store.addChip(sid, chip);
    });
    await assistant.send("summarise these");
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    const text = (await requests(page))[0].messages.at(-1).content;
    const body = /--- Log row[^\n]*\n(.*)\n--- end/.exec(text)[1];
    const rows = JSON.parse(body);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(20);
    expect(rows.every((row) => !("_o2_id" in row))).toBe(true);
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(32 * 1024);
  });

  test("SEC-11 attached data cannot close its block @edition", { tag: ["@mock"] }, async ({ page }) => {
    test.skip(!harness.ENV.viteDev, "stages the planted chips through the dev server's module graph");
    const planted = (await loadPayloads()).PAYLOADS.delimiter_breakout;
    await openOnLogs(page);
    await stageChips(page, [
      { id: "cell", kind: "cell", label: "message = boom", data: planted.cell, sizeBytes: 80, provenance: "door", sent: "serialized" },
      { id: "err", kind: "query_error", label: "Query error · default", data: planted.query_error, sizeBytes: 80, provenance: "door", sent: "serialized" },
      { id: "span", kind: "span", label: "Span · GET /api/cart", data: planted.span, sizeBytes: 80, provenance: "door", sent: "serialized" },
    ]);
    await assistant.send("check these");
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    const text = (await requests(page))[0].messages.at(-1).content;
    const lines = text.split("\n");
    expect(lines.filter((line) => line === "--- end ---")).toHaveLength(0);
    expect(lines.filter((line) => line.startsWith("Ignore previous"))).toHaveLength(0);
    const nonces = new Set([...text.matchAll(/\[([a-z2-7]{8})\]/g)].map((m) => m[1]));
    expect(nonces.size).toBe(1);
    const blocks = [...text.matchAll(/^--- (.+) \[([a-z2-7]{8})\] ---\n(.*)\n--- end \[\2\] ---$/gm)];
    expect(blocks.map((b) => b[1])).toEqual(["Cell", "Query error", "Span"]);
    for (const block of blocks) expect(() => JSON.parse(block[3])).not.toThrow();
  });

  test("ERR-14 blocked storage keeps the composer working and says drafts won't survive a reload", { tag: ["@mock"] }, async ({
    page,
    context,
  }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`${err.name}: ${err.message}`));
    await context.addInitScript(() => {
      window.__blockedDraftWrites = 0;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === window.sessionStorage && String(key).startsWith("o2.assistant.draft:")) {
          window.__blockedDraftWrites += 1;
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }
        return setItem.call(this, key, value);
      };
    });
    await openOnLogs(page);
    await assistant.composer().fill("kept in memory");
    await expect(assistant.container().locator('[data-test="assistant-composer-storage-blocked"]')).toHaveText(
      "Drafts won't be kept if you reload this page.",
    );
    await expect(assistant.composer()).toHaveValue("kept in memory");
    expect(await page.evaluate(() => window.__blockedDraftWrites)).toBeGreaterThan(0);
    // Only the refused write must not escape; an unrelated page error (a resource's error Event on a production bundle) is reported, not failed on.
    expect(errors.filter((error) => /quota|storage|setItem/i.test(error))).toEqual([]);
    if (errors.length > 0) test.info().annotations.push({ type: "unrelated page errors", description: errors.join(" | ") });
  });
});
