import { test as base, expect } from '@playwright/test';

async function login(page, user) {
    //await page.goto(`https://main.dev.zinclabs.dev/web/logs?org_identifier=otlp-production`);
    await page.goto("https://main.dev.zinclabs.dev");
    await page.waitForTimeout(2000);
    await page.getByText('Login as internal user').click();
    await page
        .locator('[data-cy="login-user-id"]')
        .fill(user);
    //Enter Password
    const pass = process.env["ZO_ROOT_USER_PASSWORD"];
    console.log(pass);
    await page
        .locator('[data-cy="login-password"]')
        .fill('a');
    await page.locator('[data-cy="login-sign-in"]').click();
    await page.waitForTimeout(2000);
    await page.goto("https://main.dev.zinclabs.dev/web");
    await page.waitForTimeout(2000)
}

async function checkWebSocket(page) {
    await page.goto('https://main.dev.zinclabs.dev/web/logs?org_identifier=otlp-production');
    await page.waitForTimeout(2000);
    await page.locator('[data-test="menu-link-settings-item"]').click();
    //await page.getByLabel("General Settings").click();
    await expect(page.getByLabel('Enable Websocket Search')).toBeChecked();
    await page.waitForTimeout(2000);
}
async function dashBoardLoard(page) {
    await page.locator('[data-test="menu-link-/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-search"]').type('default_stream');
    await page.goto('https://main.dev.zinclabs.dev/web/dashboards/view?org_identifier=otlp-production&dashboard=7307881789123463472&folder=default&tab=default&refresh=5s&period=4w&var-Dynamic+filters=%255B%255D&print=false');
    await page.waitForTimeout(2000);
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(20000);
}
async function loadQuery(page) {
    await page.locator('[data-test="menu-link-/logs-item"]').click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="logs-search-bar-query-editor"] > .monaco-editor').click();
    await page.click('[data-test="logs-search-bar-query-editor"] > .monaco-editor')
    await page.keyboard.type(`SELECT k8s_cluster, _timestamp, k8s_deployment_name FROM "default"`);
    await page.waitForTimeout(2000);
    await page.getByRole('switch', { name: 'SQL Mode' }).locator('div').first();
    await page.waitForTimeout(2000);
    await page.click('[data-test="date-time-btn"]');
    await page.waitForTimeout(2000);
    await page.click('[data-test="date-time-relative-3-h-btn"]');
    await page.waitForTimeout(2000);
    await expect(page.locator(
        '[data-cy="search-bar-refresh-button"] > .q-btn__content')).toBeVisible(); await page.waitForTimeout(
            3000); await page.locator(
                "[data-test='logs-search-bar-refresh-btn']").click({ force: true });
    await page.waitForTimeout(2000);
}





// **Extend Playwright Test to Run in Different Chrome Windows**
const test = base.extend({
    browsers: async ({ browser }, use) => {
        const browserInstances = [];

        for (let i = 1; i <= 3; i++) { // Change 3 to the number of browser windows you want
            const context = await browser.newContext();
            browserInstances.push(context);
        }

        await use(browserInstances);

        for (const context of browserInstances) {
            await context.close();
        }
    },
});

test.describe("Sanity testcases", () => {

    test.beforeEach(async ({ browsers }, testInfo) => {
        const browserIndex = testInfo.workerIndex % browsers.length; // Distribute pages among browsers
        testInfo.page = await browsers[browserIndex].newPage();
        testInfo.page.setDefaultTimeout(300000);
    });



    for (let i = 1; i <= 50; i++) {
        test(`Go to stream page after dashboard - user ${i}`, async ({ page }) => {

            await page.setDefaultTimeout(300000);
            await login(page, `x_a${i}@a.com`);
            await checkWebSocket(page);
            await dashBoardLoard(page);
            // await loadQuery(page);
        });

        // test(`Wait for Cancel button to disappear- user ${i}`, async ({ page }) => {

        //     await page.setDefaultTimeout(300000);
        //     await login(page, `svcloadtest${i}@openobserve.ai`);
        //     await checkWebSocket(page);

        //     await dashBoardLoard(page);
        //     (await page.waitForSelector('[data-test="dashboard-refresh-btn"]')).isVisible();
        //     await page.waitForTimeout(2000);
        // });

        test(`Go to streams after dashboard- user ${i}`, async ({ page }) => {

            await page.setDefaultTimeout(300000);
            await login(page, `svcloadtest${i}@openobserve.ai`);
            await checkWebSocket(page);

            await dashBoardLoard(page);
            await page.locator('[data-test="menu-link-/streams-item"]').click();
            await page.waitForTimeout(2000);



            // expect response within time limit
            // validate the search result count of the search, should expect some no of result

        });
    }
});