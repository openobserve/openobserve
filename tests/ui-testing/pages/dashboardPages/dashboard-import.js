//Dashboard Import Page Object
//Methods: Import dashboard, import button, input files, delete imported dashboard
import { expect } from "@playwright/test";

export default class DashboardImport {
  constructor(page) {
    this.page = page;

    this.importButton = page.locator('[data-test="dashboard-import"]');
    this.importButtonByRole = page.locator(
      '[data-test="dashboard-import-submit-btn"]'
    );
    // OFile forwards its `data-test` onto the native input as `${parent}-field`.
    this.inputFile = page.locator(
      '[data-test="dashboard-import-file-control-field"]'
    );
    this.cancelButton = page.locator(
      '[data-test="dashboard-import-cancel-btn"]'
    );
    this.urlInputField = page.locator(
      '[data-test="dashboard-import-url-control-field"]'
    );
    this.titleInputField = page.locator(
      '[data-test="dashboard-import-error-title-control-field"]'
    );
    this.jsonFileEditor = page.locator(
      '[data-test="dashboard-import-json-file-editor"]'
    );
    this.urlEditor = page.locator(
      '[data-test="dashboard-import-url-editor"]'
    );
    this.importErrorContainer = page.locator(
      '[data-test="dashboard-import-error-container"]'
    );
    this.importErrorMessage = page.locator(
      '[data-test="dashboard-import-error-message"]'
    );
    this.importErrorTitleMessage = page.locator(
      '[data-test="dashboard-import-error-title-message"]'
    );
    this.importErrorValidationMessage = page.locator(
      '[data-test="dashboard-import-error-validation-message"]'
    );
    this.fileRejectedResult = page.locator(
      '[data-test="dashboard-import-file-rejected"]'
    );
    this.toastErrorMessage = page.locator(
      '[data-test-variant="error"] [data-test="o-toast-message"]'
    );
    this.dashboardTable = page.locator('[data-test="dashboard-table"]');
    this.confirmDialog = page.locator(
      '[data-test="dashboard-confirm-dialog"]'
    );
    this.confirmDeleteFolderDialog = page.locator(
      '[data-test="dashboard-confirm-delete-folder-dialog"]'
    );
  }

  //Import dashboard button on dashboard page
  async clickImportDashboard() {
    await this.importButton.waitFor({ state: "visible", timeout: 15000 });
    await this.importButton.click();
    // Import button is now a dropdown — click the "Custom" option
    const customOption = this.page.locator('[data-test="dashboard-import-custom"]');
    await customOption.waitFor({ state: "visible", timeout: 10000 });
    await customOption.click();
    await this.page.locator('[data-test="tab-import_json_file"]').waitFor({ state: "visible", timeout: 10000 });
    await this.inputFile.waitFor({ state: "attached", timeout: 10000 });
  }

  //click import button
  async clickImportButton() {
    await this.importButtonByRole.waitFor({ state: "visible" });
    await this.importButtonByRole.click();
  }

  //click cancel button on the import page
  async clickCancelButton() {
    await this.cancelButton.waitFor({ state: "visible" });
    await this.cancelButton.click();
  }

  // Import dashboard file
  async uploadDashboardFile(fileContentPath) {
    const fileTab = this.page.locator('[data-test="tab-import_json_file"]');
    try {
      await fileTab.waitFor({ state: "visible", timeout: 10000 });
      await fileTab.click({ timeout: 10000 });
      await this.inputFile.waitFor({ state: "attached", timeout: 10000 });
    } catch (error) {
      // Tab might already be active, continue
    }

    // The file control renders the underlying input as hidden — wait for
    // `attached` (not visible) since setInputFiles works on hidden inputs.
    await this.inputFile.waitFor({ state: "attached", timeout: 20000 });

    // Retry file upload
    let retries = 3;
    while (retries > 0) {
      try {
        await this.inputFile.setInputFiles(fileContentPath, { timeout: 10000 });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await this.inputFile.waitFor({ state: "attached", timeout: 5000 });
      }
    }

    // Wait for JSON editor container to mount.
    await this.jsonFileEditor.waitFor({ state: "visible", timeout: 10000 });
  }

  // Click URL import tab with retry logic
  async clickUrlImportTab() {
    const urlTab = this.page.locator('[data-test="tab-import_json_url"]');
    await urlTab.waitFor({ state: "visible", timeout: 30000 });

    let retries = 5;
    while (retries > 0) {
      try {
        await urlTab.click({ timeout: 10000 });
        await this.urlInputField.waitFor({ state: "visible", timeout: 10000 });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        // Re-wait for tab — give the tab strip up to 15s to re-mount in
        // case the previous test's navigation/teardown is still in flight.
        await urlTab.waitFor({ state: "visible", timeout: 15000 });
      }
    }
  }

