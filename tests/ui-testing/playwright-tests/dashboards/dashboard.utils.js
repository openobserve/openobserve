export async function waitForDateTimeButtonToBeEnabled(page) {
    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', { timeout: 15000 });
}