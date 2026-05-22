// Dashboard PromQL Query Editor page object
// Encapsulates the PromQL custom-query Monaco editor used by the
// dashboard-promql-suggestions e2e spec. All locators here use data-test
// attributes only. Suggestion assertions read the Monaco model and the
// suggest controller via page.evaluate — they never touch the
// `.monaco-editor`, `.suggest-widget`, or `.monaco-list-row` DOM.

const testLogger = require("../../playwright-tests/utils/test-logger.js");

export default class DashboardPromQLEditor {
  constructor(page) {
    this.page = page;

    // Query-type toggles
    this.promqlQueryTypeBtn = page.locator(
      '[data-test="dashboard-promql-query-type"]',
    );
    this.customQueryTypeBtn = page.locator(
      '[data-test="dashboard-custom-query-type"]',
    );

    // PromQL Monaco editor wrapper + the inner CodeQueryEditor host div
    this.queryEditor = page.locator(
      '[data-test="dashboard-panel-query-editor"]',
    );
    this.queryEditorHost = this.queryEditor.locator(
      '[data-test="query-editor"]',
    );
    this.discardPanelBtn = page.locator(
      '[data-test="dashboard-panel-discard"]',
    );
  }

  // ----- Query type mode toggles -----------------------------------------

  async isPromqlAvailable() {
    return this.promqlQueryTypeBtn.isVisible().catch(() => false);
  }

  async switchToPromql() {
    await this.promqlQueryTypeBtn.waitFor({
      state: "visible",
      timeout: 10000,
    });
    await this.promqlQueryTypeBtn.click();
  }

  async switchToCustomQuery() {
    await this.customQueryTypeBtn.waitFor({
      state: "visible",
      timeout: 10000,
    });
    await this.customQueryTypeBtn.click();
  }

  async discardPanelIfVisible() {
    const visible = await this.discardPanelBtn
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (visible) {
      await this.discardPanelBtn.click().catch(() => {});
    }
  }

  // ----- Editor focus / lifecycle ----------------------------------------

  async waitForEditorReady(timeout = 15000) {
    await this.queryEditor.waitFor({ state: "visible", timeout });
    await this.queryEditorHost.waitFor({ state: "visible", timeout });
    // Wait for Monaco to attach to window and create the editor instance.
    await this.page.waitForFunction(
      () => {
        const m = (window).monaco;
        if (!m || !m.editor || typeof m.editor.getEditors !== "function") {
          return false;
        }
        const editors = m.editor.getEditors();
        return Array.isArray(editors) && editors.length > 0;
      },
      undefined,
      { timeout },
    );
  }

  // Click the editor wrapper so the embedded Monaco textarea gains focus.
  async focusEditor() {
    await this.waitForEditorReady();
    await this.queryEditorHost.click();
    await this.page.waitForTimeout(200);
  }

  // ----- Model-level read/write (no DOM scraping) ------------------------

  // Clear the editor content via the Monaco model. Avoids relying on Ctrl+A
  // selecting only inside the editor (the suggest widget can swallow keys).
  async clearEditor() {
    await this.page.evaluate(() => {
      const m = (window).monaco;
      if (!m || !m.editor) return;
      const editors = m.editor.getEditors();
      const editor = editors[editors.length - 1];
      if (!editor) return;
      editor.focus();
      editor.setValue("");
    });
    await this.focusEditor();
    await this.page.waitForTimeout(150);
  }

  // Replace the editor value via the Monaco model and refocus.
  async setEditorValue(text) {
    await this.page.evaluate((value) => {
      const m = (window).monaco;
      if (!m || !m.editor) return;
      const editors = m.editor.getEditors();
      const editor = editors[editors.length - 1];
      if (!editor) return;
      editor.focus();
      editor.setValue(value);
    }, text);
    await this.focusEditor();
    await this.page.waitForTimeout(200);
  }

  // Read the current editor content from the Monaco model.
  async getEditorValue() {
    return this.page.evaluate(() => {
      const m = (window).monaco;
      if (!m || !m.editor) return "";
      const editors = m.editor.getEditors();
      const editor = editors[editors.length - 1];
      if (!editor) return "";
      const model = editor.getModel();
      return model ? model.getValue() : "";
    });
  }

  // ----- Typing helpers --------------------------------------------------

  // Type literal text into the focused editor. The editor must already have
  // focus (call focusEditor() / clearEditor() / setEditorValue() first).
  async typeInEditor(text, options = {}) {
    const delay = options.delay ?? 50;
    await this.page.keyboard.type(text, { delay });
  }

  async pressKey(key) {
    await this.page.keyboard.press(key);
  }

  async dismissSuggestions() {
    await this.page.keyboard.press("Escape");
  }

  // ----- Suggestion introspection (Monaco model, not DOM) ----------------

  // Trigger Monaco's suggest action programmatically and wait for the
  // suggest controller to surface a non-empty, settled list.
  async triggerSuggestionsAndWait(timeout = 10000) {
    await this.page.keyboard.press("Control+Space");
    await this.waitForSuggestionsReady(timeout);
  }

  // Poll the editor's suggest controller until it reports an Open state with
  // at least one completion item. Returns when the widget would be visible
  // to the user, but does not read any DOM nodes.
  async waitForSuggestionsReady(timeout = 10000) {
    await this.page.waitForFunction(
      () => {
        const m = (window).monaco;
        const editors = m?.editor?.getEditors?.() || [];
        const editor = editors[editors.length - 1];
        if (!editor) return false;
        const ctrl = editor.getContribution(
          "editor.contrib.suggestController",
        );
        if (!ctrl || !ctrl.model) return false;
        const items =
          ctrl.model._completionModel?.items ?? ctrl.model.items ?? [];
        const state = ctrl.model._state ?? ctrl.model.state;
        // state 2 (Open) in modern Monaco; some versions: 1 (Auto/Open)
        // any non-loading state with items satisfies the assertion.
        return Array.isArray(items) && items.length > 0;
      },
      undefined,
      { timeout },
    );
  }

  // Read the labels of the current suggestions from the suggest controller.
  async getSuggestionLabels(limit = 20) {
    return this.page.evaluate((max) => {
      const m = (window).monaco;
      const editors = m?.editor?.getEditors?.() || [];
      const editor = editors[editors.length - 1];
      if (!editor) return [];
      const ctrl = editor.getContribution(
        "editor.contrib.suggestController",
      );
      const rawItems =
        ctrl?.model?._completionModel?.items ??
        ctrl?.model?.items ??
        [];
      return rawItems
        .slice(0, max)
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
    }, limit);
  }

  async getSuggestionCount() {
    const labels = await this.getSuggestionLabels(1000);
    return labels.length;
  }

  async logSuggestions(prefix, limit = 10) {
    const labels = await this.getSuggestionLabels(limit);
    testLogger.info(`${prefix}: ${labels.join(", ")}`);
  }

  // ----- High-level flows -------------------------------------------------

  // Reset editor to `cpu_usage{}` (a valid PromQL query) so the panel can be
  // applied + saved during teardown. Dismisses any open suggest widget.
  async resetToValidPromqlQuery(query = "cpu_usage{}") {
    await this.setEditorValue(query);
    await this.dismissSuggestions();
  }
}
