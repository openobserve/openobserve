// Copyright 2026 OpenObserve Inc.
// The one page object every assistant flow uses (99 §5); every locator is a data-test.

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

  /** Types into the visible composer and presses Enter; `scenario` picks the next chat_stream answer. */
  async send(text, scenario) {
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
    return notYet("WP-10");
  }

  meter() {
    return notYet("WP-10");
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

  approval() {
    return notYet("WP-10");
  }

  history() {
    return notYet("WP-11");
  }

  thread() {
    return notYet("WP-11");
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

  helper(_hostId) {
    return notYet("WP-13");
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

  settings(_tab) {
    return notYet("WP-14");
  }
}
