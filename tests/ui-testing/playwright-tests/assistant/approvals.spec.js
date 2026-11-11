// Copyright 2026 OpenObserve Inc.
// Approval cards with the flag on: typed card, safe default, result from /confirm, expiry, Reply, the record and other tabs.

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant approval cards", () => {
  let assistant;
  let harness;
  let state;

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;

  async function openOnLogs(page) {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await assistant.open("header");
    await expect(assistant.composer()).toBeVisible();
  }

  async function ask(page, scenario, text = "clean up stale alerts") {
    await openOnLogs(page);
    await assistant.send(text, scenario);
    await expect(assistant.approval()).toBeVisible({ timeout: 15_000 });
  }

  const confirmations = (page) => page.evaluate(() => window.__o2mock.confirmations);
  const requests = (page) =>
    page.evaluate(() =>
      window.__o2mock.requests.map((r) => ({ body: JSON.parse(r.body || "{}"), headers: r.headers })),
    );
  const region = () => assistant.container().locator('[data-test="assistant-status-region"]');
  const approve = () => assistant.approval().locator('[data-test="assistant-approval-approve"]');
  const deny = () => assistant.approval().locator('[data-test="assistant-approval-deny"]');
  const heading = () => assistant.approval().locator('[data-test="assistant-approval-heading"]');
  // Reply and the other secondary actions sit in the card's ⋯ menu, which portals out of the card.
  const menuAction = async (page, id) => {
    await assistant.approval().locator('[data-test="assistant-approval-more"]').click();
    await page.locator(`[role="menu"] [data-test="assistant-approval-${id}"]`).click();
  };
  const tabTo = async (page, target) => {
    for (let i = 0; i < 10 && !(await target.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press("Tab");
    await expect(target).toBeFocused();
  };

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    // A server without split budgets gates every card to Deny only (PO A14), so this one advertises them.
    state = harness.createMockState({ capabilitiesEnabled: true, capabilities: { approval_extend_budgets: true } });
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("APPR-01 a delete card is safe by default: Enter in the composer never decides, Deny is the default", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await ask(page, "confirmation");
    const card = assistant.approval();
    await expect(card).toHaveAttribute("role", "group");
    await expect(card.locator('[data-test="assistant-approval-heading"]')).toHaveText("Delete 1 alert");
    const countdown = card.locator('[data-test="assistant-approval-countdown"]');
    await expect(countdown).toHaveText(/^\d+:\d\d$/);
    await expect(countdown).toHaveAttribute("aria-label", /^Expires in \d+:\d\d$/);
    await expect(approve()).toHaveText("Delete 1 alert");
    await expect(card.locator('[data-test="assistant-approval-edit"]')).toHaveCount(0);
    await expect(assistant.composer()).toBeFocused();
    await assistant.composer().press("Enter");
    expect(await confirmations(page)).toHaveLength(0);
    // One target is named in the card's Details, which stay closed until asked for.
    await card.locator('[data-test="assistant-approval-details"] button').first().click();
    await expect(card.locator('[data-test="assistant-approval-args"]')).toContainText('"name": "checkout-latency-old"');
    await page.keyboard.press("ControlOrMeta+i");
    await expect(heading()).toBeFocused();
    await page.keyboard.press("Enter");
    expect(await confirmations(page)).toHaveLength(0);
    await tabTo(page, deny());
    await page.keyboard.press("Enter");
    await expect(assistant.approvalResult()).toContainText("Denied: delete 1 alert");
    const sent = await confirmations(page);
    expect(sent).toHaveLength(1);
    expect(sent[0].approved).toBe(false);
    await expect(assistant.composer()).toBeFocused();
  });

  test("APPR-02 the result comes from /confirm item by item", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page, "confirmation_batch");
    await harness.setKnobs(page, { confirmFail: ["checkout-latency-old"] });
    await expect(assistant.container().locator('[data-test="assistant-plan-block"]')).toContainText(
      "I'll delete 5 alerts:",
    );
    const kept = (id) => assistant.container().locator(`[data-test="assistant-plan-item-${id}"] [role="checkbox"]`);
    await kept("stale5").click();
    await expect(kept("stale5")).toHaveAttribute("aria-checked", "false");
    await expect(approve()).toHaveText("Delete 4 alerts");
    await kept("stale5").click();
    await expect(approve()).toHaveText("Delete 5 alerts");
    await approve().click();
    const result = assistant.approvalResult();
    await expect(result).toContainText("Deleted 4 of 5 alerts · 1 failed");
    await expect(result.locator('[data-test="assistant-approval-result-item-stale1"]')).toContainText(
      "checkout-latency-old failed: no permission",
    );
    await expect(assistant.approval()).toHaveCount(0);
    const timeline = assistant.container().locator('[data-test="assistant-action-timeline"]');
    await expect(timeline).toContainText("5 actions in this chat");
  });

  test("APPR-03 a lost decision never claims nothing changed: a decline goes again, an approve reads unknown", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page, "confirmation");
    await harness.setKnobs(page, { confirmStatus: 500 });
    await deny().click();
    let result = assistant.approvalResult();
    await expect(result).toContainText("Couldn't send your decision. The alert hasn't changed.");
    await harness.setKnobs(page, { confirmStatus: 200 });
    await result.locator('[data-test="assistant-approval-result-send-again"]').click();
    await expect(assistant.approvalResult()).toContainText("Denied: delete 1 alert");
    expect((await confirmations(page)).map((c) => c.approved)).toEqual([false, false]);
    await expect(assistant.composerState()).toHaveAttribute("data-state", "empty", { timeout: 30_000 });
    await assistant.send("delete it after all", "confirmation");
    await expect(approve()).toBeVisible({ timeout: 15_000 });
    await harness.setKnobs(page, { confirmStatus: 500 });
    await approve().click();
    result = assistant.approvalResult();
    await expect(result).toContainText("Your decision was sent, but its result couldn't be confirmed.");
    await expect(result.locator('[data-test="assistant-approval-result-send-again"]')).toHaveCount(0);
    await expect(result.locator('[data-test="assistant-approval-result-check-list"]')).toHaveAttribute(
      "href",
      /alerts/,
    );
  });

  test("APPR-04 a permission card states its expiry, declines itself at zero and asks again in place", { tag: ["@mock"] }, async ({ page }) => {
    test.setTimeout(90_000);
    await ask(page, "permission_card", "list the pods");
    await expect(region()).toContainText("Waiting for your approval: Allow bash. Expires in 2");
    const countdown = assistant.approval().locator('[data-test="assistant-approval-countdown"]');
    await expect(countdown).toHaveText(/^0:\d\d$/);
    await expect(countdown).toHaveAttribute("aria-label", /^Expires in 0:\d\d$/);
    const record = assistant.approvalResult();
    await expect(record).toHaveAttribute("data-state", "expired", { timeout: 35_000 });
    await expect(record).toContainText("Request expired. Nothing was changed.");
    await expect(assistant.approval()).toHaveCount(0);
    expect((await confirmations(page)).at(-1).approved).toBe(false);
    await expect(assistant.composerState()).toHaveAttribute("data-state", "empty", { timeout: 30_000 });
    await harness.nextScenario(page, "complete");
    await record.locator('[data-test="assistant-approval-result-ask-again"]').click();
    await expect
      .poll(async () => (await requests(page)).length, { timeout: 10_000 })
      .toBe(2);
    const resent = (await requests(page))[1].body;
    expect(resent.reply_to_approval).toMatch(/:1$/);
    expect(resent.messages.at(-1).content).toBe("Ask me again: Allow bash");
  });

  test("APPR-05 Reply declines with the text and sends it as the next turn naming the card", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page, "permission_card", "list the pods");
    await menuAction(page, "reply");
    await expect(assistant.composer()).toHaveAttribute("placeholder", "Reply to the assistant");
    await expect(assistant.composer()).toBeFocused();
    await assistant.composer().fill("use the staging namespace");
    await harness.nextScenario(page, "complete");
    await assistant.composer().press("Enter");
    await expect(assistant.approvalResult()).toHaveAttribute("data-state", "replied");
    await expect(assistant.approvalResult()).toContainText("Declined with a reply");
    await expect(assistant.approvalResult()).toContainText("use the staging namespace");
    expect((await confirmations(page))[0].approved).toBe(false);
    await expect.poll(async () => (await requests(page)).length, { timeout: 15_000 }).toBe(2);
    const reply = (await requests(page))[1].body;
    expect(reply.reply_to_approval).toMatch(/:1$/);
    expect(reply.messages.at(-1).content).toBe("use the staging namespace");
  });

  test("APPR-06 the decision posts on the session it was asked in, after the chat moved to the full view", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page, "confirmation");
    const sid = (await requests(page))[0].headers["x-o2-assistant-session-id"];
    await assistant.placeAs("full");
    await expect(assistant.full).toBeVisible();
    await expect(assistant.approval()).toBeVisible();
    await approve().click();
    await expect(assistant.approvalResult()).toContainText("Deleted 1 alert");
    expect((await confirmations(page))[0].url).toContain(`/ai/confirm/${sid}`);
  });

  test("APPR-07 a reload shows the decision as a record, never a live card", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await ask(page, "confirmation");
    const sid = (await requests(page))[0].headers["x-o2-assistant-session-id"];
    await approve().click();
    await expect(assistant.approvalResult()).toContainText("Deleted 1 alert");
    await expect(assistant.answer()).toContainText("was deleted", { timeout: 15_000 });
    await page.goto(`${harness.ENV.appUrl}/assistant/${sid}?org_identifier=${harness.ENV.org}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(assistant.approvalResult()).toContainText("Deleted 1 alert", { timeout: 30_000 });
    await expect(assistant.approval()).toHaveCount(0);
  });

  test("APPR-07 a reload keeps the decision as a record when the server history has no card", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    state.historyDropsCards = true;
    await ask(page, "confirmation");
    const sid = (await requests(page))[0].headers["x-o2-assistant-session-id"];
    await approve().click();
    await expect(assistant.approvalResult()).toContainText("Deleted 1 alert");
    await expect(assistant.answer()).toContainText("was deleted", { timeout: 15_000 });
    await page.goto(`${harness.ENV.appUrl}/assistant/${sid}?org_identifier=${harness.ENV.org}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(assistant.approvalResult()).toContainText("Deleted 1 alert", { timeout: 30_000 });
    await expect(assistant.approval()).toHaveCount(0);
    await expect(assistant.approvalResult().getByRole("button", { name: "Ask again" })).toHaveCount(0);
  });

  test("APPR-08 a change made without a review step is surfaced with the object", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await assistant.send("raise the threshold", "resource_changed_unreviewed");
    const notice = assistant.container().locator('[data-test="assistant-unreviewed-change"]');
    await expect(notice).toContainText("The assistant changed 1 alert without a review step.");
    const open = assistant.container().locator('[data-test="assistant-unreviewed-change-open"]');
    await expect(open).toHaveText("See what changed");
    await expect(open).toHaveAttribute("target", "_blank");
  });

  test("XTAB-03 a chat whose card another tab holds waits with Stop and keeps Send locked until it is resolved", { tag: ["@mock"] }, async ({ page }) => {
    test.skip(!process.env.O2_VITE_DEV, "reads the app's modules through the dev server's module graph");
    await openOnLogs(page);
    await assistant.send("why 5xx?", "complete");
    await expect(assistant.composerState()).toHaveAttribute("data-state", "empty", { timeout: 30_000 });
    const sid = (await requests(page))[0].headers["x-o2-assistant-session-id"];
    const key = await page.evaluate(async () => {
      const m = await import("/web/src/composables/assistant/index.ts");
      return m.assistantStore.state.userOrgKey;
    });
    // The tab holding the card speaks only through the hint channel; a second channel object stands in for it.
    const post = (hint) =>
      page.evaluate(([name, value]) => new BroadcastChannel(name).postMessage(value), [`o2-assistant:${key}`, hint]);
    await post({ v: 1, type: "approval_pending", sid, turnId: "t-other", callId: "o2_delete", at: Date.now() });
    const waiting = assistant
      .container()
      .locator('[data-test="assistant-approval-result"][data-state="waiting_elsewhere"]');
    await expect(waiting).toContainText(
      "Waiting for your approval in the tab where you asked. Approve or deny it there, or stop this answer.",
    );
    await assistant.composer().fill("and now?");
    await assistant.composer().press("Enter");
    expect(await requests(page)).toHaveLength(1);
    // The refused send is spoken by the composer's status region; no line is drawn under the field.
    await expect(assistant.container().locator('[data-test="assistant-composer-status"]')).toContainText(
      "Another tab is waiting for your approval on this chat.",
    );
    await post({ v: 1, type: "approval_resolved", sid, callId: "o2_delete", approved: false, at: Date.now() });
    await expect(waiting).toHaveCount(0);
    await expect(assistant.composer()).toHaveValue("and now?");
    await assistant.composer().click();
    await assistant.composer().press("Enter");
    await expect.poll(async () => (await requests(page)).length).toBe(2);
  });

  test("A11Y-03 a keyboard-only turn through an approval and a consent card keeps focus and speaks each result once", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await page.evaluate(() => {
      const spoken = (window.__spoken = []);
      const regions = '[data-test="assistant-composer-status"], [data-test="assistant-status-region"]';
      new MutationObserver((records) => {
        for (const record of records) {
          const nodes = record.type === "characterData" ? [record.target] : [...record.addedNodes];
          for (const node of nodes) {
            const host = node.nodeType === 1 ? node : node.parentElement;
            const text = node.textContent?.trim();
            if (text && host?.closest(regions)) spoken.push(text);
          }
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const spokenTimes = (text) => page.evaluate((t) => window.__spoken.filter((s) => s === t).length, text);
    const focusInAssistant = () =>
      page.evaluate(() => !!document.activeElement?.closest('[data-test="assistant-container"], [data-assistant-root]'));
    // The logs query editor can take focus late and swallow the chord, as SHELL-01 guards against.
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("ControlOrMeta+i");
    await expect(assistant.composer()).toBeFocused();
    await page.evaluate(() => (window.__o2mock.next = "confirmation"));
    await page.keyboard.type("clean up stale alerts");
    await page.keyboard.press("Enter");
    await expect(assistant.approval()).toBeVisible({ timeout: 15_000 });
    await expect(assistant.composer()).toBeFocused();
    await page.keyboard.press("ControlOrMeta+i");
    await expect(heading()).toBeFocused();
    await tabTo(page, approve());
    await harness.setKnobs(page, { confirmDelayMs: 1_500 });
    await page.keyboard.press("Enter");
    await expect(assistant.approval()).toHaveAttribute("aria-busy", "true");
    await expect(approve()).toBeFocused();
    await expect(approve()).toHaveAttribute("aria-disabled", "true");
    await expect(assistant.approvalResult()).toContainText("Deleted 1 alert");
    expect(await focusInAssistant()).toBe(true);
    await expect.poll(() => spokenTimes("Deleted 1 alert")).toBe(1);
    await expect(assistant.composerState()).toHaveAttribute("data-state", "empty", { timeout: 30_000 });

    await page.keyboard.press("ControlOrMeta+i");
    await expect(assistant.composer()).toBeFocused();
    await page.evaluate(() => (window.__o2mock.next = "consent"));
    await page.keyboard.type("why did checkout 5xx spike?");
    await page.keyboard.press("Enter");
    const consent = assistant.consentCard();
    await expect(consent).toBeVisible({ timeout: 15_000 });
    await expect(assistant.composer()).toBeFocused();
    await page.keyboard.press("ControlOrMeta+i");
    await expect(consent.locator('[data-test="assistant-consent-card-org"]')).toBeFocused();
    await tabTo(page, consent.locator('[data-test="assistant-consent-card-checkbox"] [role="checkbox"]'));
    await page.keyboard.press("Space");
    await tabTo(page, consent.locator('[data-test="assistant-consent-card-enable"]'));
    await page.keyboard.press("Enter");
    await expect(assistant.container().locator('[data-test="assistant-consent-note"]')).toBeVisible({
      timeout: 15_000,
    });
    expect(await focusInAssistant()).toBe(true);
    await expect.poll(() => spokenTimes("Paid AI usage enabled. Sending your message.")).toBe(1);
  });

  test("SHELL-13 a card never takes focus from the composer; Ctrl+I and Review request reach Deny, with no trap", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await ask(page, "confirmation");
    await expect(assistant.composer()).toBeFocused();
    await expect(region()).toContainText("Press Control I to review it.");
    // The strip offers Review only while the card is out of view, so Ctrl+I is the bridge here.
    await expect(assistant.container().locator('[data-test="assistant-strip-review"]')).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+i");
    await expect(heading()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(assistant.approval().locator('[data-test="assistant-approval-more"]')).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(deny()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(approve()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(assistant.approval().locator("button").last()).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-test="assistant-approval-card"]'))).toBe(false);
    await page.keyboard.press("Shift+Tab");
    // Escape never decides, and on a waiting card it does not close the panel either.
    await page.keyboard.press("Escape");
    await expect(assistant.approval()).toHaveCount(1);
    expect(await confirmations(page)).toHaveLength(0);
    await expect(assistant.container()).toBeVisible();
  });

  test.describe("always-allow scope and its grant", () => {
    const grantRow = () => ({
      id: "gr_e2e_mute",
      tool: "MuteAlert",
      operation: "MuteAlert",
      scope: "always",
      granted_by: harness.ENV.user,
      granted_at: Date.now() * 1000,
    });
    const always = () => assistant.approvalResult().locator('[data-test="assistant-approval-result-always"]');
    const revoke = () => assistant.approvalResult().locator('[data-test="assistant-approval-result-revoke"]');

    async function approveAlways(page, grant) {
      // A server that budgets approvals lets a card offer a scope; the grant list is read from GET /ai/grants.
      state.capabilitiesEnabled = true;
      state.capabilities = { approval_extend_budgets: true };
      state.grantsEnabled = true;
      await ask(page, "mute_two_grantable", "pause the noisy alerts");
      await harness.setKnobs(page, { confirmGrant: grant });
      const scope = assistant.approval().locator('[data-test="assistant-approval-scope-trigger"]');
      await scope.click();
      await page.locator('[data-test="assistant-approval-scope-option"][data-test-value="tool"]').click();
      await approve().click();
      await expect.poll(async () => (await confirmations(page)).at(-1)).toMatchObject({ approved: true, scope: "always" });
    }

    test("APPR-20 an always approve lists its grant with Revoke, which sends the DELETE", { tag: ["@mock"] }, async ({ page }) => {
      state.grants = [grantRow()];
      await approveAlways(page, { stored: true, scope: "always", id: "gr_e2e_mute" });
      await expect(always()).toContainText("Always allowed:");
      const deleted = page.waitForRequest(
        (req) => req.method() === "DELETE" && /\/ai\/grants\/gr_e2e_mute$/.test(new URL(req.url()).pathname),
      );
      await revoke().click();
      await deleted;
      await expect(always()).toHaveText("Approval revoked. The assistant will ask next time.");
      expect(state.log).toContain("REVOKE grant gr_e2e_mute");
    });

    test("APPR-21 a grant the server refuses reads as not saved, with no Revoke", { tag: ["@mock"] }, async ({ page }) => {
      state.grants = [];
      await approveAlways(page, { stored: false, scope: "always", reason: "read_only" });
      await expect(always()).toHaveAttribute("data-grant", "not_stored");
      await expect(always()).toContainText("wasn't saved for later");
      await expect(revoke()).toHaveCount(0);
      expect(state.log.some((line) => line.startsWith("REVOKE"))).toBe(false);
    });
  });
});
