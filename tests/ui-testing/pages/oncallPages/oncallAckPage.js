/**
 * OnCallAckPage — the emailed acknowledge link's landing page.
 *
 * NOT a Vue view. This page is rendered server-side by the Rust handler, so it
 * carries no `data-test` attributes and never will: its selectors are the HTML
 * contract itself — a viewport meta, a form, a submit button and the hidden
 * token that identifies the page being acknowledged. Those live HERE rather
 * than in a spec so the contract has one home, and so a spec never reaches past
 * the page object into raw DOM.
 *
 * It is opened on its own context (a phone-sized one, unauthenticated — the
 * point of the link is that a woken responder is usually signed out), so this
 * takes the page it was opened on rather than the suite's shared one.
 */

export class OnCallAckPage {
  constructor(page) {
    this.page = page;
  }

  /** The `content` of the viewport meta, or null when the page declares none. */
  async readViewportMeta() {
    return await this.page.locator('meta[name="viewport"]').getAttribute('content');
  }

  /** The acknowledge button — the one thing the page exists to offer. */
  getAcknowledgeButton() {
    return this.page.locator('form button[type="submit"]').first();
  }

  /** The hidden field carrying the signed token; without it the POST identifies nothing. */
  getTokenField() {
    return this.page.locator('form input[name="token"]');
  }
}
