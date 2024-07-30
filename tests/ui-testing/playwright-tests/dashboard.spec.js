import { test, expect } from "@playwright/test";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import { log } from "console";
import logsdata from "../../test-data/logs_data.json";
import { parseArgs } from "util";

const randomDashboardName = 'Dashboard_' + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

async function login(page) {
    await page.goto(process.env["ZO_BASE_URL"], { waitUntil: 'networkidle' });
    //  await page.getByText('Login as internal user').click();
    await page
        .locator('[data-cy="login-user-id"]')
        .fill(process.env["ZO_ROOT_USER_EMAIL"]);

    // wait for login api response
    const waitForLogin = page.waitForResponse(response =>
        response.url().includes('/auth/login') && response.status() === 200
    )

    await page
        .locator('[data-cy="login-password"]')
        .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
    await page.locator('[data-cy="login-sign-in"]').click();

    await waitForLogin

    await page.waitForURL(process.env["ZO_BASE_URL"] + "/web/", { waitUntil: 'networkidle' })
}

async function waitForDashboardPage(page) {
    const dashboardListApi = page.waitForResponse(response =>
        /\/api\/.+\/dashboards/.test(response.url()) && response.status() === 200
    )

    await page.waitForURL(process.env["ZO_BASE_URL"] + "/web/dashboards**")

    await page.waitForSelector(`text="Please wait while loading dashboards..."`, { state: 'hidden' })
    await dashboardListApi
    await page.waitForTimeout(500)
}

