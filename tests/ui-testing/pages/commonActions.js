import { exec } from 'child_process';

export class CommonActions {
    constructor(page) {
        this.page = page;
        
        // Navigation locators
        this.alertsMenuItem = '[data-test="menu-link-\\/alerts-item"]';
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
    }

    async navigateToAlerts() {
        await this.page.locator(this.alertsMenuItem).click();
        await this.page.waitForTimeout(2000);
    }

    async navigateToSettings() {
        await this.page.locator(this.settingsMenuItem).click();
        await this.page.waitForTimeout(2000);
    }

    async ingestTestData(streamName) {
        const curlCommand = `curl -u ${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]} -k ${process.env["ZO_BASE_URL"]}/api/default/${streamName}/_json -d '[{"level":"info","job":"test","log":"test message for openobserve. this data ingestion has been done using a playwright automated script."}]'`;
        
        return new Promise((resolve, reject) => {
            exec(curlCommand, (error, stdout) => {
                if (error) {
                    console.error(`Error executing curl command: ${error}`);
                    reject(error);
                    return;
                }
                console.log('Curl command response:', stdout);
                console.log('Successfully ingested test data');
                resolve(stdout);
            });
        });
    }

    async ingestCustomTestData(streamName) {
        const curlCommand = `curl -u ${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]} -k ${process.env["ZO_BASE_URL"]}/api/default/${streamName}/_json -d @utils/td150.json`;
        
        return new Promise((resolve, reject) => {
            exec(curlCommand, (error, stdout) => {
                if (error) {
                    console.error(`Error executing curl command: ${error}`);
                    reject(error);
                    return;
                }
                console.log('Custom curl command response:', stdout);
                console.log('Successfully ingested custom test data');
                resolve(stdout);
            });
        });
    }
} 