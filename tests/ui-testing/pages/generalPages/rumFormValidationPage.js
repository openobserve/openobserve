// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';

const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class RumFormValidationPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // ── Navigation ─────────────────────────────────────────────────────────────
    // RUM Source Maps upload page
    // Navigated to directly via URL

    // ── Upload form — Service field ────────────────────────────────────────────
    // OInput data-test="rum-upload-source-maps-service-input" → -field / -error
    this.serviceInput = page.locator('[data-test="rum-upload-source-maps-service-input-field"]');
    this.serviceError = page.locator('[data-test="rum-upload-source-maps-service-input-error"]');

    // ── Upload form — Version field ────────────────────────────────────────────
    // OInput data-test="rum-upload-source-maps-version-input" → -field / -error
    this.versionInput = page.locator('[data-test="rum-upload-source-maps-version-input-field"]');
    this.versionError = page.locator('[data-test="rum-upload-source-maps-version-input-error"]');

    // ── Upload form — Environment field (optional) ─────────────────────────────
    // OInput data-test="rum-upload-source-maps-environment-input" → -field
    this.environmentInput = page.locator('[data-test="rum-upload-source-maps-environment-input-field"]');

    // ── Upload form — File upload area ─────────────────────────────────────────
    // The clickable drop zone
    this.fileUploadArea = page.locator('[data-test="rum-upload-source-maps-file-dropzone"]');
    // The hidden <input type="file"> inside the dropzone
    this.fileInput = page.locator('[data-test="rum-upload-source-maps-file-input"]');
    // Inline file validation error (SourceMapDropzone) — after the OForm+zod
    // migration the "required" / "only .zip" file errors surface INLINE via the
    // schema (firstFieldError), not as a toast. Shown on submit.
    this.fileError = page.locator('[data-test="rum-upload-source-maps-file-error"]');
    // Toast locators — still used for the success path (and any server-side error).
    this.toastError = page.locator('[data-test-variant="error"]');
    this.toastMessage = page.locator('[data-test="o-toast-message"]');
    this.toastSuccess = page.locator('[data-test-variant="success"]');

    // ── Action bar buttons ─────────────────────────────────────────────────────
    this.uploadBtn  = page.locator('[data-test="rum-upload-source-maps-upload-btn"]');
    this.cancelBtn  = page.locator('[data-test="rum-upload-source-maps-cancel-btn"]');

    // ── Back button ────────────────────────────────────────────────────────────
    this.backBtn = page.locator('[data-test="add-alert-back-btn"]');
  }

  // ── Navigation ────────────────────────────────────────────────────────────────

  async navigateToUploadSourceMaps() {
    testLogger.debug('Navigating to RUM Upload Source Maps page via URL');
    const orgId   = process.env['ORGNAME']      || 'default';
    const baseUrl = process.env['ZO_BASE_URL']  || 'http://localhost:5080';
    await this.page.goto(`${baseUrl}/web/rum/upload-source-maps?org_identifier=${orgId}`);
    // The Upload button is the explicit page-ready signal (networkidle is
    // unreliable with streaming connections and is discouraged by Playwright).
    await this.uploadBtn.waitFor({ state: 'visible', timeout: 15000 });
    testLogger.debug('Upload Source Maps page ready');
  }

  // ── Form field actions ─────────────────────────────────────────────────────────

  async fillService(value) {
    testLogger.debug('Filling service name', { value });
    await this.serviceInput.fill(value);
  }

  async clearService() {
    testLogger.debug('Clearing service name');
    await this.serviceInput.clear();
  }

  async fillVersion(value) {
    testLogger.debug('Filling version', { value });
    await this.versionInput.fill(value);
  }

  async clearVersion() {
    testLogger.debug('Clearing version');
    await this.versionInput.clear();
  }

  async fillEnvironment(value) {
    testLogger.debug('Filling environment', { value });
    await this.environmentInput.fill(value);
  }

  /**
   * Attach a file by path using the hidden file input.
   * @param {string} filePath - Absolute path to the file on disk
   */
  async attachFile(filePath) {
    testLogger.debug('Attaching file to upload input', { filePath });
    await this.fileInput.setInputFiles(filePath);
  }

  async clickUpload() {
    testLogger.debug('Clicking Upload button');
    await this.uploadBtn.click();
  }

  async clickCancel() {
    testLogger.debug('Clicking Cancel button');
    await this.cancelBtn.click();
  }

  // ── Locator getters (for expect() assertions in spec) ──────────────────────────

  getServiceInputLocator()    { return this.serviceInput; }
  getServiceErrorLocator()    { return this.serviceError; }
  getVersionInputLocator()    { return this.versionInput; }
  getVersionErrorLocator()    { return this.versionError; }
  getEnvironmentInputLocator(){ return this.environmentInput; }
  getFileUploadAreaLocator()  { return this.fileUploadArea; }
  getFileErrorLocator()       { return this.fileError; }
  getUploadBtnLocator()       { return this.uploadBtn; }
  getCancelBtnLocator()       { return this.cancelBtn; }
  getToastErrorLocator()      { return this.toastError; }
  getToastMessageLocator()    { return this.toastMessage; }
  getToastSuccessLocator()    { return this.toastSuccess; }
}