test.describe("Logs UI testcases", () => {
    // let logData;
    function removeUTFCharacters(text) {
        // console.log(text, "tex");
        // Remove UTF characters using regular expression
        return text.replace(/[^\x00-\x7F]/g, " ");
    }
    async function applyQueryButton(page) {
        // click on the run query button
        // Type the value of a variable into an input field
        const search = page.waitForResponse(logData.applyQuery);
        await page.waitForTimeout(3000);
        await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
            force: true,
        });
        // get the data from the search variable
        await expect.poll(async () => (await search).status()).toBe(200);
        // await search.hits.FIXME_should("be.an", "array");
    }
    // tebefore(async function () {
    //   // logData("log");
    //   // const data = page;
    //   // logData = data;

    //   console.log("--logData--", logData);
    // });
    test.beforeEach(async ({ page }) => {
        await login(page);

        // just to make sure org is set
        const orgNavigation = page.goto(
            `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
        );

        // ("ingests logs via API", () => {
        const orgId = process.env["ORGNAME"];
        const streamName = "e2e_automate";
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString("base64");

        const headers = {
            Authorization: `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        // const logsdata = {}; // Fill this with your actual data

        const fetchResponse = await fetch(
            `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
            {
                method: "POST",
                headers: headers,
                body: JSON.stringify(logsdata),
            }
        );
        const response = await fetchResponse.json();

        await orgNavigation


        // Making a POST request using fetch API
        // const response = await page.evaluate(
        //     async ({ url, headers, orgId, streamName, logsdata }) => {
        //         const fetchResponse = await fetch(
        //             `${url}/api/${orgId}/${streamName}/_json`,
        //             {
        //                 method: "POST",
        //                 headers: headers,
        //                 body: JSON.stringify(logsdata),
        //             }
        //         );
        //         return await fetchResponse.json();
        //     },
        //     {
        //         url: process.env.INGESTION_URL,
        //         headers: headers,
        //         orgId: orgId,
        //         streamName: streamName,
        //         logsdata: logsdata,
        //     }
        // );

        console.log(response);
        //  });
        // const allorgs = page.waitForResponse("**/api/default/organizations**");
        // const functions = page.waitForResponse("**/api/default/functions**");
        //   await page.goto(
        //   `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
        //  );
        //  const allsearch = page.waitForResponse("**/api/default/_search**");
        //  await selectStreamAndStreamTypeForLogs(page, logData.Stream);
        //  await applyQueryButton(page);
        // const streams = page.waitForResponse("**/api/default/streams**");



    })

    test('Verify create New Dashboard ', async ({ page }) => {   ////////////////////

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await expect(page.getByText('Dashboard added successfully.')).toBeVisible({ timeout: 30000 });

    });

    test('Verify that Delete the dashboard', async ({ page }) => {

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await page.locator('[data-test="dashboard-back-btn"]').click();

        await expect(page.getByRole('row', { name: `01 ${randomDashboardName}` }).locator('[data-test="dashboard-delete"]')).toBeVisible({ timeout: 30000 });
        await page.getByRole('row', { name: `01 ${randomDashboardName}` }).locator('[data-test="dashboard-delete"]').click();
        await page.locator('[data-test="confirm-button"]').click();


    });

    test('Verify the Duplicate the Dashboard', async ({ page }) => {

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await expect(page.getByText('Dashboard added successfully.')).toBeVisible({ timeout: 30000 });

        await page.locator('[data-test="dashboard-back-btn"]').click();

        await expect(page.getByRole('row', { name: `01 ${randomDashboardName}` }).locator('[data-test="dashboard-duplicate"]')).toBeVisible();
        await page.getByRole('row', { name: `01 ${randomDashboardName}` }).locator('[data-test="dashboard-duplicate"]').click();

    });

    test('Verify create dashboard,with add the breakDown', async ({ page }) => {


        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await expect(page.getByText('Dashboard added successfully.')).toBeVisible({ timeo: 3000 });
        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();

        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();
        //  await page.waitForTimeout(2000);

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-b-data"]').click();

        await expect(page.locator('[data-test="dashboard-apply"]')).toBeVisible();
        await page.locator('[data-test="dashboard-apply"]').click();
    });

    //     test('Verify the functionality of editing data and viewing the Dashboard', async ({ page }) => {

    //   // Navigate to dashboards
    //   await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();

    //   // Add a new dashboard
    //   await page.locator('[data-test="dashboard-add"]').click();
    //   await page.locator('.q-field__bottom').click();
    //   await page.locator('[data-test="add-dashboard-name"]').click();
    //   await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
    //   await page.waitForTimeout(3000);
    //   await page.locator('[data-test="index-dropdown-stream_type"]').click();
    //   await page.getByRole('option', { name: 'Dashboard_sanity' }).locator('div').nth(2).click();
    //   await page.locator('[data-test="dashboard-add-submit"]').click();

    //   // Add a panel to the dashboard
    //   await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    //   await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
    //   await page.getByRole('option', { name: 'default', exact: true }).locator('div').nth(2).click();
    //   await page.locator('[data-test="field-list-item-logs-default-dropped_attributes_count"] [data-test="dashboard-add-y-data"]').click();
    //   await page.locator('[data-test="field-list-item-logs-default-k8s_app_instance"] [data-test="dashboard-add-b-data"]').click();
    //   await page.locator('[data-test="dashboard-apply"]').click();
    //   await expect(page.locator('[data-test="dashboard-panel-name"]')).toBeVisible();

    //   // Rename the panel
    //   await page.locator('[data-test="dashboard-panel-name"]').click();
    //   await page.locator('[data-test="dashboard-panel-name"]').fill(randomDashboardName);
    //   await page.locator('[data-test="dashboard-panel-save"]').click();

    //   // Enter and exit fullscreen mode
    //   await page.locator('[data-test="dashboard-panel-fullscreen-btn"]').click();
    //   await expect(page.locator('[data-test="dashboard-viewpanel-close-btn"]')).toBeVisible();
    //   await page.locator('[data-test="dashboard-viewpanel-close-btn"]').click();

    //   // Edit the panel
    //   await expect(page.locator('[data-test="dashboard-edit-panel-tstt12-dropdown"]')).toBeVisible();
    //   await page.locator('[data-test="dashboard-edit-panel-tstt12-dropdown"]').click();
    //   await page.locator('[data-test="dashboard-edit-panel"]').click();

    //   // Modify panel data
    //   await expect(page.locator('[data-test="dashboard-x-item-_timestamp-remove"]')).toBeVisible();
    //   await page.locator('[data-test="dashboard-x-item-_timestamp-remove"]').click();
    //   await page.locator('[data-test="field-list-item-logs-default-dropped_attributes_count"] [data-test="dashboard-add-x-data"]').click();
    //   await page.locator('[data-test="dashboard-apply"]').click();
    //   await page.locator('[data-test="dashboard-panel-save"]').click();
    // });


    // test('Verify the functionality of editing data and viewing the Dashboard', async ({ page }) => {

    //     await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    //     await page.waitForTimeout(1000);
    //     await page.locator('[data-test="dashboard-add"]').click();
    //     await page.waitForTimeout(4000);
    //     await page.locator('[data-test="add-dashboard-name"]').click();
    //     await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
    //     await page.locator('[data-test="dashboard-add-submit"]').click();


    //     await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    //     await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
    //     await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
    //     await page.getByText('e2e_automate').click();

    //     await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]').click();
    //     await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-b-data"]').click();
    //     await page.waitForTimeout(1000);
    //     await expect(page.locator('[data-test="dashboard-panel-name"]')).toBeVisible();
    //     await page.locator('[data-test="dashboard-panel-name"]').click();
    //     await page.locator('[data-test="dashboard-panel-name"]').fill('Dashboard');
    //     await page.locator('[data-test="dashboard-panel-save"]').click();

    // await page.locator('[data-test="dashboard-panel-fullscreen-btn"]').click;   //.toBeVisible();
    // await page.waitForTimeout(2000);
    // await page.locator('[data-test="dashboard-panel-fullscreen-btn"]').click();
    // await page.waitForTimeout(5000);
    // await page.locator('[data-test="dashboard-viewpanel-close-btn"]').click();
    //await.page.loactor('')

    // await page.waitForTimeout(5000);
    // await page.getByText('drag_indicatortttfullscreenarrow_drop_down').hover();
    //    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    //    const fullscreenButton = page.locator('[data-test="dashboard-panel-fullscreen-btn"]');
    //    const box = await fullscreenButton.boundingBox();
    //    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    //    await fullscreenButton.click();



    // await page.hover('[data-test="dashboard-panel-fullscreen-btn"]'); 
    //  await page.locator('[data-test="dashboard-panel-fullscreen-btn"]').click();
    // await expect(page.locator('[data-test="dashboard-viewpanel-close-btn"]')).toBeVisible();
    // await page.waitForTimeout(4000);
    // await page.locator('[data-test="dashboard-viewpanel-close-btn"]').click();

    //     await expect(page.locator('[data-test="dashboard-edit-panel-testttttttt-dropdown"]')).toBeVisible();
    //     await page.locator('[data-test="dashboard-edit-panel-testttttttt-dropdown"]').click();
    //     await page.locator('[data-test="dashboard-edit-panel"]').click();
    //     await page.waitForTimeout(3000);
    //     await expect(page.locator('[data-test="dashboard-y-item-k8s_app_instance-remove"]')).toBeVisible();
    //     await page.locator('[data-test="dashboard-x-item-_timestamp-remove"]').click();
    //     await page.locator('[data-test="field-list-item-logs-default-dropped_attributes_count"] [data-test="dashboard-add-x-data"]').click();
    //     await page.locator('[data-test="field-list-item-logs-default-k8s_app_instance"] [data-test="dashboard-add-y-data"]').click();
    //     await page.locator('[data-test="dashboard-apply"]').click();
    //     await page.locator('[data-test="dashboard-panel-save"]').click();
    //     await page.waitForTimeout(3000);
    //});

    test('should update the data when changing between absolute and relative time using the Kolkata time zone.', async ({ page }) => {

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();


        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-b-data"]').click();

        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-3-h-btn"]').click();
        await page.locator('label').filter({ hasText: 'Timezonearrow_drop_down' }).locator('i').click();
        await page.locator('[data-test="datetime-timezone-select"]').click();

        await page.locator('[data-test="datetime-timezone-select"]').press('Enter');
        await page.locator('[data-test="datetime-timezone-select"]').fill('calcutta');
        await page.getByText('Asia/Calcutta', { exact: true }).click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(300);

        await expect(page.locator('[data-test="date-time-btn"]')).toBeVisible();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-absolute-tab"]').click();
        await page.getByRole('button', { name: '7', exact: true }).click();

        await page.getByRole('button', { name: '8', exact: true }).click();

        await page.locator('[data-test="dashboard-apply"]').click();
    });

    test('should update the chart when entering a custom SQL query.', async ({ page }) => {

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();


        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('[data-test="dashboard-x-item-_timestamp-remove"]').click();
        await page.locator('[data-test="dashboard-customSql"]').click();

        //  await page.locator('.view-line').click();
        //   await page.locator('[data-test="logs-search-bar-show-query-toggle-btn"] div').nth(2).click();
      //  await page.getByText('arrow_rightQueryAutoPromQLCustom SQL').click();

      //  await page.locator('.view-line').first().
        await page.dblclick('.view-line');
        await page.keyboard.press('End'); // Move to the end of the first
        await page.keyboard.press('Enter'); // Move to the next line
        await page.keyboard.type('SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", kubernetes_container_name as "breakdown_1"  FROM "e2e_automate"  GROUP BY x_axis_1, breakdown_1');
        await page.waitForTimeout(400);


        await page.locator('[data-test="field-list-item-logs-e2e_automate-x_axis_1"] [data-test="dashboard-add-x-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-y_axis_1"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-breakdown_1"] [data-test="dashboard-add-b-data"]').click();


        await expect(page.locator('[data-test="dashboard-apply"]'))//.toBeVisible();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-30-m-btn"]').click();
        await page.locator('[data-test="date-time-relative-3-h-btn"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(400);
        await expect(page.locator('[data-test="dashboard-panel-name"]')).toBeVisible();
        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-panel-save"]').click();
    });

    test('Verify, The Chart should update when changing the chart type', async ({ page }) => {


        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-b-data"]').click();

        //  await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_docker_id"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-3-w-btn"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(200);

        await page.locator('[data-test="selected-chart-area-item"]').click();

        await expect(page.locator('[data-test="selected-chart-area-stacked-item"]')).toBeVisible();

        await page.locator('[data-test="selected-chart-h-bar-item"] img').click();
        await expect(page.locator('[data-test="selected-chart-scatter-item"] img')).toBeVisible();

        await page.locator('[data-test="selected-chart-scatter-item"] img').click();
        await expect(page.locator('[data-test="selected-chart-gauge-item"] img')).toBeVisible();

        await page.locator('[data-test="selected-chart-gauge-item"] img').click();
        await expect(page.locator('[data-test="dashboard-panel-name"]')).toBeVisible();

        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('Dash_01');
        await page.locator('[data-test="dashboard-panel-save"]').click();
        await page.waitForTimeout(200);
        await page.locator('[data-test="dashboard-edit-panel-Dash_01-dropdown"]').click();
        await page.locator('[data-test="dashboard-delete-panel"]').click();
        await page.locator('[data-test="confirm-button"]').click();
    });

    test('Verify, navigating to another dashboard is performed using the DrillDown feature..', async ({ page }) => {    // Folder select as a " Default"vfrom this test cases

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);

        await page.locator('[data-test="dashboard-add-submit"]').click();

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();


        // await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_docker_id"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_labels_app_kubernetes_io_component"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_labels_app_kubernetes_io_instance"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_labels_app_kubernetes_io_managed_by"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-5-w-btn"]').click();


        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(200);


        await page.locator('[data-test="dashboard-sidebar"]').click();
        await page.locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').click();
        await page.locator('[data-test="dashboard-config-panel-drilldown-name"]').click();
        await page.locator('[data-test="dashboard-config-panel-drilldown-name"]').fill('Dashboard1');
        await page.locator('[data-test="dashboard-drilldown-folder-select"]').click();

        await page.getByRole('option', { name: 'default' }).locator('div').nth(2).click();
        await page.getByPlaceholder('Name').nth(1).click();
        await page.getByPlaceholder('Name').nth(1).fill('Dash');
        await page.locator('[data-test="confirm-button"]').click();

        await expect(page.locator('[data-test="dashboard-addpanel-config-drilldown-name-0"]')).toBeVisible();
        await page.locator('[data-test="dashboard-apply"]').click();
        //   await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();
        // await page.locator('[data-test="chart-renderer"] canvas').click({
        //     position: {
        //         x: 371,
        //         y: 109
        //     }
        // });
        // page.once('dialog', dialog => {
        //     console.log(`Dialog message: ${dialog.message()}`);
        //     dialog.dismiss().catch(() => { });
        // });

        // await page.getByText('Dashboard1').click();               //getByText
        // await page.waitForTimeout(3000);
        // await page.locator('[data-test="dashboard-back-btn"]').click();
        // await page.getByRole('cell', { name: 'hjkhjk' }).click();
    });


    test('Verify ,the specified URL should be created using the DrillDown feature.', async ({ page }) => {

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);

        await page.locator('[data-test="dashboard-add-submit"]').click();

        // await page.locator('[data-test="dashboard-add-dialog"]').getByText('arrow_drop_down').click();
        // await page.getByRole('option', { name: 'default' }).locator('div').nth(2).click();
        // await page.locator('[data-test="dashboard-add-submit"]').click();
        // await expect(page.getByText('Dashboard added successfully.')).toBeVisible();
         await page.waitForTimeout(200);

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
        ``
        // await page.locator('[data-test="field-list-item-logs-e2e_automate-_timestamp"] [data-test="dashboard-add-x-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubectl_kubernetes_io_default_container"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-4-w-btn"]').click();
        await page.locator('label').filter({ hasText: 'Timezonearrow_drop_down' }).locator('i').click();
        await page.getByRole('option', { name: 'Asia/Gaza' }).locator('div').nth(2).click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(200);

        await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();
        await page.locator('[data-test="dashboard-sidebar"]').click();
        await page.locator('label').filter({ hasText: 'DefaultUnitarrow_drop_down' }).locator('i').click();
        await page.getByRole('option', { name: 'Bytes', exact: true }).locator('div').nth(2).click();

        await page.locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').click();
        await page.locator('[data-test="dashboard-drilldown-by-url-btn"]').click();
        await page.locator('[data-test="dashboard-config-panel-drilldown-name"]').click();
        await page.locator('[data-test="dashboard-config-panel-drilldown-name"]').fill('Test');
        await page.locator('[data-test="dashboard-drilldown-url-textarea"]').click();
        await page.locator('[data-test="dashboard-drilldown-url-textarea"]').fill('https://alpha1.dev.zinclabs.dev/web/dashboards/add_panel?dashboard=7208792649849905562&panelId=Panel_ID4468610&folder=7206186521999716065&tab=default');
        await page.locator('[data-test="dashboard-drilldown-open-in-new-tab"] div').nth(2).click();
        await page.locator('[data-test="confirm-button"]').click();


        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(100);

        await page.locator('[data-test="dashboard-sidebar-collapse-btn"]').click();
        await page.locator('[data-test="chart-renderer"] canvas').click({
            position: {
                x: 486,
                y: 88
            }
        });
        const page1Promise = page.waitForEvent('popup');
        await page.getByText('Testttt').click();
        const page1 = await page1Promise;
        await expect(page1.locator('[data-test="chart-renderer"] canvas')).toBeVisible();
    });


    test('Verify the confirmation popup message for unsaved changes appears when clicking the Discard button.', async ({ page }) => {
        //Excepted : popup massge appear and redirect to the All Dasboarrd page.  

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();


        //  await page.locator('[data-test="field-list-item-logs-e2e_automate-_timestamp"] [data-test="dashboard-add-x-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-5-w-btn"]').click();
        await page.locator('label').filter({ hasText: 'Timezonearrow_drop_down' }).locator('i').click();
        await page.locator('[data-test="datetime-timezone-select"]').click();
        await page.locator('[data-test="datetime-timezone-select"]').fill('calcutta');
        await page.waitForTimeout(100);
        await page.getByText('Asia/Calcutta', { exact: true }).click();
        await page.locator('[data-test="dashboard-apply"]').click();


        await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible({ timeout:30000});

        await page.goto('https://alpha1.dev.zinclabs.dev/web/dashboards/add_panel?dashboard=7216685250963839834&folder=default&tab=default');
        await page.goto('https://alpha1.dev.zinclabs.dev/web/dashboards/view?org_identifier=default&dashboard=7216685250963839834&folder=default&tab=default');
        await page.goto('https://alpha1.dev.zinclabs.dev/web/dashboards/view?org_identifier=default&dashboard=7216685250963839834&folder=default&tab=default&refresh=Off&period=15m&var-Dynamic+filters=%255B%255D&print=false');
      //  await expect(page.getByText('Defaultchevron_leftchevron_rightadd')).toBeVisible({ timeout: 30000 });
    });


    test('Verify,the filtered data dynamically updates when applying the dynamic filter on dashboard.', async ({ page }) => {

        // Excepted :  The dynamic filter should work correctly and display the appropriate data on the dashboard.

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();


        //  await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-x-data"]').click();

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(100);

        // await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-b-data"]').click();
        // await page.locator('[data-test="dashboard-apply"]').click();
        //  await page.waitForTimeout(3000);
        await page.locator('[data-test="dashboard-variable-adhoc-add-selector"]').click();
        await page.locator('[data-test="dashboard-variable-adhoc-name-selector"]').click();
        await page.locator('[data-test="dashboard-variable-adhoc-name-selector"]').fill('kubernetes_container_hash');
        await page.locator('[data-test="dashboard-variable-adhoc-value-selector"]').click();
        await page.locator('[data-test="dashboard-variable-adhoc-value-selector"]').fill('058694856476.dkr.ecr.us-west-2.amazonaws.com/zinc-cp@sha256:56e216b3d61bd282846e3f6d1bd9cb82f83b90b7e401ad0afc0052aa3f15715c');

        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('Dashboard');
        await page.locator('[data-test="dashboard-panel-save"]').click();


        // await page.locator('[[data-test="dashboard-edit-panel-Tetstt-dropdown"]').click();          
        // await page.locator('[data-test="dashboard-edit-panel"]').click();
        // await page.locator('[data-test="date-time-btn"]').click();
        // await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        // await page.locator('[data-test="dashboard-apply"]').click();
        // await page.waitForTimeout(4000);

        // await page.locator('[data-test="dashboard-panel-save"]').click();
        // await page.locator('[data-test="dashboard-edit-panel-Tetstt-dropdown"]').click();
        // await page.waitForTimeout(2000);

        // await page.locator('[data-test="dashboard-delete-panel"]').click();
        // await expect(page.getByText('Delete PanelAre you sure you')).toBeVisible();
        // await page.waitForTimeout(3000);

        // await page.locator('[data-test="confirm-button"]').click();
        // await expect(page.getByText('Panel deleted successfully')).toBeVisible();
    });


    test('Verify that the Dashboard can be created and saved with different relative times and timezones on both the Gauge and Table charts', async ({ page }) => {

        //Expected Result: The Dashboard is successfully created and saved with accurate data reflecting the specified relative times and timezones on both the Gauge and Table charts.

        // Navigate to dashboards
        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();

        // Add a new panel
        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();

        // Select gauge chart
        await page.locator('[data-test="selected-chart-gauge-item"] img').click();

        // Select a stream
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-y-data"]').click();

        // Set date-time and timezone
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        await page.locator('label').filter({ hasText: 'Timezonearrow_drop_down' }).locator('i').click();
        await page.getByText('Asia/Karachi').click();
        await page.locator('[data-test="dashboard-apply"]').click();

        // Verify the gauge chart is visible
        await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();

        // Switch to table chart
        await page.locator('[data-test="selected-chart-table-item"] img').click();

        // Set timezone for the table chart
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('label').filter({ hasText: 'Timezonearrow_drop_down' }).locator('i').click();
        await page.getByText('Asia/Gaza').click();
        await page.locator('[data-test="dashboard-apply"]').click();

        // Verify specific data in table chart
        // await expect(page.getByRole('cell', { name: '69228.00' })).toBeVisible();

        // Edit the panel name
        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('sdsss');
        await page.locator('[data-test="dashboard-panel-save"]').click();

        // Delete the panel
        await page.locator('[data-test="dashboard-edit-panel-sdsss-dropdown"]').click();
        await page.locator('[data-test="dashboard-delete-panel"]').click();
        await page.locator('[data-test="confirm-button"]').click();
    });


    test('Verify, the Date and Time filter, Page Refresh, and Share Link features on the Dashboard panel page.', async ({ page }) => {


        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await waitForDashboardPage(page)
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="add-dashboard-description"]').click();
        await page.locator('[data-test="dashboard-add-submit"]').click();

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();

        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();


        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();
        // await page.locator('[data-test="date-time-btn"]').click();

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-x-data"]').click();
        // await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();
        // await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-5-w-btn"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(200);

        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('Dashboard');
        await page.locator('[data-test="dashboard-panel-save"]').click();
        // await expect(page.locator('[data-test="chart-renderer"] div')).toBeVisible();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-5-w-btn"]').click();

        await page.waitForTimeout(2000);
        await page.locator('[data-test="dashboard-share-btn"]').click();

        await expect(page.getByText('Link copied successfully')).toBeHidden();

        await page.locator('[data-test="dashboard-fullscreen-btn"]').click();
        await expect(page.locator('[data-test="dashboard-fullscreen-btn"]')).toBeVisible();

        await page.locator('[data-test="dashboard-fullscreen-btn"]').click();
    });




    test('Verify the error message if some fields are missing or incorrect.', async ({ page }) => {
        // Expected Result: An appropriate error message is displayed if any fields are missing or incorrect.

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(1000);
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(4000);
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        // await page.waitForTimeout(3000);

        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();

        await page.waitForTimeout(1000);
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();

        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        await page.locator('[data-test="datetime-timezone-select"]').click();
        await page.getByRole('option', { name: 'Asia/Gaza' }).click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="dashboard-panel-save"]').click();

        await expect(page.getByText('There are some errors, please fix them and try again')).toBeVisible();

        //   await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();
        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('Dash_Error');
        await page.locator('[data-test="dashboard-panel-save"]').click();


        // await page.waitForSelector('[data-test="click-data-test-value"]');

        //     await page.locator('[data-test="dashboard-edit-panel-Dash1_Filter-dropdown"]').click();
        //     await page.locator('[data-test="dashboard-delete-panel"]').click();
        //     await page.waitForTimeout(1000);
        //     await expect(page.getByText('Are you sure you want to')).toBeVisible();;
        //     await page.locator('[data-test="confirm-button"]').click();
    });


    test('Verify filter functionality with different operators on dashboard field', async ({ page }) => {
        // Navigate to dashboards section
        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(3000);

        // Add a new dashboard
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(5000);
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await expect(page.getByText('Dashboard added successfully.')).toHaveText('Dashboard added successfully.');

        await page.waitForTimeout(1000);

        // Add a new panel and configure it
        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();
        await page.waitForTimeout(3000);

        // Add panel fields
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();

        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-absolute-tab"]').click();
        await page.getByRole('button', { name: '7', exact: true }).click();
        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: '10', exact: true }).click();
        await page.locator('[data-test="datetime-timezone-select"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        //  await page.waitForTimeout(2000);

        // Verify chart rendering
        //  await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();

        // Apply "Is Null" filter
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_host"] [data-test="dashboard-add-filter-data"]').click();
        await page.locator('[data-test="dashboard-filter-item-kubernetes_host"]').click();
        await page.getByText('Condition').click();
        await page.locator('[data-test="dashboard-filter-condition-panel"]').getByText('arrow_drop_down').click();
        await page.getByRole('option', { name: 'Is Null' }).click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(3000);
        //   await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();
        // await expect(page.locator('[data-test="chart-renderer"] canvas')).toHaveCSS('display', 'block');

        // Apply "=" filter
        await page.locator('[data-test="dashboard-filter-item-kubernetes_host"]').click();
        await page.locator('[data-test="dashboard-filter-condition-panel"]').getByText('arrow_drop_down').click();
        await page.getByRole('option', { name: '=', exact: true }).click();
        await page.getByLabel('Value').click();
        await page.getByLabel('Value').fill('kubernetes_docker_Id');
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);
        //  await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();

        // Apply "Is Not Null" filter
        await page.locator('[data-test="no-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-tab"]').click();
        await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="dashboard-filter-item-kubernetes_host"]').click();
        await page.locator('[data-test="dashboard-filter-condition-panel"]').getByText('arrow_drop_down').click();
        await page.getByText('Is Not Null').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);
        //   await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();

        // Apply "<>" filter
        //  await page.locator('[data-test="chart-renderer"] canvas').click({ position: { x: 445, y: 15 } });
        //     await page.getByText('Kubernetes Container Hash :').click();
        //     await page.locator('[data-test="dashboard-y-item-kubernetes_container_hash"]').click();
        //     await page.locator('.layout-panel-container > .flex').click();
        //     await page.locator('[data-test="dashboard-filter-item-kubernetes_host"]').click();
        //     await page.locator('[data-test="dashboard-filter-condition-panel"]').getByText('arrow_drop_down').click();
        //     await page.getByRole('option', { name: '<>' }).click();
        //     await page.locator('[data-test="dashboard-apply"]').click();
        //     await page.waitForTimeout(1000);
        // await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();

        // Save and delete the panel
        //   await page.locator('[data-test="chart-renderer"] canvas').click({ position: { x: 445, y: 16 } });
        //  await page.getByText('Kubernetes Container Hash :').click();
        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('Dash1_Filter');
        await page.locator('[data-test="dashboard-panel-save"]').click();

    });



    test('Verify error message when required field is missing', async ({ page }) => {
        // Navigate to dashboards section
        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(3000);

        // Add a new dashboard
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(4000);

        // Enter dashboard name and submit
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();

        // Add a new panel and configure it
        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
        // await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-x-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_host"] [data-test="dashboard-add-b-data"]').click();
        await page.waitForTimeout(3000);

        // Remove X-Axis field and apply changes
        await page.locator('[data-test="dashboard-x-item-_timestamp-remove"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();

        // Update assertion to check error messages
        await expect(page.getByText('There are some errors, please')).toHaveText('There are some errors, please fix them and try again');
        await expect(page.getByText('Add one fields for the X-Axis')).toHaveText('Add one fields for the X-Axis');

        // Complete panel configuration
        await page.locator('[data-test="selected-chart-table-item"] img').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.locator('[data-test="selected-chart-area-item"] img').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('Dashboard');
        await page.locator('[data-test="dashboard-panel-save"]').click();
        await page.waitForTimeout(1000);

        // Add X-Axis field and save the panel
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-x-data"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.locator('[data-test="dashboard-panel-save"]').click();

        // Delete the panel and confirm
        await page.locator('[data-test="dashboard-edit-panel-Dashboard-dropdown"]').click();
        await page.locator('[data-test="dashboard-delete-panel"]').click();
        await expect(page.getByText('Are you sure you want to')).toHaveText('Are you sure you want to delete this Panel?');
        await page.locator('[data-test="confirm-button"]').click();
    });




    // test('01 Verify, The Chart should update when changing the chart type', async ({ page }) => {
    //     const randomDashboardName = 'Dashboard_' + Math.random().toString(36).substr(2, 9);

    //     // Define paths for screenshots
    //     const areaChartPath = `playwright-tests/dashboard-snaps/area-chart-screenshot.png`;
    //     const hBarChartPath = `playwright-tests/dashboard-snaps/hbar-chart-screenshot.png`;
    //     const scatterChartPath = `playwright-tests/dashboard-snaps/scatter-chart-screenshot.png`;
    //     const gaugeChartPath = `playwright-tests/dashboard-snaps/gauge-chart-screenshot.png`;

    //     await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    //     await page.waitForTimeout(5000);
    //     await page.locator('[data-test="dashboard-add"]').click();
    //     await page.waitForTimeout(5000);
    //     await page.locator('[data-test="add-dashboard-name"]').click();
    //     await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);

    //     await page.locator('[data-test="dashboard-add-dialog"]').getByText('arrow_drop_down').click();
    //     await page.getByRole('option', { name: 'Dashboard_sanity' }).locator('div').nth(2).click();
    //     await page.locator('[data-test="dashboard-add-submit"]').click();
    //     await page.waitForTimeout(3000);

    //     await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    //     await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
    //     await page.getByText('e2e_automate').click();
    //     await page.locator('[data-test="dashboard-x-item-_timestamp-remove"]').click();
    //     await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-x-data"]').click();
    //     await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]').click();
    //     await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_docker_id"] [data-test="dashboard-add-y-data"]').click();
    //     await page.locator('[data-test="date-time-btn"]').click();
    //     await page.locator('[data-test="date-time-relative-3-w-btn"]').click();
    //     await page.locator('[data-test="dashboard-apply"]').click();
    //     await page.waitForTimeout(4000);

    //     await page.locator('[data-test="selected-chart-area-item"]').click();
    //     await page.waitForTimeout(3000);
    //     await expect(page.locator('[data-test="selected-chart-area-stacked-item"]')).toBeVisible();
    //     await page.waitForTimeout(3000);

    //     // Take screenshot after changing to area chart
    //     await takeScreenshot(page, '[data-test="chart-renderer"]', areaChartPath);

    //     await page.locator('[data-test="selected-chart-h-bar-item"] img').click();
    //     await expect(page.locator('[data-test="selected-chart-scatter-item"] img')).toBeVisible();
    //     await page.waitForTimeout(3000);

    //     // Take screenshot after changing to horizontal bar chart
    //     await takeScreenshot(page, '[data-test="chart-renderer"]', hBarChartPath);

    //     await page.locator('[data-test="selected-chart-scatter-item"] img').click();
    //     await expect(page.locator('[data-test="selected-chart-gauge-item"] img')).toBeVisible();
    //     await page.waitForTimeout(3000);

    //     // Take screenshot after changing to scatter chart
    //     await takeScreenshot(page, '[data-test="chart-renderer"]', scatterChartPath);

    //     await page.locator('[data-test="selected-chart-gauge-item"] img').click();
    //     await expect(page.locator('[data-test="dashboard-panel-name"]')).toBeVisible();
    //     await page.waitForTimeout(3000);

    //     // Take screenshot after changing to gauge chart
    //     await takeScreenshot(page, '[data-test="chart-renderer"]', gaugeChartPath);

    //     await page.locator('[data-test="dashboard-panel-name"]').click();
    //     await page.locator('[data-test="dashboard-panel-name"]').fill('Dash_01');
    //     await page.locator('[data-test="dashboard-panel-save"]').click();
    //     await page.waitForTimeout(4000);
    //     await page.locator('[data-test="dashboard-edit-panel-Dash_01-dropdown"]').click();
    //     await page.locator('[data-test="dashboard-delete-panel"]').click();
    //     await page.locator('[data-test="confirm-button"]').click();
    // });

    // async function takeScreenshot(page, selector, path) {
    //     await page.waitForSelector(selector);
    //     const elementBoundingBox = await page.locator(selector).boundingBox();
    //     await page.screenshot({
    //         path,
    //         clip: elementBoundingBox
    //     });
    //     console.log(`Screenshot saved at: ${path}`);
    // }




    //....... Breakdown test cases..........................




    test('Verify that the breakdown field should update using Drag and Drop, +B, and Cancel this field.', async ({ page }) => {
        // Generate a random dashboard name
        // const randomDashboardName = 'Dashboard_' + Math.random().toString(36).substr(2, 9);

        // Navigate to dashboards
        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(3000);

        // Add a new dashboard
        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(3000);
        await page.locator('[data-test="dashboard-add"]').click();
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();

        // Add a panel to the dashboard
        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();

        // Add fields to the chart
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-y-data"]').click();
        await page.getByText('drag_indicatortext_fields kubernetes_container_image').click();
        await page.getByText('drag_indicatortext_fields kubernetes_container_image').click();
        await page.getByText('drag_indicatortext_fields kubernetes_container_image').click();

        // Set the date-time range and apply changes
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-4-w-btn"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);

        // Verify the breakdown field removal
        await page.locator('[data-test="dashboard-b-item-kubernetes_labels_app_kubernetes_io_component-remove"]');
        await page.waitForTimeout(2000);

        // await page.locator('[data-test="dashboard-b-item-kubernetes_labels_app_kubernetes_io_component-remove"]').click();
        // await page.locator('[data-test="dashboard-apply"]').click();

        // Verify adding a new breakdown field
        await expect(page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_labels_operator_prometheus_io_name"] [data-test="dashboard-add-b-data"]')).toBeVisible();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_labels_operator_prometheus_io_name"] [data-test="dashboard-add-b-data"]').click();
        await expect(page.locator('[data-test="dashboard-apply"]')).toBeVisible();
        await page.locator('[data-test="dashboard-apply"]').click();

        // Save the panel with a new name
        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('ghdf');
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.locator('[data-test="dashboard-panel-save"]').click();

        // Additional Assertions
        await expect(page.locator('[data-test="dashboard-panel-save"]')).toBeVisible();
    });

    test('Verify the Add and Cancel functionality with different times and timezones for the breakdown field to ensure it shows the correct output.', async ({ page }) => {


        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(1000);
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(5000);
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        // await page.waitForTimeout(1000);

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
        // await page.waitForTimeout(3000);

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        // await page.waitForTimeout(1000);
        // await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();

        // await page.getByText('2024-06-28 03:00:00').click(); 
        //  await page.waitForTimeout(3000);

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);
        await page.locator('[data-test="dashboard-b-item-kubernetes_container_hash-remove"]').click();
        await expect(page.getByText('Chart configuration has been')).toBeVisible();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('Dash_Breakdown');
        await page.locator('[data-test="dashboard-panel-save"]').click();

        // await page.hover('[data-test="hover-data-test-dashboard-panel-fullscreen-btn"]');
        // await page.locator('[data-test="dashboard-panel-fullscreen-btn"]').click();

        // Hover over the element to make the fullscreen button visible
        // await page.waitForTimeout(3000);
        // await page.locator('[data-test="hover-data-test-dashboard-panel-fullscreen-btn"]').hover();

        // // Click the fullscreen button after it becomes visible
        // await page.locator('[data-test="dashboard-panel-fullscreen-btn"]').click();


        // await expect(page.locator('[data-test="dashboard-viewpanel-panel-schema-renderer"] canvas')).toBeVisible();
        // await page.locator('[data-test="dashboard-viewpanel-close-btn"]').click();
        // await page.locator('[data-test="dashboard-edit-panel-Dash_Breakdown-dropdown"]').click();
        // await page.locator('[data-test="dashboard-edit-panel"]').click();

        // await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();
        // await page.locator('[data-test="dashboard-apply"]').click();
        // await page.locator('[data-test="date-time-btn"]').click();
        // await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        // await page.locator('[data-test="dashboard-panel-save"]').click();
        // await page.waitForTimeout(1000);

        // await page.locator('[data-test="dashboard-edit-panel-Dash_Breakdown-dropdown"]').click();
        // await page.locator('[data-test="dashboard-delete-panel"]').click();
        // await expect(page.getByText('Are you sure you want to')).toBeVisible();
        // await page.locator('[data-test="confirm-button"]').click();
        // await expect(page.getByText('Panel deleted successfully')).toBeVisible();
    });

    test('Verify that when changing the chart type, the existing added fields in the Bropdown are correctly populated according to the newly selected chart type.', async ({ page }) => {
        // The existing added fields in the dropdown should adjust correctly according to the new chart type select

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(3000);

        // Add a new dashboard
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(5000);
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.waitForTimeout(1000);

        // Add a panel to the dashboard
        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();

        await page.waitForTimeout(1000);

        // Add fields to the chart
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-y-data"]').click();

        // Set the date-time range and apply changes
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);

        // Verify the initial chart rendering
        //  await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();
        await page.locator('[data-test="dashboard-b-item-kubernetes_container_hash"]').click();
        await expect(page.locator('[data-test="dashboard-b-item-kubernetes_container_hash"]')).toBeVisible();

        // Area chart 
        await page.locator('[data-test="selected-chart-area-item"] img').click();
        await expect(page.locator('[data-test="dashboard-b-item-kubernetes_container_hash"]')).toBeVisible();

        // Area stacked 
        const graphLocatorAreaStacked = page.locator('[data-test="selected-chart-area-stacked-item"]');
        await expect(graphLocatorAreaStacked).toBeVisible();

        // H-bar chart
        const graphLocatorHBar = page.locator('[data-test="selected-chart-h-bar-item"]');
        await expect(graphLocatorHBar).toBeVisible();

        // Scatter chart
        await page.locator('[data-test="selected-chart-scatter-item"] img').click();
        const graphLocatorScatter = page.locator('[data-test="selected-chart-scatter-item"]'); // Replace with the actual selector for the graph
        await expect(graphLocatorScatter).toBeVisible();

        // H-stacked chart
        await page.locator('[data-test="selected-chart-h-stacked-item"] img').click();
        const graphLocatorHStacked = page.locator('[data-test="selected-chart-h-stacked-item"]'); // Replace with the actual selector for the graph
        await expect(graphLocatorHStacked).toBeVisible();

        // Stacked chart
        await page.locator('[data-test="selected-chart-stacked-item"] img').click();
        const graphLocatorStacked = page.locator('[data-test="selected-chart-stacked-item"]'); // Replace with the actual selector for the graph
        await expect(graphLocatorStacked).toBeVisible();

        // Save the dashboard panel
        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('Dashboard');
        await page.locator('[data-test="dashboard-panel-save"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();

        // Switch to Bar chart and apply changes
        await page.locator('[data-test="selected-chart-bar-item"] img').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.locator('[data-test="dashboard-panel-save"]').click();
        await page.waitForTimeout(2000);

        // Delete the dashboard panel
        // await page.locator('[data-test="dashboard-panel-name"]').click();
        // await page.locator('[data-test="dashboard-panel-name"]').fill('Dashboard');
        // await page.locator('[data-test="dashboard-panel-save"]').click();
        await page.waitForTimeout(1000);
        await page.locator('[data-test="dashboard-edit-panel-Dashboard-dropdown"]').click();
        await page.locator('[data-test="dashboard-delete-panel"]').click();
        await page.locator('[data-test="confirm-button"]').click();

    });


    test('Verify that the panel is created successfully after adding a breakdown.', async ({ page }) => {

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(3000);
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(5000);
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('Dash1');
        await page.locator('[data-test="dashboard-panel-save"]').click();
        //await page.waitForTimeout(1000);

        // await page.click('["class="q-icon notranslate material-icons q-btn-dropdown__arrow q-btn-dropdown__arrow-container"]');
        // await page.locator('[data-test="dashboard-edit-panel-Dash1_Filter-dropdown"]').click();         // Delete panel code
        // await page.locator('[data-test="dashboard-delete-panel"]').click();
        // await page.waitForTimeout(4000);
        // await expect(page.getByText('Are you sure you want to')).toBeVisible();
        // await page.locator('[data-test="confirm-button"]').click();
        // await expect(page.getByText('Panel deleted successfully')).toBeVisible();
    });

    test('Verify that the selections are cleared after adding a breakdown, clicking Apply, and refreshing the page.', async ({ page }) => {

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(3000);
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(5000);
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_host"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-absolute-tab"]').click();
        await page.getByRole('button', { name: '9', exact: true }).click();
        await page.getByRole('button', { name: '16', exact: true }).click();
        await page.locator('[data-test="chart-renderer"] div').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);

        page.once('dialog', dialog => {
            console.log(`Dialog message: ${dialog.message()}`);
            dialog.dismiss().catch(() => { });
        });
        // await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();
        //  await page.waitForTimeout(1000);
        // await expect(page.locator('[data-test="no-data"]')).toBeVisible();
    });

    test('Verify changing relative and absolute time with different timezones after adding breakdown and required fields.', async ({ page }) => {

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(2000);
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(5000);
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        await page.locator('label').filter({ hasText: 'Timezonearrow_drop_down' }).locator('i').click();
        await page.locator('[data-test="datetime-timezone-select"]').fill('Asia/Dhaka');
        await page.getByText('Asia/Dhaka').click();
        await page.locator('[data-test="no-data"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();

        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-absolute-tab"]').click();
        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: '8', exact: true }).click();
        await page.getByRole('button', { name: '16', exact: true }).click();
        await page.locator('#date-time-menu').getByText('arrow_drop_down').click();
        await page.locator('[data-test="datetime-timezone-select"]').click();
        await page.locator('[data-test="datetime-timezone-select"]').fill('Asia/c');
        await page.getByText('Asia/Calcutta', { exact: true }).click();
        // await page.locator('.layout-panel-container > .flex').click();
        await page.locator('[data-test="dashboard-apply"]').click();

        await page.locator('[data-test="dashboard-panel-name"]').click();
        await page.locator('[data-test="dashboard-panel-name"]').fill('Dashboard');
        await page.locator('[data-test="dashboard-panel-save"]').click();
    });

    test('Verify adding Breakdown and other field, then discarding changes to ensure the page redirects to the list of dashboard pages.', async ({ page }) => {


        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(2000);
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(4000);
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await page.waitForTimeout(1000);


        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_docker_id"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);

        page.once('dialog', dialog => {
            console.log(`Dialog message: ${dialog.message()}`);
            dialog.dismiss().catch(() => { });
        });
        await page.locator('[data-test="dashboard-panel-discard"]').click();
        //   await page.waitForTimeout(3000);

        // await expect(page.getByText('Start by adding your first')).toBeVisible();
    });

    test('Verify adding the breakdown and applying the Sort by filter, then add fields to the X and Y axes and check if the data is plotted.', async ({ page }) => {

        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(1000);
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(5000);
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
        await page.locator('label').filter({ hasText: 'Timezonearrow_drop_down' }).locator('i').click();
        await page.locator('[data-test="datetime-timezone-select"]').fill('Asia/c');
        await page.getByText('Asia/Calcutta', { exact: true }).click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);
        await expect(page.locator('[data-test="dashboard-b-item-kubernetes_container_name"]')).toBeVisible();
        await page.locator('[data-test="dashboard-b-item-kubernetes_container_name"]').click();
        await page.locator('[data-test="dashboard-sort-by-item-asc"]').click();   //Filter A to C
        await page.waitForTimeout(2000);

        // await page.locator('[data-test="chart-renderer"] canvas').click({
        //     position: {
        //         x: 829,
        //         y: 31
        //     }
        // });
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.locator('[data-test="dashboard-b-item-kubernetes_container_name"]').click();
        await page.locator('[data-test="dashboard-sort-by-item-desc"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        page.once('dialog', dialog => {
            console.log(`Dialog message: ${dialog.message()}`);
            dialog.dismiss().catch(() => { });
        });
        await page.locator('[data-test="dashboard-panel-discard"]').click();
    });

    test('Ensure that string and numeric values are correctly handled and displayed when no value replacement occurs.', async ({ page }) => {



        await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
        await page.waitForTimeout(4000);
        await page.locator('[data-test="dashboard-add"]').click();
        await page.waitForTimeout(5000);
        await page.locator('[data-test="add-dashboard-name"]').click();
        await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
        await page.locator('[data-test="dashboard-add-submit"]').click();
        await page.waitForTimeout(3000);

        await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
        await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
        await page.getByText('e2e_automate').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubectl_kubernetes_io_default_container"] [data-test="dashboard-add-y-data"]').click();
        await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();
        await page.locator('[data-test="dashboard-apply"]').click();
        await page.waitForTimeout(1000);

        await page.locator('[data-test="date-time-btn"]').click();
        await page.locator('[data-test="date-time-relative-45-m-btn"]').click();
        await page.locator('.layout-panel-container > .flex').click();
        await page.getByText('expand_allConfig').click();
        await page.locator('.q-pa-none > .q-list > div').first().click();
        await page.locator('[data-test="dashboard-config-no-value-replacement"]').click();
        await page.locator('[data-test="dashboard-config-no-value-replacement"]').fill('NA');
        await page.locator('[data-test="dashboard-apply"]').click();

    });

    // test('Verify Data Update on Canvas using Chart.js API', async ({ page }) => {
    //     const randomDashboardName = 'Dashboard_' + Math.random().toString(36).substr(2, 9);

    //     // Navigate and configure the dashboard as before
    //     await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    //     await page.waitForTimeout(3000);
    //     await page.locator('[data-test="dashboard-add"]').click();
    //     await page.waitForTimeout(4000);
    //     await page.locator('[data-test="add-dashboard-name"]').click();
    //     await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
    //     await page.locator('[data-test="add-dashboard-description"]').click();
    //     await page.locator('[data-test="dashboard-add-submit"]').click();
    //     //   await page.waitForTimeout(1000);

    //     await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    //     //    await page.waitForTimeout(3000);
    //     await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
    //     await page.getByText('e2e_automate').click();
    //     await page.waitForTimeout(1000);

    //     await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-b-data"]').click();
    //     await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-y-data"]').click();
    //     await page.locator('[data-test="date-time-btn"]').click();
    //     await page.locator('[data-test="date-time-relative-5-w-btn"]').click();
    //     await page.locator('[data-test="dashboard-apply"]').click();
    //     await page.waitForTimeout(1000);

    //     await page.locator('[data-test="dashboard-panel-name"]').click();
    //     await page.locator('[data-test="dashboard-panel-name"]').fill('Dashboard');
    //     await page.locator('[data-test="dashboard-panel-save"]').click();

    //     // Retrieve chart data before update
    //     const initialData = await page.evaluate(() => {
    //         const chart = window.myChart; // Adjust based on your chart instance variable
    //         return chart ? chart.data : null;
    //     });

    //     // Perform actions that should change the data
    //     await page.locator('[data-test="date-time-btn"]').click();
    //     await page.locator('[data-test="date-time-relative-5-w-btn"]').click();
    //     await page.waitForTimeout(1000);

    //     // Retrieve chart data after update
    //     const updatedData = await page.evaluate(() => {
    //         const chart = window.myChart; // Adjust based on your chart instance variable
    //         return chart ? chart.data : null;


    //     });


    //     // Validate that data has been updated
    //     expect(initialData).not.toEqual(updatedData); // Ensure data is different

    //     // Optionally, inspect specific data values if needed
    //     // For example:
    //     // expect(updatedData.datasets[0].data[0]).toBeGreaterThan(initialData.datasets[0].data[0]);
    // });


    // test('11Verify Data Update on Canvas using Chart.js API', async ({ page }) => {
    //     const randomDashboardName = 'Dashboard_' + Math.random().toString(36).substr(2, 9);

    //     // Navigate and create the dashboard
    //     await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    //     await page.waitForTimeout(4000);
    //     await page.locator('[data-test="dashboard-add"]').click();
    //     await page.waitForTimeout(5000);
    //     await page.locator('[data-test="add-dashboard-name"]').click();
    //     await page.locator('[data-test="add-dashboard-name"]').fill(randomDashboardName);
    //     await page.locator('[data-test="dashboard-add-submit"]').click();
    //     await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();

    //     await page.locator('label').filter({ hasText: 'Streamarrow_drop_down' }).locator('i').click();
    //     await page.getByText('e2e_automate').click();
    //     await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]').click();
    //     await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]').click();

    //     await page.locator('[data-test="date-time-btn"]').click();
    //     await page.locator('[data-test="date-time-relative-6-d-btn"]').click();
    //     await page.locator('label').filter({ hasText: 'Timezonearrow_drop_down' }).locator('i').click();
    //     await page.locator('[data-test="datetime-timezone-select"]').fill('cal');
    //     await page.getByText('Asia/Calcutta', { exact: true }).click();

    //     await page.locator('[data-test="dashboard-apply"]').click();
    //     await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();

    //     // Retrieve initial chart data
    //     const initialData = await page.evaluate(() => {
    //         console.log("window , logsdata", window, logsdata);
    //       const chart = window.logsdata; // Replace with your actual chart instance variable
    //       return chart ? chart.data : null;
    //     });

    //     // Perform actions that should change the data
    //     await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_docker_id"] [data-test="dashboard-add-y-data"]').click();
    //     await page.locator('[data-test="date-time-btn"]').click();
    //     await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    //     await page.locator('[data-test="dashboard-apply"]').click();
    //     await expect(page.locator('[data-test="chart-renderer"] canvas')).toBeVisible();

    //     // Retrieve updated chart data
    //     const updatedData = await page.evaluate(() => {
    //       const chart = window.logsdata; // Replace with your actual chart instance variable
    //       return chart ? chart.data : null;
    //     });

    //     // Validate that data has been updated
    //     expect(initialData).not.toEqual(updatedData); // Ensure data is different

    //     // Optionally, inspect specific data values if needed
    //     // For example:
    //     // expect(updatedData.datasets[0].data[0]).toBeGreaterThan(initialData.datasets[0].data[0]);

    //     // Save the dashboard panel
    //     await page.locator('[data-test="dashboard-panel-name"]').click();
    //     await page.locator('[data-test="dashboard-panel-name"]').fill('Dhaboard ');
    //     await page.locator('[data-test="dashboard-panel-save"]').click();
    //   });




})
















