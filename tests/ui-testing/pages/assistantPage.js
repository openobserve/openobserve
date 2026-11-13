// Copyright 2026 OpenObserve Inc.
// The one page object every assistant flow uses (99 §5); every locator is a data-test.
import { test, expect } from "@playwright/test";

// Mirrors harness/modes.mjs, which a statically imported page object cannot load (Playwright compiles it to require()).
const STACK_MODE = !!process.env.ASSISTANT_E2E_MODE && process.env.ASSISTANT_E2E_MODE !== "mock";

/** A method whose surface lands in a later work package; the spec that needs it flips with that WP. */
function notYet(wp) {
  throw new Error(`assistantPage: this surface lands in ${wp}`);
}

export class AssistantPage {
  constructor(page) {
    this.page = page;
    this.legacy = {
      headerButton: page.locator('[data-test="menu-link-ai-item"]').first(),
      chat: page.locator(".chat-container").filter({ visible: true }).last(),
      composer: page.locator(".chat-container [contenteditable=true]").filter({ visible: true }).last(),
      regexToggle: page.locator('[data-test="add-regex-pattern-open-close-ai-btn"]'),
      // Logs opens the filter builder by default, which hides the editor's toggle and shows its own AI button.
      nlToggle: page
        .locator('[data-test="logs-search-bar-filter-builder-ai-btn"], [data-test="logs-search-bar-ai-toggle-btn"]')
        .filter({ visible: true }),
      nlInput: page.locator('[data-test="logs-search-bar-ai-input-field-field"]'),
    };
    this.headerButton = page.locator('[data-test="menu-link-ai-item"]');
    this.sidebar = page.locator('[data-test="assistant-shell-sidebar"]').filter({ visible: true });
    this.full = page.locator('[data-test="assistant-shell-full"]');
    this.sheet = page.locator('[data-test="assistant-shell-sheet"]');
    // The empty chat: Home's welcome with starters, or a panel's logo.
    this.welcome = page
      .locator('[data-test="assistant-welcome"], [data-test="assistant-shell-empty"]')
      .filter({ visible: true });
  }

  /** The visible container root, whichever placement it is. */
  container() {
    return this.page.locator("[data-assistant-root]").filter({ visible: true });
  }

  /** Every v2 assistant id in the DOM; the legacy smoke asserts there are none with the flag off. */
  v2Ids() {
    return this.page.locator('[data-test^="assistant-"]');
  }

  async openLegacy() {
    await this.legacy.headerButton.click();
    await this.legacy.composer.waitFor({ state: "visible" });
  }

  async sendLegacy(text) {
    await this.legacy.composer.click();
    await this.legacy.composer.fill(text);
    await this.legacy.composer.press("Enter");
  }

  /** Opens the assistant by the header button or the chord and waits for its container. */
  async open(via = "header") {
    if (via === "chord") await this.page.keyboard.press("ControlOrMeta+i");
    else await this.headerButton.click();
    await this.container().first().waitFor({ state: "visible" });
  }

  /** Moves the visible chat with its header button for another mode: `sidebar`, `full`, `window` or `dock`. */
  async placeAs(id) {
    await this.page.mouse.move(0, 0);
    await this.container().locator(`[data-test="assistant-shell-place-${id}"]`).filter({ visible: true }).first().click();
  }

  async close() {
    await this.container().locator('[data-test="assistant-shell-close"]').click();
  }

