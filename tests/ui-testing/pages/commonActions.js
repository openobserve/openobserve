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
        const dropdown = this.page.locator('.q-menu');
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
                    await this.page.waitForTimeout(1000);
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
                        await this.page.waitForTimeout(1000);
                    } else {
                        // Scroll down
                        await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                        totalScrolled += scrollAmount;
                        await this.page.waitForTimeout(1000);
                    }
                    maxScrolls--;
                }
            } catch (error) {
                // If option not found, scroll and try again
                await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                totalScrolled += scrollAmount;
                await this.page.waitForTimeout(1000);
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
} 