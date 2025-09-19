import { exec } from 'child_process';
import { test } from '@playwright/test';
import { expect } from '@playwright/test';

// Common Locator exports
export var dateTimeButtonLocator='[data-test="date-time-btn"]';
export var relative30SecondsButtonLocator='[data-test="date-time-relative-30-s-btn"]';
export var absoluteTabLocator='[data-test="date-time-absolute-tab"]';
export var Past30SecondsValue='Past 30 Seconds';
export var startTimeValue='01:01:01';
export var endTimeValue='02:02:02';
export var startDateTimeValue='2024/10/01 01:01:01';
export var endDateTimeValue='2024/10/01 02:02:02';

export class CommonActions {
    constructor(page) {
        this.page = page;
        
        // Navigation locators
        this.alertsMenuItem = '[data-test="menu-link-\\/alerts-item"]';
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
        this.homeMenuItem = '[data-test="menu-link-\\/-item"]';
    }

    async navigateToAlerts() {
        await this.page.locator(this.alertsMenuItem).click();
        await this.page.waitForTimeout(2000);
        await expect(this.page.locator('[data-test="alerts-list-title"]')).toContainText('Alerts');
    }

    async navigateToSettings() {
        await this.page.locator(this.settingsMenuItem).click();
        await this.page.waitForTimeout(2000);
    }

    async navigateToHome() {
        await this.page.locator(this.homeMenuItem).click();
        await this.page.waitForTimeout(2000);
    }

    /**
     * Helper method to scroll through a dropdown to find and click an option
     * @param {string} optionName - Name of the option to find
     * @param {string} optionType - Type of option ('template' or 'folder')
     * @returns {Promise<boolean>} - Whether the option was found
     */
    async scrollAndFindOption(optionName, optionType) {
        // Use more specific locator to target the visible dropdown to avoid strict mode violation
        const dropdown = this.page.locator('.q-menu:visible').first();
        let optionFound = false;
        let maxScrolls = 50;
        let scrollAmount = 1000;
        let totalScrolled = 0;

        while (!optionFound && maxScrolls > 0) {
            try {
                // Try to find and click the option
                const option = optionType === 'template' 
                    ? this.page.getByText(optionName, { exact: true })
                    : this.page.getByRole('option', { name: optionName });
                
                if (await option.isVisible()) {
                    if (optionType === 'template') {
                        await option.click();
                    } else {
                        await option.locator('span').click();
                    }
                    optionFound = true;
                    console.log(`Found ${optionType} after scrolling: ${optionName}`);
                    await this.page.waitForTimeout(500);
                } else {
                    // Get the current scroll position and height
                    const { scrollTop, scrollHeight, clientHeight } = await dropdown.evaluate(el => ({
                        scrollTop: el.scrollTop,
                        scrollHeight: el.scrollHeight,
                        clientHeight: el.clientHeight
                    }));

                    // If we've scrolled to the bottom, start from the top again
                    if (scrollTop + clientHeight >= scrollHeight) {
                        await dropdown.evaluate(el => el.scrollTop = 0);
                        totalScrolled = 0;
                        await this.page.waitForTimeout(500);
                    } else {
                        // Scroll down
                        await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                        totalScrolled += scrollAmount;
                        await this.page.waitForTimeout(500);
                    }
                    maxScrolls--;
                }
            } catch (error) {
                // If option not found, scroll and try again
                await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                totalScrolled += scrollAmount;
                await this.page.waitForLoadState('networkidle');
                maxScrolls--;
            }
        }

        if (!optionFound) {
            console.error(`Failed to find ${optionType} ${optionName} after scrolling ${totalScrolled}px`);
            throw new Error(`${optionType} ${optionName} not found in dropdown after scrolling`);
        }

        return optionFound;
    }

    async ingestTestData(streamName) {
        const curlCommand = `curl -u ${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]} -k ${process.env["ZO_BASE_URL"]}/api/default/${streamName}/_json -d '[{"level":"info","job":"test","log":"test message for openobserve. this data ingestion has been done using a playwright automation script."}]'`;
        
        return new Promise((resolve, reject) => {
            exec(curlCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error executing curl command:', error);
                    reject(error);
                    return;
                }
                console.log('Curl command response:', stdout);
                console.log('Successfully ingested test data');
                resolve();
            });
        });
    }

    async ingestCustomTestData(streamName) {
        const curlCommand = `curl -u ${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]} -k ${process.env["ZO_BASE_URL"]}/api/default/${streamName}/_json -d @utils/td150.json`;
        
        return new Promise((resolve, reject) => {
            exec(curlCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error executing curl command:', error);
                    reject(error);
                    return;
                }
                console.log('Custom curl command response:', stdout);
                console.log('Successfully ingested custom test data');
                resolve();
            });
        });
    }

    /**
     * Helper method to conditionally ingest test data based on test title
     * Skips data ingestion for scheduled alert tests
     * @param {string} testTitle - The title of the current test
     * @param {string} streamName - The stream name for data ingestion
     */
    async skipDataIngestionForScheduledAlert(testTitle, streamName = 'auto_playwright_stream') {
        // Skip data ingestion for scheduled alert test
        if (!testTitle.includes('Scheduled Alert')) {
            // Ingest test data using common actions
            await this.ingestTestData(streamName);
        }
    }

    // Dismiss any blocking overlays/modals that might intercept clicks
    async dismissBlockingOverlays() {
        for (let i = 0; i < 3; i += 1) {
            const backdrop = this.page.locator('.q-dialog__backdrop');
            const count = await backdrop.count();
            const visible = count > 0 ? await backdrop.first().isVisible().catch(() => false) : false;
            if (!visible) break;
            await this.page.keyboard.press('Escape').catch(() => {});
            await backdrop.first().waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
            await this.page.waitForTimeout(150);
        }
    }

    // Return boolean streaming state from Organization settings toggle
    async getStreamingState() {
        const root = this.page.locator('[data-test="general-settings-enable-streaming"]').first();
        await root.waitFor({ state: 'visible', timeout: 10000 });
        const ariaChecked = await root.getAttribute('aria-checked');
        return ariaChecked === 'true';
    }

    // Flip streaming toggle, save, wait for toast, reload, and verify state
    async flipStreaming() {
        await this.dismissBlockingOverlays();
        try {
            await this.page.locator('[data-test="menu-link-settings-item"]').click();
        } catch {
            await this.page.reload().catch(() => {});
            await this.page.waitForTimeout(300);
            await this.dismissBlockingOverlays();
            await this.page.locator('[data-test="menu-link-settings-item"]').click();
        }
        const isOn = await this.getStreamingState();
        await this.page.locator('[data-test="general-settings-enable-streaming"] div').nth(2).click();
        await this.page.locator('[data-test="dashboard-add-submit"]').click();
        await this.page.getByText('Organization settings updated', { exact: false }).waitFor({ timeout: 15000 });
        await this.page.reload();
        const newState = await this.getStreamingState();
        console.log(`[Streaming Toggle] ${isOn ? 'ON' : 'OFF'} -> ${newState ? 'ON' : 'OFF'}`);
    }
} 