  /** The first focusable logs row cell, after the page's own auto-run or, failing that, one run by hand. */
  async logRowCell() {
    const cell = this.page.locator('[data-test="logs-search-result-logs-table"] td[data-o2-focus-cell]').first();
    if (await cell.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false)) return cell;
    const run = this.page.locator('[data-test="logs-search-bar-refresh-btn"]');
    // While a search is in flight the same button is Cancel, so clicking it then kills the auto-run.
    await expect(run).toHaveAttribute("title", "Run query", { timeout: 30_000 });
    await run.click();
    await expect(cell).toBeVisible({ timeout: 30_000 });
    return cell;
  }

  /** Drops focus to the document so a page shortcut reaches the app, without clicking whatever sits under a fixed point. */
  async blurPage() {
    await this.page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  }

  /** Types into the visible composer and presses Enter; `scenario` picks the next chat_stream answer. */
  async send(text, scenario) {
    if (scenario && STACK_MODE) test.skip(true, `the scenario "${scenario}" is mock-only`);
    if (scenario) await this.page.evaluate((name) => (window.__o2mock.next = name), scenario);
    const box = this.composer();
    await box.click();
    await box.fill(text);
    await box.press("Enter");
  }

  /** Stop is the composer's Send slot while a turn runs (HT-04). */
  async stop() {
    await this.container().locator('[data-test="assistant-stop"]').click();
  }

  /** The live status row under the running prompt. */
  status() {
    return this.transcript().locator('[data-test="assistant-turn-status"]');
  }

  /** A terminal block: refusals sit above the composer, failures in the log. */
  outcome() {
    return this.container().locator('[data-test="assistant-turn-outcome"]').last();
  }

  outcomeAction() {
    return this.outcome().locator('[data-test="assistant-turn-outcome-action"]');
  }

  transcript() {
    return this.container().locator('[data-test="assistant-transcript"]');
  }

  /** The latest answer article. */
  answer() {
    return this.transcript().locator("[data-answer]").last();
  }

  /** The latest answer's Copy, which shows only once its turn has ended with something said. */
  answerDone() {
    return this.answer().locator('[data-test="assistant-msg-copy-answer"]');
  }

  /** Every ended answer's Copy in the visible container. */
  answersDone() {
    return this.transcript().locator('[data-answer] [data-test="assistant-msg-copy-answer"]');
  }

  launcher() {
    return this.page.locator('[data-test="assistant-launcher"]');
  }

  consentCard() {
    return this.container().locator('[data-test="assistant-consent-card"]');
  }

  meter() {
    return this.container().locator('[data-test="assistant-credit-meter"]');
  }

  notice() {
    return this.page.locator('[data-test="assistant-shell-notice-row"]').filter({ visible: true });
  }

  gate() {
    return this.page.locator('[data-test="assistant-gate-state"]').filter({ visible: true }).first();
  }

  askAdmin() {
    return this.page.locator('[data-test="assistant-ask-admin"]').filter({ visible: true });
  }

  /** The pending approval card of the visible container. */
  approval() {
    return this.container().locator('[data-test="assistant-approval-card"]');
  }

  /** The record a decided card leaves in the transcript. */
  approvalResult() {
    return this.container().locator('[data-test="assistant-approval-result"]').last();
  }

  /** The history list that is showing: the full view's rail or the in-panel Chats view. */
  history() {
    return this.page.locator('[data-test="assistant-history"]').filter({ visible: true }).first();
  }

  /** One history row button by its title. */
  historyRow(title) {
    return this.history().locator('[data-test="assistant-history-row"]').filter({ hasText: title }).first();
  }

  /** Opens All chats from the thread title menu; the full view's rail already is the list. */
  async openHistory() {
    if (await this.history().isVisible().catch(() => false)) return;
    // The header button's tooltip stays open under a resting pointer and covers the thread header.
    await this.page.mouse.move(0, 0);
    await this.thread().locator('[data-test="assistant-thread-title-button"]').click();
    const all = this.page.locator('[data-test="assistant-title-menu-all"]').filter({ visible: true });
    await this.page.locator('[role="menu"]').filter({ visible: true }).first().waitFor();
    if (await all.count()) await all.click();
    else {
      // With no other chat the menu offers no All chats, so the history chord opens the list.
      await this.page.keyboard.press("Escape");
      await this.page.keyboard.press("ControlOrMeta+Shift+h");
    }
    await this.history().waitFor({ state: "visible" });
  }

  thread() {
    return this.container().locator('[data-test="assistant-thread-header"]');
  }

  tray() {
    return this.container().locator('[data-test="assistant-context-tray"]');
  }

  /** The textbox itself; its wrapper carries `data-test="assistant-composer"` and `data-state`. */
  composer() {
    return this.container().locator('[data-test="assistant-composer-field"]');
  }

  composerState() {
    return this.container().locator('[data-test="assistant-composer"]');
  }

  /** The staged chips; the time chip sits in the composer's bottom row, not in the tray. */
  chips() {
    return this.tray().locator("[data-assistant-chip]");
  }

  timeChip() {
    return this.container().locator('[data-test="assistant-context-chip-time"]');
  }

  /** Opens the tray's `+N`, which folds every chip past the first at sidebar width. */
  async expandTray() {
    const more = this.tray().locator('[data-test="assistant-context-more"]');
    if ((await more.count()) && (await more.getAttribute("aria-expanded")) !== "true") await more.click();
  }

  /** Staged images are chips of their own; a cap notice hides the tray for a few seconds. */
  imageChips() {
    return this.tray().locator('[data-test="assistant-context-chip-image"]');
  }

  /** The ⓘ that opens what the assistant sees, in the composer strip beside chips (or Home's toolbar). */
  sees() {
    return this.container().locator('[data-test="assistant-context-sees"]').filter({ visible: true });
  }

  /** Opens what the assistant sees: the strip's ⓘ when it shows, else the panel's title menu item. */
  async openSees() {
    if (await this.sees().count()) return this.sees().click();
    await this.page.mouse.move(0, 0);
    await this.thread().locator('[data-test="assistant-thread-title-button"]').click();
    await this.page.locator('[data-test="assistant-thread-menu-sees"]').filter({ visible: true }).click();
  }

  /** A host's docked chat; `hostId` is the dock's `data-host`. */
  dock(hostId) {
    return this.page.locator(`[data-test="assistant-shell-docked"][data-host="${hostId}"]`).filter({ visible: true });
  }

  /** The editor host's assistant toggle (`ai-entry-<host>-ask`). */
  dockToggle(id) {
    return this.page.locator(`[data-test="ai-entry-${id}-ask"]`).filter({ visible: true });
  }

  diff() {
    return this.page.locator('[data-test="assistant-diff-block"]').filter({ visible: true });
  }

  aiLabel() {
    return this.page.locator('[data-test="ai-label-editor"]').filter({ visible: true });
  }

  resizeHandle() {
    return this.page.locator('[data-test="assistant-shell-resize-handle"]').filter({ visible: true });
  }

  /** The column around the sidebar shell, which carries the width variable. */
  sidebarHost() {
    return this.page.locator('[data-test="assistant-sidebar-host"]');
  }

  /** The one lifecycle question shown (sign-out, org switch or leave guard). */
  lifecycleDialog(kind) {
    const ids = { sign_out: "assistant-shell-sign-out-dialog", org_switch: "assistant-shell-org-switch-dialog", leave_guard: "assistant-shell-leave-guard" };
    return this.page.locator(`[data-test="${ids[kind]}"]`);
  }

  /** The Settings › Assistant panel of one tab. */
  settings(tab) {
    return this.page.locator(`[data-test="settings-assistant-panel-${tab}"]`);
  }

  settingsTab(tab) {
    return this.page.locator(`[data-test="settings-assistant-tab-${tab}"]`);
  }

  settingsControl(id) {
    return this.page.locator(`[data-test="settings-assistant-${id}"]`);
  }

  /** The control inside an OSwitch, which carries `aria-checked` and `disabled`. */
  settingsSwitch(id) {
    return this.settingsControl(id).locator('[role="switch"]');
  }

  confirmDialog() {
    return this.page.locator('[data-test="confirm-dialog-provider"]');
  }
}
