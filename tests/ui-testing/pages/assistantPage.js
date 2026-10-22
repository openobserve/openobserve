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
      nlToggle: page.locator('[data-test="logs-search-bar-ai-toggle-btn"]'),
      nlInput: page.locator('[data-test="logs-search-bar-ai-input-field-field"]'),
    };
    this.headerButton = page.locator('[data-test="menu-link-ai-item"]');
    this.sidebar = page.locator('[data-test="assistant-shell-sidebar"]').filter({ visible: true });
    this.full = page.locator('[data-test="assistant-shell-full"]');
    this.sheet = page.locator('[data-test="assistant-shell-sheet"]');
    this.welcome = page.locator('[data-test="assistant-welcome"]').filter({ visible: true });
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

  /** The sticky copy of the status in the strip above the composer. */
  stickyStatus() {
    return this.container().locator('[data-test="assistant-sticky-status"]');
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

  strip() {
    return this.container().locator('[data-test="assistant-status-strip"]');
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

  creditNotice() {
    return this.container().locator('[data-test="assistant-credit-notice"]');
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

  /** The history list that is showing: the full view's rail, the header popover or the dense drawer. */
  history() {
    return this.page.locator('[data-test="assistant-history"]').filter({ visible: true }).first();
  }

  /** One history row button by its title. */
  historyRow(title) {
    return this.history().locator('[data-test="assistant-history-row"]').filter({ hasText: title }).first();
  }

  /** Opens the history list from the thread header (Chats, or the overflow menu when dense). */
  async openHistory() {
    const chats = this.thread().locator('[data-test="assistant-thread-history"]');
    // The header button's tooltip stays open under a resting pointer and covers the thread header.
    await this.page.mouse.move(0, 0);
    if (await chats.isVisible().catch(() => false)) await chats.click();
    else {
      await this.thread().locator('[data-test="assistant-thread-menu"]').click();
      await this.page.locator('[data-test="assistant-thread-menu-history"]').click();
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

  chips() {
    return this.tray().locator("[data-assistant-chip]");
  }

  /** An editor's inline helper row; `hostId` is the editor host's id (`logs`, `alert`, `alert_query`…). */
  helper(hostId) {
    return this.page.locator(`[data-test="inline-helper"][data-host="${hostId}"]`).filter({ visible: true });
  }

  /** The helper's door in an editor's toolbar. */
  helperDoor(hostId) {
    return this.page
      .locator(`[data-test="inline-helper-toolbar"][data-host="${hostId}"] [data-test="ai-entry-query-generate"]`)
      .filter({ visible: true });
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

  /** The column or card around the sidebar shell, which carries `data-mode` and the width variable. */
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
