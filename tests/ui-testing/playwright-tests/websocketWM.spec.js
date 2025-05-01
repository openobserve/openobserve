import { test as base, expect } from '@playwright/test';


// Helper function to generate a random alphanumeric string
function generateRandomString(length) {
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }
    return result;
}

async function createUser(page, email, password) {
    const orgId = process.env["ORGNAME"];
    const url = `${process.env["ZO_BASE_URL"]}/api/${orgId}/users`;
    const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
    const headers = {
      "Authorization": `Basic Z29kQG1haW4uYWk6S2luZ3BpbiM0NTE=`,
      "Content-Type": "application/json",
    };

    const payload = {
      organization: orgId,
      email: email,
      password: password,
      first_name: "Shyam",
      last_name: "P",
      role: "admin",
    };  

    const response = await page.request.post(url, {
      data: payload,
      headers: headers,
    });
    console.log(basicAuthCredentials);
    console.log(process.env["ZO_ROOT_USER_EMAIL"]);
    console.log(process.env["ZO_ROOT_USER_PASSWORD"]);
    console.log(headers);

    console.log(`created user: ${email}`);
    console.log(orgId);
    console.log(url);
    console.log(response.status());
    console.log(response.body());
    console.log(payload);
    if (response.status() !== 200) {
        throw new Error(`Failed to create user ${email}. Status: ${response.status()}`);
    }

    console.log(`Successfully created user: ${email}`); 

    return response;
}


async function login(page, user, password) {
    await page.goto(process.env["ZO_BASE_URL"]);
    await page.waitForTimeout(4000);
    await page.getByText('Login as internal user').click();
    await page
        .locator('[data-cy="login-user-id"]')
        .fill(user);
    //Enter Password
    await page
        .locator('[data-cy="login-password"]')
        .fill(password);
    await page.locator('[data-cy="login-sign-in"]').click();
    await page.waitForTimeout(4000);
    await page.goto(process.env["ZO_BASE_URL"]);
    await page.waitForTimeout(5000)
}

async function checkWebSocket(page) {
    await page.goto(process.env["ZO_BASE_URL"] + "/web/?org_identifier=otlp-production");
    await page.waitForTimeout(2000);
    await page.locator('[data-test="menu-link-settings-item"]').click();
    //await page.getByLabel("General Settings").click();
    await expect(page.getByLabel('Enable Websocket Search')).toBeChecked();
    await page.waitForTimeout(4000);
}
async function dashBoardLoard(page) {
    await page.locator('[data-test="menu-link-/dashboards-item"]').click();
    await page.locator('[data-test="dashboard-search"]').type('Test Search');
    await page.goto(process.env["ZO_BASE_URL"] + "/web/dashboards?org_identifier=otlp-production&folder=default");
    await page.waitForTimeout(4000);
    await page.getByRole('cell', { name: '7307881789123463472' }).click();
    await page.waitForTimeout(5000);
    await page.locator('[data-test="dashboard-cancel-btn"]').click();
    await page.waitForTimeout(2000);
    await page.click('[data-test="date-time-btn"]');
    await page.waitForTimeout(2000);
    await page.click('[data-test="date-time-relative-3-h-btn"]');
    await page.waitForTimeout(2000);
    await page.locator('[data-test="date-time-apply-btn"]').click();
    await page.waitForTimeout(10000);
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(4000);
}
async function loadQuery(page) {
    await page.locator('[data-test="menu-link-/logs-item"]').click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="log-search-index-list-select-stream"]').type('default');
    await page.waitForTimeout(2000);
    await page.getByRole('switch', { name: 'SQL Mode' }).locator('div').nth(2).click();
    // await page.getByText('default').click({ force: true });
    await page.waitForTimeout(2000);
    await page.locator('[data-test="logs-search-bar-query-editor"] > .monaco-editor').click();
    await page.click('[data-test="logs-search-bar-query-editor"] > .monaco-editor')
    await page.keyboard.type(`SELECT _timestamp,event_cluster_id,_raw,event_kubernetes_host,event_kubernetes_labels_app,event_kubernetes_labels_version,event_kubernetes_namespace_name,event_kubernetes_pod_name,event_log from 'default' where event_kubernetes_host = 'worker-scus-lab-amlstest1-vmss000001'`);
    await page.waitForTimeout(2000);
    // await page.getByLabel("SQL Mode").locator("div").nth(2).click();
    // await page.waitForTimeout(2000);
    await page.click('[data-test="date-time-btn"]');
    await page.waitForTimeout(2000);
    await page.click('[data-test="date-time-relative-3-h-btn"]');
    await page.waitForTimeout(2000);
    await expect(page.locator(
        '[data-cy="search-bar-refresh-button"] > .q-btn__content')).toBeVisible(); await page.waitForTimeout(
            3000); await page.locator(
                "[data-test='logs-search-bar-refresh-btn']").click({ force: true });
    await page.waitForTimeout(10000);
}



// **Extend Playwright Test to Run in Different Chrome Windows**
const test = base.extend({
    browsers: async ({ browser }, use) => {
        const browserInstances = [];

        for (let i = 1; i <= 50; i++) { // Change 3 to the number of browser windows you want
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


    for (let i = 1; i <= 2; i++) {
        test(`Go to stream page after dashboard - user ${i}`, async ({ page }) => {
            const randomEmail = `${generateRandomString(7)}admin${i}@gmail.com`; // Generate random email for login
            const randomPassword = `${generateRandomString(7)}12345678`;
            await createUser(page, randomEmail, randomPassword);
            await page.setDefaultTimeout(300000);
            console.log(randomEmail);
            console.log(randomPassword);
            await login(page, randomEmail, randomPassword);
            await checkWebSocket(page);
            await dashBoardLoard(page);
            await loadQuery(page);
        });

        test(`Wait for Cancel button to disappear- user ${i}`, async ({ page }) => {
            const randomEmail = `${generateRandomString(7)}admin${i}@gmail.com`; // Generate random email for login
            const randomPassword = `${generateRandomString(7)}12345678`;
            await createUser(page, randomEmail, randomPassword);
            await page.setDefaultTimeout(300000);
            console.log(randomEmail);
            console.log(randomPassword);
            await login(page, randomEmail, randomPassword);
            await checkWebSocket(page);

            await dashBoardLoard(page);
            (await page.waitForSelector('[data-test="dashboard-refresh-btn"]')).isVisible();
            await page.waitForTimeout(2000);
        });

        test(`Go to streams after dashboard- user ${i}`, async ({ page }) => {
            const randomEmail = `${generateRandomString(7)}admin${i}@gmail.com`; // Generate random email for login
            const randomPassword = `${generateRandomString(7)}12345678`;
            await createUser(page, randomEmail, randomPassword);
            await page.setDefaultTimeout(300000);
            console.log(randomEmail);
            console.log(randomPassword);
            await login(page, randomEmail, randomPassword);
            await checkWebSocket(page);

            await dashBoardLoard(page);
            await page.locator('[data-test="menu-link-/streams-item"]').click();
            await page.waitForTimeout(2000);


            // expect response within time limit
            // validate the search result count of the search, should expect some no of result

        });
    }
});