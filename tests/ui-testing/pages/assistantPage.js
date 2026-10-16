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

  async open(_via) {
    notYet("WP-04");
  }

  async send(_text, _scenario) {
    notYet("WP-05");
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
    return notYet("WP-04");
  }

  gate() {
    return notYet("WP-04");
  }

  askAdmin() {
    return notYet("WP-04");
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
    return notYet("WP-05");
  }

  composer() {
    return notYet("WP-05");
  }

  helper(_hostId) {
    return notYet("WP-13");
  }

  settings(_tab) {
    return notYet("WP-14");
  }
}
