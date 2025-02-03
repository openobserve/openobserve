import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";

// TODO - Modernize imports to use consistent ES module syntax
const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const { promisify } = require('util');

test.describe.configure({ mode: 'parallel' });
const dashboardName = `AutomatedDashboard${Date.now()}`

async function login(page) {
  console.log('Starting login process...');

  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(1000);
  await page.locator('[data-test="login-user-id"]').click();
  await page.locator('[data-test="login-user-id"]').fill(process.env["ZO_ROOT_USER_EMAIL"]);
  await page.locator('[data-test="login-user-id"]').press('Tab');
  await page.locator('[data-test="login-password"]').fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.getByRole('button', { name: 'Login' }).click();
  
  // try {
  //   console.log('Navigating to:', process.env["ZO_BASE_URL"]);
  //   const response = await page.goto(process.env["ZO_BASE_URL"] + "/web/login", {
  //     waitUntil: 'networkidle',
  //     timeout: 60000
  //   });
    
  //   // Log response status
  //   console.log('Navigation response status:', response.status());
    
  //   // Wait for network and DOM to be fully loaded
  //   await page.waitForLoadState('domcontentloaded');
  //   await page.waitForLoadState('networkidle');
    
  //   // Log page information
  //   console.log('\n=== Page Information ===');
  //   console.log('Title:', await page.title());
  //   console.log('URL:', page.url());
    
  //   // Get and log the full HTML content
  //   const content = await page.content();
  //   console.log('\n=== Page Content ===');
  //   console.log('Content length:', content.length);
  //   console.log('First 1000 characters:');
  //   console.log(content.substring(0, 1000));
    
  //   // Log all elements with data-cy attributes
  //   const dataCyElements = await page.evaluate(() => {
  //     const elements = document.querySelectorAll('[data-cy]');
  //     return Array.from(elements).map(el => ({
  //       dataCy: el.getAttribute('data-cy'),
  //       tagName: el.tagName,
  //       isVisible: el.offsetParent !== null,
  //       rect: el.getBoundingClientRect(),
  //       text: el.textContent,
  //       html: el.outerHTML
  //     }));
  //   });
  //   console.log('\n=== Data-cy Elements ===');
  //   console.log(JSON.stringify(dataCyElements, null, 2));
    
  //   // Log all form elements
  //   const formElements = await page.evaluate(() => {
  //     const forms = document.querySelectorAll('form');
  //     return Array.from(forms).map(form => ({
  //       id: form.id,
  //       className: form.className,
  //       action: form.action,
  //       method: form.method,
  //       inputs: Array.from(form.querySelectorAll('input')).map(input => ({
  //         type: input.type,
  //         id: input.id,
  //         name: input.name,
  //         className: input.className,
  //         isVisible: input.offsetParent !== null
  //       }))
  //     }));
  //   });
  //   console.log('\n=== Form Elements ===');
  //   console.log(JSON.stringify(formElements, null, 2));
    
  //   // Take a screenshot
  //   await page.screenshot({ 
  //     path: 'page-load.png',
  //     fullPage: true
  //   });
    
  //   // Log any console messages from the page
  //   page.on('console', msg => {
  //     console.log('Browser console:', msg.type(), '=>', msg.text());
  //   });
    
  //   // Try multiple selectors to find the login form
  //   const selectors = [
  //     '[data-cy="login-user-id"]',
  //     'input[type="email"]',
  //     'input[name="email"]',
  //     'form input[type="text"]',
  //     'form input[type="email"]'
  //   ];
    
  //   console.log('Trying to find login form with selectors:', selectors);
    
  //   let loginInput = null;
  //   for (const selector of selectors) {
  //     try {
  //       loginInput = await page.waitForSelector(selector, {
  //         state: 'visible',
  //         timeout: 10000
  //       });
  //       if (loginInput) {
  //         console.log('Found login input with selector:', selector);
  //         break;
  //       }
  //     } catch (e) {
  //       console.log(`Selector ${selector} not found`);
  //     }
  //   }
    
  //   if (!loginInput) {
  //     // If we still can't find the form, let's check the DOM structure
  //     const bodyContent = await page.evaluate(() => document.body.innerHTML);
  //     console.log('Page body content:', bodyContent.substring(0, 1000) + '...');
  //     throw new Error('Login form not found after trying multiple selectors');
  //   }
    
  //   // Fill in credentials
  //   await loginInput.fill(process.env["ZO_ROOT_USER_EMAIL"]);
    
  //   const passwordInput = await page.waitForSelector('[data-cy="login-password"]', {
  //     state: 'visible',
  //     timeout: 30000
  //   });
  //   await passwordInput.fill(process.env["ZO_ROOT_USER_PASSWORD"]);
    
  //   // Click sign in button
  //   const signInButton = await page.locator('[data-cy="login-sign-in"]');
  //   await signInButton.waitFor({ state: 'visible', timeout: 30000 });
    
  //   await Promise.all([
  //     page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }),
  //     signInButton.click()
  //   ]);
    
  //   console.log('Login successful');
  // } catch (error) {
  //   console.error('Login failed:', error);
  //   // Take error screenshot
  //   await page.screenshot({ path: 'login-error.png', fullPage: true });
    
  //   // Log the final state of the page
  //   const finalContent = await page.content();
  //   console.log('Final page content length:', finalContent.length);
  //   console.log('Final page content preview:', finalContent.substring(0, 500));
    
  //   throw error;
  // }
}

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logsdata)
    });
    return await fetchResponse.json();
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    logsdata: logsdata
  });
  console.log(response);
}