  // Fill the URL import input
  async fillUrlImport(urlValue) {
    await this.urlInputField.waitFor({ state: "visible", timeout: 10000 });
    await this.urlInputField.fill(urlValue);
  }

  // Click Dashboard Title input in the error validation dialog
  async clickDashboardTitleInput() {
    await this.titleInputField.waitFor({ state: "visible", timeout: 10000 });
    await this.titleInputField.click();
  }

  // Fill Dashboard Title input in the error validation dialog
  async fillDashboardTitleInput(title) {
    await this.titleInputField.waitFor({ state: "visible", timeout: 10000 });
    await this.titleInputField.fill(title);
  }

  // Remove a previously uploaded file by its chip index (defaults to first chip)
  async removeUploadedFile(index = 0) {
    const removeBtn = this.page.locator(
      `[data-test="o-file-chip-${index}-remove-btn"]`
    );
    await removeBtn.waitFor({ state: "visible", timeout: 5000 });
    await removeBtn.click();
  }

  // Assert a file chip is not present at the given index
  async expectFileChipAbsent(index = 0) {
    await expect(
      this.page.locator(`[data-test="o-file-chip-${index}"]`)
    ).not.toBeVisible();
  }

  // Read the full text content of an import editor (file or url).
  // Preferred path: read directly from the Monaco model via
  // `window.monaco.editor.getModels()` (exposed by CodeQueryEditor for e2e).
  // Fallback: scrape the editor host DOM. `kind` selects which container
  // to fall back to (`file` vs `url`).
  async readEditorText(kind = "file") {
    const containerDataTest =
      kind === "url"
        ? "dashboard-import-url-editor"
        : "dashboard-import-json-file-editor";
    return await this.page.evaluate((containerSelector) => {
      // Prefer Monaco's model so we read the actual source text (the DOM
      // virtualizes long content and may not contain every line).
      const w = window;
      if (w.monaco && w.monaco.editor) {
        const models = w.monaco.editor.getModels();
        if (models && models.length) {
          // If multiple models exist, prefer the one whose DOM editor
          // sits inside our container.
          const container = document.querySelector(
            `[data-test="${containerSelector}"]`,
          );
          if (container) {
            const editors = w.monaco.editor.getEditors
              ? w.monaco.editor.getEditors()
              : [];
            for (const ed of editors) {
              const node = ed.getDomNode && ed.getDomNode();
              if (node && container.contains(node)) {
                return ed.getModel().getValue();
              }
            }
          }
          return models[0].getValue();
        }
      }
      const host = document.querySelector(
        `[data-test="${containerSelector}"]`,
      );
      if (!host) return "";
      return host.innerText || host.textContent || "";
    }, containerDataTest);
  }

