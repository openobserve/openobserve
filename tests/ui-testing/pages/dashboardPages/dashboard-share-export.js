//Dashboard Share and Export Page Object
//Methods: Share dashboard, Export dashboard, Share and capture short URL
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export default class DashboardShareExportPage {
  constructor(page) {
    this.page = page;
    this.shareBtn = page.locator('[data-test="dashboard-share-btn"]');
    this.exportBtn = page.locator('[data-test="dashboard-download-btn"]');
  }

  //share dashboard
  async shareDashboard() {
    await this.page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });
    await this.shareBtn.click();
  }

  /**
   * Share dashboard and capture the short URL from the API response.
   * Intercepts the POST /short API call to extract the original and short URLs.
   * @returns {{ shortUrl: string, originalUrl: string }} The captured URLs with port corrected for test env
   */
  async shareDashboardAndCaptureUrl() {
    await this.page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });

    const shortenResponsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes("/short") &&
        response.request().method() === "POST",
    );

    await this.shareBtn.click();

    const shortenResponse = await shortenResponsePromise;
    const responseData = await shortenResponse.json();
    const shortUrl = responseData.short_url.replace(":8081", ":5080");

    // Extract original URL from request body
    const requestBody = JSON.parse(shortenResponse.request().postData());
    const originalUrl = requestBody.original_url;

    testLogger.info('Share URL captured', { shortUrl, originalUrl });

    return { shortUrl, originalUrl };
  }

  //Export dashboard
  async exportDashboard() {
    await this.page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });
    await this.exportBtn.click();
  }
}