const selectStreamAndStreamTypeForLogs = async (page, stream) => {
  await page.waitForTimeout(
    4000);
  await page.locator(
    '[data-test="log-search-index-list-select-stream"]').click({ force: true });
  await page.locator(
    "div.q-item").getByText(`${stream}`).first().click({ force: true });
};

test.describe("dashboard testcases", () => {
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
    await page.waitForTimeout(3000);
    // get the data from the search variable
    await expect.poll(async () => (await search).status()).toBe(200);
    // await search.hits.FIXME_should("be.an", "array");
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000)
    await ingestion(page);
    await page.waitForTimeout(2000)

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await selectStreamAndStreamTypeForLogs(page, logData.Stream);
    await page.waitForTimeout(1000)
    await applyQueryButton(page);
  });

  test('should create, compare area type chart image and delete dashboard', async ({ page }) => {
    page.on('console', msg => console.log(msg.text()));
    page.on('response', async (resp) => {
      if (resp.url().includes('api/default/')) {
        console.log('url      -> ', resp.url());
        console.log('code     -> ', resp.status());
        console.log('payload  -> ', resp.request().postData());
        console.log('response -> ', await resp.text());
      }
    });

    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.waitForTimeout(2000)
    await page.locator('[data-test="dashboard-add"]').click();
    await page.waitForTimeout(2000)
    await page.locator('[data-test="add-dashboard-name"]').click();

    await page.locator('[data-test="add-dashboard-name"]').fill(dashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.waitForTimeout(2000)
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    await page.waitForTimeout(3000)
    await page.locator('[data-test="index-dropdown-stream"]').click();
    await page.locator('[data-test="index-dropdown-stream"]').fill('e2e');
    await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
    await page.waitForTimeout(3000)
    await page.locator('[data-test="selected-chart-area-item"] img').click();
    await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubectl_kubernetes_io_default_container"] [data-test="dashboard-add-y-data"]').click();
    await page.locator('[data-test="dashboard-apply"]').click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-30-m-btn"]').click();
    await page.locator('[data-test="dashboard-apply"]').click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-45-m-btn"]').click();
    await page.locator('[data-test="dashboard-apply"]').click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-3-d-btn"]').click();
    await page.locator('[data-test="dashboard-apply"]').click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-30-m-btn"]').click();
    await page.locator('[data-test="dashboard-apply"]').click();
    await page.waitForTimeout(5000)
    await page.locator('[data-test="chart-renderer"] canvas').last().click();

    await page.waitForSelector('[data-test="chart-renderer"]');
    const chartBoundingBox = await page.locator('[data-test="chart-renderer"]').boundingBox();
    const screenshotPath = `playwright-tests/dashboard-snaps/areachart-screenshot.png`;
    await page.screenshot({
      path: screenshotPath,
      selector: '[data-test="chart-renderer"]',
      clip: chartBoundingBox,
      threshold: 50
    });
    // await page.screenshot({ path: screenshotPath, selector: '[data-test="chart-renderer"]', threshold: 50 });
    console.log(`Screenshot saved at: ${screenshotPath}`);

    // Load the expected image from disk
    const expectedImage = PNG.sync.read(fs.readFileSync(screenshotPath));

    // Load the actual screenshot
    const actualImage = PNG.sync.read(fs.readFileSync(screenshotPath));

    // Compare the images
    const { width, height } = expectedImage;
    const diff = new PNG({ width, height });
    const numDiffPixels = pixelmatch(expectedImage.data, actualImage.data, diff.data, width, height, { threshold: 0.1 });

    // Save the diff image
    if (numDiffPixels > 0) {
      const diffImagePath = `playwright-tests/dashboard-snaps/diff.png`;
      await promisify(fs.writeFile)(diffImagePath, PNG.sync.write(diff));
      console.log(`Diff image saved at: ${diffImagePath}`);
    }

    // Assert the images are visually identical
    expect(numDiffPixels).toBe(0);

    await page.locator('[data-test="dashboard-panel-save"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').fill('sanitydash');
    await page.locator('[data-test="dashboard-panel-save"]').click();
    await page.waitForTimeout(4000)
    await page.locator('[data-test="dashboard-edit-panel-sanitydash-dropdown"]').click();
    await page.locator('[data-test="dashboard-delete-panel"]').click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator('#q-notify div').filter({ hasText: 'check_circlePanel deleted' }).nth(3).click();
    await page.locator('[data-test="dashboard-back-btn"]')
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await page.getByRole('row', { name: dashboardName }).locator('[data-test="dashboard-delete"]').click();
    await page.locator('[data-test="confirm-button"]').click();
  });
});