  // Extract the JSON `"title"` value as rendered in the file editor.
  async readImportedJsonTitle() {
    const text = await this.readEditorText("file");
    const match = text.match(/"title"\s*:\s*"([^"]+)"/);
    return match ? match[1] : "";
  }

  // Wait until the editor contains a token (e.g. '"dashboardId":')
  // URL imports fetch a remote dashboard JSON over the network, which can take
  // noticeably longer than a local file read — give them a larger default window.
  async waitForEditorContains(token, kind = "file", timeout = kind === "url" ? 30000 : 15000) {
    await expect(async () => {
      const text = await this.readEditorText(kind);
      if (!text.includes(token)) {
        throw new Error(`editor did not contain ${token}`);
      }
    }).toPass({ timeout });
  }

  // Click the dashboard name cell by its visible name to open the dashboard
  async openImportedDashboardByName(dashboardName) {
    const cell = this.page.locator(
      `[data-test="dashboard-name-cell-${dashboardName}"]`
    );
    await cell.first().waitFor({ state: "visible", timeout: 20000 });
    await cell.first().click();
  }

  // Assert that an imported dashboard appears in the list by visible name
  async expectImportedDashboardVisible(dashboardName, timeout = 20000) {
    const cell = this.page.locator(
      `[data-test="dashboard-name-cell-${dashboardName}"]`
    );
    await expect(cell.first()).toBeVisible({ timeout });
  }

  // Delete the Only imported dashboard
  async deleteImportedDashboard(prefix, dashboardName) {
    await this.dashboardTable.waitFor({ state: "visible", timeout: 20000 });

    const dashboardCell = this.page.locator(
      `[data-test="dashboard-name-cell-${dashboardName}"]`
    );
    await dashboardCell.first().waitFor({ state: "visible", timeout: 15000 });

    // Walk up from the named cell to the OTable row via XPath ancestor that
    // matches `data-test^="o2-table-row-"`. Then resolve the delete button
    // inside that row using its `data-test="dashboard-delete"` hook.
    const dashboardRow = dashboardCell
      .first()
      .locator(
        'xpath=ancestor::*[starts-with(@data-test, "o2-table-row-")][1]'
      );
    const deleteButton = dashboardRow.locator(
      '[data-test="dashboard-delete"]'
    );

    let deleteRetries = 3;
    while (deleteRetries > 0) {
      try {
        await dashboardRow.hover();
        await deleteButton.waitFor({ state: "visible", timeout: 10000 });
        await deleteButton.click({ timeout: 10000 });
        await this.confirmDialog
          .locator('[data-test="o-dialog-primary-btn"]')
          .waitFor({ state: "visible", timeout: 5000 });
        break;
      } catch (error) {
        deleteRetries--;
        if (deleteRetries === 0) throw error;
        await dashboardCell
          .first()
          .waitFor({ state: "visible", timeout: 5000 });
      }
    }

    await this.confirmDialog
      .locator('[data-test="o-dialog-primary-btn"]')
      .click({ timeout: 10000 });

    // Verify deletion
    try {
      await dashboardCell
        .first()
        .waitFor({ state: "detached", timeout: 10000 });
    } catch {
      try {
        await this.page
          .waitForLoadState("networkidle", { timeout: 5000 })
          .catch(() => {});
      } catch {
        try {
          await dashboardCell
            .first()
            .waitFor({ state: "hidden", timeout: 5000 });
        } catch {
          console.warn(
            `Could not verify deletion of dashboard: ${dashboardName}`
          );
        }
      }
    }
  }

  // Assert the "File(s) Failed to Import" toast AND the per-file rejected
  // span both contain expected text. The per-file rejected span is rendered
  // by Vue on the next tick after the toast notification — wait for the
  // wrapper container before asserting its child text.
  async expectFileRejectedWithToast(toastText, rejectedText) {
    const results = this.page.locator(
      '[data-test="dashboard-import-file-results"]'
    );
    await expect(this.toastErrorMessage).toContainText(toastText);
    await results.waitFor({ state: "attached", timeout: 15000 });
    await expect(this.fileRejectedResult).toContainText(rejectedText);
  }

  // Folder workflows
  async openCreateFolderDrawerFromMove() {
    await this.page
      .locator('[data-test="dashboard-folder-move-new-add"]')
      .click();
  }

  async fillNewFolderName(folderName) {
    // OFormInput → OInput forwards `data-test` to its inner native input as
    // `${parent}-field`. The wrapper data-test resolves to a <div>, the
    // fillable input is at `…-field`.
    const nameInput = this.page.locator(
      '[data-test="dashboard-folder-add-name-field"]'
    );
    await nameInput.waitFor({ state: "visible", timeout: 10000 });
    await nameInput.click();
    await nameInput.fill(folderName);
  }

  async confirmFolderMoveDrawer() {
    await this.page
      .locator(
        '[data-test="dashboard-folder-move-dialog"] [data-test="o-dialog-primary-btn"]'
      )
      .click();
  }

  async deleteFolderByName(folderName) {
    // Navigate to the dashboards root to ensure FolderList is fully rendered
    // and the folder sidebar tabs are visible before looking for the target folder.
    const orgName = process.env["ORGNAME"];
    await this.page.goto(
      `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${orgName}`
    );
    await this.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    const folderTab = this.page.locator(
      `[data-test="dashboard-folder-tab-name-${folderName}"]`
    );
    await folderTab.waitFor({ state: "visible", timeout: 20000 });
    await folderTab.hover();
    await folderTab.locator('[data-test="dashboard-more-icon"]').click();
    await this.page
      .locator('[data-test="dashboard-delete-folder-icon"]')
      .click();
    await this.confirmDeleteFolderDialog
      .locator('[data-test="o-dialog-primary-btn"]')
      .click();
  }

  async expectFolderAbsent(folderName) {
    await expect(
      this.page.locator(
        `[data-test="dashboard-folder-tab-name-${folderName}"]`
      )
    ).toHaveCount(0);
  }
}
