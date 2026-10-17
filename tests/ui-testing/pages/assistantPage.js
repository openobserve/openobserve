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

  async stop() {
    notYet("WP-06");
  }

  status() {
    return notYet("WP-06");
  }

  outcome() {
    return notYet("WP-06");
  }

  outcomeAction() {
    return notYet("WP-06");
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

  settings(_tab) {
    return notYet("WP-14");
  }
}
