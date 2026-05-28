// Dashboard SQL Autocomplete page object
// Encapsulates the SQL custom-query Monaco editor interactions used by
// the dashboard-sql-autocomplete e2e spec. All locators here use data-test
// selectors. Suggestion assertions read the Monaco model directly via
// page.evaluate — they never touch the .suggest-widget DOM.

const testLogger = require("../../playwright-tests/utils/test-logger.js");

export default class DashboardSqlAutocomplete {
  constructor(page) {
    this.page = page;

    // Query-type toggles
    this.sqlQueryTypeBtn = page.locator('[data-test="dashboard-sql-query-type"]');
    this.customQueryTypeBtn = page.locator('[data-test="dashboard-custom-query-type"]');

    // SQL Monaco editor wrapper + discard button
    this.queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
    this.discardPanelBtn = page.locator('[data-test="dashboard-panel-discard"]');
  }

  // -----------------------------------------------------------------------
  // Editor interactions
  // -----------------------------------------------------------------------

  // Wait for the SQL Monaco editor to be visible (created by CodeQueryEditor).
  async waitForEditorReady(timeout = 10000) {
    await this.queryEditor.waitFor({ state: "visible", timeout });
    // Wait for Monaco to be attached to the window object so we can read its model.
    await this.page.waitForFunction(
      () => !!(window).monaco && (window).monaco.editor.getModels().length > 0,
      undefined,
      { timeout }
    );
  }

  // Click the editor wrapper so the embedded Monaco textarea takes keyboard focus.
  async focusEditor() {
    await this.queryEditor.click();
    await this.page.waitForTimeout(200);
  }

  // Switch the panel to SQL Custom query mode, then focus the Monaco editor.
  async switchToSqlCustomQueryMode() {
    await this.sqlQueryTypeBtn.click();
    await this.customQueryTypeBtn.click();
    await this.waitForEditorReady();
    await this.focusEditor();
    await this.page.waitForTimeout(300);
  }

  // Clear the editor content via the Monaco model. Avoids relying on Ctrl+A
  // selecting only inside the editor (the suggest widget can swallow keys).
  async clearEditor() {
    await this.page.evaluate(() => {
      const m = (window).monaco;
      if (!m || !m.editor) return;
      const models = m.editor.getModels();
      if (models.length === 0) return;
      models[0].setValue("");
    });
    await this.focusEditor();
    await this.page.waitForTimeout(150);
  }

  // Read the current editor content from the Monaco model.
  async getEditorValue() {
    return this.page.evaluate(() => {
      const m = (window).monaco;
      if (!m || !m.editor) return "";
      const models = m.editor.getModels();
      return models.length > 0 ? models[0].getValue() : "";
    });
  }

  // Type text into the editor and trigger Monaco's autocomplete via Ctrl+Space.
  // Does NOT inspect the suggest-widget DOM — callers should drive the suggestion
  // with the keyboard (Enter / Tab) and verify the editor value via getEditorValue.
  async typeAndTriggerAutocomplete(text, delayBeforeTrigger = 400) {
    await this.clearEditor();
    await this.page.keyboard.type(text, { delay: 30 });
    await this.page.waitForTimeout(delayBeforeTrigger);
    await this.page.keyboard.press("Control+Space");
    await this.page.waitForTimeout(400);
  }

  // Dismiss the suggest widget if open and blur the editor by sending Escape.
  // Sending two Escape presses guarantees both the dropdown and the editor focus
  // are dropped without relying on a body click.
  async dismissAutocompleteAndBlur() {
    await this.page.keyboard.press("Escape");
    await this.page.waitForTimeout(150);
    await this.page.keyboard.press("Escape");
    await this.page.waitForTimeout(150);
  }

  // -----------------------------------------------------------------------
  // Suggestion provider introspection (Monaco completion API, not DOM)
  // -----------------------------------------------------------------------
  //
  // We ask Monaco's registered completion providers directly for the suggestions
  // they would offer at the current cursor position. This is the supported
  // alternative to scraping the suggest-widget DOM and is fully driven through
  // the editor model — no class selectors are needed.

  // Returns an array of suggestion labels at the current cursor for the active model.
  // Reads from the SuggestController's internal completion model (the same data
  // Monaco renders in the suggest widget) — no DOM scraping, no class selectors.
  async getSuggestionLabelsAtCursor(timeout = 8000) {
    // Poll for items to appear, then snapshot the labels.
    await this.page
      .waitForFunction(
        () => {
          const m = (window).monaco;
          const editors = m?.editor?.getEditors?.() || [];
          // Prefer focused editor, else the most recently created one.
          const editor =
            editors.find((e) => e.hasTextFocus && e.hasTextFocus()) ||
            editors[editors.length - 1];
          if (!editor) return false;
          const ctrl = editor.getContribution(
            "editor.contrib.suggestController"
          );
          if (!ctrl || !ctrl.model) return false;
          const items =
            ctrl.model._completionModel?.items ?? ctrl.model.items ?? [];
          return Array.isArray(items) && items.length > 0;
        },
        undefined,
        { timeout }
      )
      .catch(() => {});

    return this.page.evaluate(() => {
      const m = (window).monaco;
      const editors = m?.editor?.getEditors?.() || [];
      const editor =
        editors.find((e) => e.hasTextFocus && e.hasTextFocus()) ||
        editors[editors.length - 1];
      if (!editor) return [];
      const ctrl = editor.getContribution(
        "editor.contrib.suggestController"
      );
      const rawItems =
        ctrl?.model?._completionModel?.items ??
        ctrl?.model?.items ??
        [];
      return rawItems
        .map((item) => {
          const completion = item?.completion || item;
          if (!completion) return "";
          if (typeof completion.label === "string") return completion.label;
          if (
            completion.label &&
            typeof completion.label.label === "string"
          ) {
            return completion.label.label;
          }
          return "";
        })
        .filter(Boolean);
    }).catch(() => []);
  }

  // True when the editor's suggest controller has items available
  // (i.e. the suggestion list is currently being shown). Reads the
  // completion model length rather than the SuggestModel state enum
  // since the state enum's "Open" value differs across Monaco versions.
  async isAutocompleteOpen() {
    return this.page.evaluate(() => {
      const m = (window).monaco;
      if (!m || !m.editor) return false;
      const editors = m.editor.getEditors();
      const editor =
        editors.find((e) => e.hasTextFocus && e.hasTextFocus()) ||
        editors[editors.length - 1];
      if (!editor) return false;
      const ctrl = editor.getContribution("editor.contrib.suggestController");
      const items =
        ctrl?.model?._completionModel?.items ?? ctrl?.model?.items ?? [];
      return Array.isArray(items) && items.length > 0;
    }).catch(() => false);
  }

  // Drive the highlighted suggestion: accept the first item via Enter.
  // Returns the resulting editor value (read via Monaco model) so tests can
  // assert what was inserted (e.g. no stray double-quote).
  async acceptFirstSuggestionAndReadValue() {
    await this.page.keyboard.press("Enter");
    await this.page.waitForTimeout(300);
    return this.getEditorValue();
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  // Discard the in-progress panel edit. Safe to call when the discard button
  // isn't rendered (returns silently).
  async discardPanelIfVisible() {
    const visible = await this.discardPanelBtn
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (visible) {
      await this.discardPanelBtn.click();
      await this.page.waitForTimeout(500);
    }
  }
}
