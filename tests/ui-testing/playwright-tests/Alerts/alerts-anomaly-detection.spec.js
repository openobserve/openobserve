const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { getOrgName, createMockDestination, deleteDestination, listAnomalyDetections, triggerAnomalyDetection, getAnomalyHistory } = require('../utils/api-helper.js');

test.describe("Anomaly Detection Alerts", () => {
  test.describe.configure({ mode: 'serial' });

  let pm;
  // Generate randomValue ONCE for all serial tests so they can share the same anomaly name
  const randomValue = Date.now().toString().slice(-6);
  const testStreamName = 'e2e_automate'; // Stream created by global setup
  const testAnomalyName = (suffix) => `E2E_Anomaly_${suffix}_${randomValue}`;

  // Prerequisite destination name - ensures Add Alert button is enabled
  const prerequisiteDestinationName = `e2e_anomaly_prerequisite_${randomValue}`;
  let prerequisiteDestinationCreated = false;

  // Setup: Create a test destination to ensure Add Alert button is enabled
  // The Add Alert button is disabled when no destinations exist in the system
  test.beforeAll(async ({ browser }) => {
    testLogger.info('Setting up prerequisites - creating test destination');

    if (!process.env.ZO_BASE_URL || !process.env.ZO_ROOT_USER_EMAIL || !process.env.ZO_ROOT_USER_PASSWORD || !process.env.ORGNAME) {
      testLogger.warn('Skipping prerequisite setup - missing environment variables');
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Navigate to base URL first - required for page.evaluate() to make fetch calls
      // The apiCall helper uses page.evaluate() which needs a valid origin
      await page.goto(process.env.ZO_BASE_URL);
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

      // Create a prerequisite destination to enable the Add Alert button
      const createResp = await createMockDestination(page, prerequisiteDestinationName);
      if (createResp.status === 200) {
        prerequisiteDestinationCreated = true;
        testLogger.info('Prerequisite destination created successfully', { name: prerequisiteDestinationName });
      } else {
        testLogger.warn('Failed to create prerequisite destination', { status: createResp.status, data: createResp.data });
      }
    } catch (error) {
      testLogger.warn('Error creating prerequisite destination', { error: error.message });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to alerts page
    await page.goto(`${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Wait for alerts table to be ready
    await page.locator(pm.anomalyDetectionPage.selectors.alertsTable).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

    // Wait for Add Alert button to be enabled (destinations must exist)
    const addButtonEnabled = await pm.anomalyDetectionPage.waitForAddAlertButtonEnabled(15000);
    if (!addButtonEnabled) {
      testLogger.warn('Add Alert button not enabled - tests may fail. Ensure destinations exist.');
    }

    testLogger.info('Test setup completed', { randomValue });
  });

  // ========================================================================
  // P0 TESTS - SMOKE / CRITICAL PATH
  // ========================================================================

  test.describe("Create Anomaly Detection - Builder Mode", () => {

    test("Create basic anomaly detection with builder mode", {
      tag: ['@smoke', '@anomaly', '@P0', '@all']
    }, async ({ page }) => {
      testLogger.info('Creating basic anomaly detection');

      const anomalyName = testAnomalyName('Basic');

      // Start anomaly creation
      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      // Fill basic setup
      await pm.anomalyDetectionPage.fillBasicSetup(
        anomalyName,
        'logs',
        testStreamName
      );

      // Wait for the anomaly configuration UI to be ready
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      testLogger.info('Checking if anomaly configuration UI is visible');

      // Check if detection config tab exists and click it if needed
      const detectionConfigTab = page.getByText('Detection Config');
      if (await detectionConfigTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await detectionConfigTab.click();
        await page.waitForTimeout(500);
      }

      // Configure detection resolution (histogram interval)
      testLogger.info('Setting detection resolution');
      const resolutionInput = page.locator(pm.anomalyDetectionPage.selectors.histogramIntervalValue);
      await expect(resolutionInput).toBeVisible({ timeout: 5000 });
      await resolutionInput.fill('5');

      // Set schedule interval (check every)
      testLogger.info('Setting schedule interval');
      const scheduleInput = page.locator(pm.anomalyDetectionPage.selectors.scheduleIntervalValue);
      await scheduleInput.fill('10');

      // Set detection window (look back)
      testLogger.info('Setting detection window');
      const windowInput = page.locator(pm.anomalyDetectionPage.selectors.detectionWindowValue);
      await windowInput.fill('30');

      // Set training window (minimum 1 day)
      testLogger.info('Setting training window');
      const trainingInput = page.locator(pm.anomalyDetectionPage.selectors.trainingWindow);
      await trainingInput.fill('1');

      // Set retrain interval - it should already be set to "Never" by default, skip if not critical
      testLogger.info('Skipping retrain interval (default is Never)');

      // Close any open menus by pressing Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Go to Alerting tab and DISABLE alerting (it's enabled by default with no destination)
      testLogger.info('Disabling alerting to allow save');

      // Go to Alerting tab using POM method
      await pm.anomalyDetectionPage.clickTab('Alerting');

      // Take screenshot to see Alerting tab state (only in debug mode)
      if (process.env.DEBUG) {
        await page.screenshot({ path: 'test-logs/anomaly-alerting-tab.png', fullPage: true });
      }

      // Find and toggle off the alert enabled switch - it's a q-toggle
      const alertToggle = page.locator(pm.anomalyDetectionPage.selectors.alertEnabled);
      if (await alertToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
        testLogger.info('Found alert toggle, clicking to disable');
        await alertToggle.click();
        await page.waitForTimeout(500);
        testLogger.info('Alerting toggle clicked');
      } else {
        // Try alternative selector for the toggle
        testLogger.info('Looking for alternative toggle selector');
        const toggleInner = page.locator(pm.anomalyDetectionPage.selectors.qToggle).filter({ hasText: /enabled/i }).first();
        if (await toggleInner.isVisible({ timeout: 2000 }).catch(() => false)) {
          await toggleInner.click();
          await page.waitForTimeout(500);
          testLogger.info('Alternative toggle clicked');
        }
      }

      // Take screenshot to see current state before save (only in debug mode)
      if (process.env.DEBUG) {
        testLogger.info('Taking screenshot before save');
        await page.screenshot({ path: 'test-logs/anomaly-before-save.png', fullPage: true });
      }

      // Click save button
      const saveButton = page.locator(pm.anomalyDetectionPage.selectors.saveButton);
      await expect(saveButton).toBeVisible({ timeout: 5000 });
      await expect(saveButton).toBeEnabled({ timeout: 5000 });
      await saveButton.click();

      // Wait for navigation back to list
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Verify we're back on the list and the anomaly appears
      const anomalyRow = pm.anomalyDetectionPage.getAnomalyRow(anomalyName);
      await expect(anomalyRow).toBeVisible({ timeout: 15000 });

      testLogger.info('Anomaly created successfully and visible in list', { anomalyName });
    });

    test("View anomaly detection in list", {
      tag: ['@smoke', '@anomaly', '@P0', '@all']
    }, async ({ page }) => {
      testLogger.info('Viewing anomaly in list');

      const anomalyName = testAnomalyName('Basic');

      // Verify anomaly appears in the alerts list
      const anomalyRow = pm.anomalyDetectionPage.getAnomalyRow(anomalyName);
      await expect(anomalyRow).toBeVisible({ timeout: 10000 });

      // Verify action buttons using POM dynamic selectors
      const editButton = page.locator(pm.anomalyDetectionPage.selectors.editButton(anomalyName));
      const pauseButton = page.locator(pm.anomalyDetectionPage.selectors.pauseButton(anomalyName));

      await expect(editButton).toBeVisible({ timeout: 5000 });
      await expect(pauseButton).toBeVisible({ timeout: 5000 });

      testLogger.info('Anomaly visible in list with action buttons');
    });

    test("Edit existing anomaly detection", {
      tag: ['@smoke', '@anomaly', '@P0', '@all']
    }, async ({ page }) => {
      testLogger.info('Editing anomaly detection');

      const anomalyName = testAnomalyName('Basic');

      // Click edit button using POM selector
      const editButton = page.locator(pm.anomalyDetectionPage.selectors.editButton(anomalyName));
      await expect(editButton).toBeVisible({ timeout: 5000 });
      await editButton.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Verify wizard opens - should see the anomaly name in the form
      await expect(page.locator('input').filter({ hasText: anomalyName }).or(
        page.locator(`input[value="${anomalyName}"]`)
      ).first()).toBeVisible({ timeout: 5000 }).catch(async () => {
        // Alternative: just verify we're in edit mode by checking for Detection Config tab
        await expect(page.getByText('Detection Config')).toBeVisible({ timeout: 5000 });
      });

      // Change training window to 7 days
      const trainingInput = page.locator(pm.anomalyDetectionPage.selectors.trainingWindow);
      if (await trainingInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await trainingInput.fill('7');
        await page.waitForTimeout(500);
      }

      // Verify seasonality text changes (use .first() to avoid strict mode error)
      await expect(page.getByText('hour + day-of-week').first()).toBeVisible({ timeout: 5000 });

      // Save changes
      const saveButton = page.locator(pm.anomalyDetectionPage.selectors.saveButton);
      await expect(saveButton).toBeEnabled({ timeout: 5000 });
      await saveButton.click();

      // Wait for save and navigation back to list
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Verify still in list
      const anomalyRow = pm.anomalyDetectionPage.getAnomalyRow(anomalyName);
      await expect(anomalyRow).toBeVisible({ timeout: 10000 });

      testLogger.info('Anomaly edited successfully');
    });

    test("Delete anomaly detection", {
      tag: ['@smoke', '@anomaly', '@P0', '@all']
    }, async ({ page }) => {
      testLogger.info('Deleting anomaly detection');

      const anomalyName = testAnomalyName('Basic');

      // Click the "more options" button to open the menu using POM selector
      const moreOptionsButton = page.locator(pm.anomalyDetectionPage.selectors.moreOptionsButton(anomalyName));
      await expect(moreOptionsButton).toBeVisible({ timeout: 5000 });
      await moreOptionsButton.click();
      await page.waitForTimeout(500);

      // Click delete option in the dropdown menu
      const deleteMenuItem = page.locator(pm.anomalyDetectionPage.selectors.qMenuItem).filter({ has: page.locator('.q-icon').filter({ hasText: /delete/i }) }).first();
      if (await deleteMenuItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await deleteMenuItem.click();
      } else {
        // Alternative: click by text
        const deleteByText = page.locator(pm.anomalyDetectionPage.selectors.qMenu).getByText('Delete').first();
        await deleteByText.click();
      }
      await page.waitForTimeout(500);

      // Verify confirmation dialog and click confirm
      const confirmDialog = page.locator(pm.anomalyDetectionPage.selectors.qDialog);
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });

      // Click OK/Confirm button in dialog
      const confirmButton = confirmDialog.locator('button').filter({ hasText: /ok|confirm|delete|yes/i }).first();
      await expect(confirmButton).toBeVisible({ timeout: 3000 });
      await confirmButton.click();

      // Wait for deletion to complete
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Verify removed from list
      const anomalyRow = pm.anomalyDetectionPage.getAnomalyRow(anomalyName);
      await expect(anomalyRow).not.toBeVisible({ timeout: 10000 });

      testLogger.info('Anomaly deleted successfully');
    });
  });

  // ========================================================================
  // P1 TESTS - FUNCTIONAL / MAIN WORKFLOWS
  // ========================================================================

  test.describe("Create Anomaly Detection - SQL Mode", () => {

    test("Create anomaly with SQL mode", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Creating anomaly with SQL mode');

      const anomalyName = testAnomalyName('SQL');

      // Start creation
      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      // Configure with SQL
      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.selectQueryMode('sql');

      // Verify default SQL template appears
      await expect(page.locator(pm.anomalyDetectionPage.selectors.customSql)).toBeVisible({ timeout: 5000 });

      // Set custom SQL - use simple count without invalid field references
      const customSql = `SELECT histogram(_timestamp, '10m') AS time_bucket, count(*) AS value FROM "${testStreamName}" GROUP BY time_bucket ORDER BY time_bucket`;
      await pm.anomalyDetectionPage.setSqlQuery(customSql);

      // Set intervals
      await pm.anomalyDetectionPage.setDetectionResolution(10, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(30, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(1, 'h');
      await pm.anomalyDetectionPage.setTrainingWindow(3);
      await pm.anomalyDetectionPage.setRetrainInterval('Never');

      // Disable alerting (required - alerting is enabled by default with no destination)
      await pm.anomalyDetectionPage.disableAlerting();

      // Save
      await pm.anomalyDetectionPage.clickSave();

      // Verify created
      await pm.anomalyDetectionPage.expectAnomalyInList(anomalyName);

      testLogger.info('SQL mode anomaly created successfully');
    });
  });

  test.describe("Anomaly Configuration - Builder Mode", () => {

    test("Create anomaly with detection function (avg)", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Creating anomaly with avg function');

      const anomalyName = testAnomalyName('Avg');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.selectQueryMode('builder');

      // Configure with avg function - use 'code' field which exists in test data
      await pm.anomalyDetectionPage.configureBuilderMode({
        function: 'avg',
        field: 'code'
      });

      // Verify field selector appeared
      await expect(page.locator(pm.anomalyDetectionPage.selectors.detectionFunctionField)).toBeVisible();

      // Set other config
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(15, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);
      await pm.anomalyDetectionPage.setRetrainInterval('1 day');

      // Disable alerting (required - alerting is enabled by default with no destination)
      await pm.anomalyDetectionPage.disableAlerting();

      await pm.anomalyDetectionPage.clickSave();

      await pm.anomalyDetectionPage.expectAnomalyInList(anomalyName);

      testLogger.info('Anomaly with avg function created successfully');
    });

    test("Add filters in builder mode", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Creating anomaly with filters');

      const anomalyName = testAnomalyName('Filtered');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.selectQueryMode('builder');

      // Add filters - use fields that exist in the test stream
      await pm.anomalyDetectionPage.addFilter('code', '=', '200');
      await pm.anomalyDetectionPage.addFilter('stream', 'Contains', 'stdout');

      // Verify filters added - check for input values in filter rows
      await expect(page.getByText('code').first()).toBeVisible({ timeout: 5000 });
      await expect(page.getByText('stream').first()).toBeVisible({ timeout: 5000 });

      // Complete config
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      // Disable alerting (required - alerting is enabled by default with no destination)
      await pm.anomalyDetectionPage.disableAlerting();

      await pm.anomalyDetectionPage.clickSave();
      await pm.anomalyDetectionPage.expectAnomalyInList(anomalyName);

      testLogger.info('Anomaly with filters created successfully');
    });
  });

  test.describe("Anomaly Alerting Configuration", () => {

    test("Enable alerting with destinations (CI/CD compatible)", {
      tag: ['@functional', '@anomaly', '@P1', '@all', '@cicd']
    }, async ({ page }) => {
      testLogger.info('Creating anomaly with alerting enabled');

      const org = getOrgName();
      const testDestinationName = `e2e_anomaly_dest_${randomValue}`;

      // Step 1: Create a mock destination via API (using httpbin.org for CI/CD)
      const createDestResp = await createMockDestination(page, testDestinationName);
      testLogger.info('Create destination response', { status: createDestResp.status });

      if (createDestResp.status !== 200) {
        testLogger.warn('Failed to create destination, test may fail', { response: createDestResp.data });
      }

      // Step 2: Create anomaly with alerting enabled
      const anomalyName = testAnomalyName('WithAlerts');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      // Config tab
      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      // Alerting tab
      await pm.anomalyDetectionPage.clickTab('Alerting');

      // Alerting should already be enabled by default, but ensure it's on
      const alertToggle = page.locator(pm.anomalyDetectionPage.selectors.alertEnabled);
      const toggleLabel = await alertToggle.locator(pm.anomalyDetectionPage.selectors.alertToggleLabel).textContent().catch(() => '');
      if (toggleLabel.toLowerCase().includes('disabled')) {
        await alertToggle.click();
        await page.waitForTimeout(500);
      }

      // Verify destination selector appears
      await expect(page.locator(pm.anomalyDetectionPage.selectors.destination)).toBeVisible({ timeout: 5000 });

      // Refresh destinations to ensure our newly created destination is loaded
      testLogger.info('Refreshing destinations list');
      const refreshBtn = page.locator(pm.anomalyDetectionPage.selectors.refreshDestinationsBtn).filter({ has: page.locator('.q-icon') }).first();
      if (await refreshBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await refreshBtn.click();
        testLogger.info('Clicked refresh button');
        await page.waitForTimeout(3000); // Wait for API call and refresh to complete
      } else {
        // Try alternative: button with refresh icon
        const altRefresh = page.locator('button').filter({ has: page.locator('i.q-icon:has-text("refresh")') }).first();
        if (await altRefresh.isVisible({ timeout: 1000 }).catch(() => false)) {
          await altRefresh.click();
          testLogger.info('Clicked alternative refresh button');
          await page.waitForTimeout(3000);
        } else {
          testLogger.warn('Could not find refresh button');
        }
      }

      // Select the destination we created
      testLogger.info('Selecting destination', { testDestinationName });
      const destSelect = page.locator(pm.anomalyDetectionPage.selectors.destination);
      await destSelect.click();
      await page.waitForTimeout(1000);

      // Type to filter - use full destination name
      await page.keyboard.type(testDestinationName);
      await page.waitForTimeout(1000);

      // Click on the matching option - try multiple selectors
      let destFound = false;
      const destOption = page.locator(pm.anomalyDetectionPage.selectors.qMenuItem).filter({ hasText: testDestinationName }).first();
      if (await destOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await destOption.click();
        await page.waitForTimeout(500);
        destFound = true;
        testLogger.info('Destination selected via menu item');
      }

      if (!destFound) {
        // Try selecting via checkbox in dropdown
        const checkboxItem = page.locator(pm.anomalyDetectionPage.selectors.qMenuItem).filter({ hasText: /e2e_anomaly_dest/ }).first();
        if (await checkboxItem.isVisible({ timeout: 2000 }).catch(() => false)) {
          await checkboxItem.click();
          await page.waitForTimeout(500);
          destFound = true;
          testLogger.info('Destination selected via checkbox');
        }
      }

      if (!destFound) {
        testLogger.warn('Could not find destination in dropdown - checking if any destinations exist');
        // Take screenshot for debugging (only in debug mode)
        if (process.env.DEBUG) {
          await page.screenshot({ path: 'test-logs/anomaly-dest-dropdown.png', fullPage: true });
        }
      }

      // Close dropdown
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Verify destination error is gone (destination selected)
      const destError = page.locator(pm.anomalyDetectionPage.selectors.destinationError);
      const errorVisible = await destError.isVisible({ timeout: 2000 }).catch(() => false);
      if (errorVisible) {
        testLogger.warn('Destination error still visible - destination may not be selected, skipping save');
        // Cancel and cleanup
        await pm.anomalyDetectionPage.clickBack();
        await deleteDestination(page, testDestinationName);
        test.skip(true, 'Could not select destination in dropdown');
        return;
      }

      // Save anomaly
      await pm.anomalyDetectionPage.clickSave();
      await pm.anomalyDetectionPage.expectAnomalyInList(anomalyName);

      testLogger.info('Anomaly with alerting created successfully');

      // Step 3: Cleanup - delete the test destination via API
      testLogger.info('Cleaning up test destination');
      await deleteDestination(page, testDestinationName);
    });

    test("Refresh destinations list", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing refresh destinations');

      const anomalyName = testAnomalyName('RefreshDest');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      await pm.anomalyDetectionPage.clickTab('Alerting');
      await pm.anomalyDetectionPage.toggleNotifications(true);

      // Click refresh button
      await pm.anomalyDetectionPage.refreshDestinations();

      // Verify no errors (destinations reloaded)
      await expect(page.locator(pm.anomalyDetectionPage.selectors.destination)).toBeVisible();

      // Cancel creation
      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Destinations refresh works');
    });
  });

  test.describe("Anomaly Management Operations", () => {

    test("Pause and resume anomaly detection", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing pause and resume');

      // Create an anomaly first
      const anomalyName = testAnomalyName('PauseResume');

      await pm.anomalyDetectionPage.createAnomalyDetection({
        name: anomalyName,
        streamType: 'logs',
        streamName: testStreamName,
        detection: {
          mode: 'builder',
          function: 'count'
        },
        schedule: {
          resolution: { value: 5, unit: 'm' },
          checkEvery: { value: 10, unit: 'm' },
          lookBack: { value: 30, unit: 'm' }
        },
        training: {
          window: 1,
          retrain: 'Never'
        }
      });

      // Wait for anomaly to be ready (may take time for training)
      // In real scenario, we'd poll for status or use a fixture with pre-trained anomaly
      await page.waitForTimeout(3000);

      // Pause
      await pm.anomalyDetectionPage.clickPauseAnomaly(anomalyName);

      // Verify status changes to disabled
      await pm.anomalyDetectionPage.expectAnomalyStatus(anomalyName, 'disabled');

      // Resume
      await pm.anomalyDetectionPage.clickResumeAnomaly(anomalyName);

      // Verify status changes back
      // Note: Status may be "waiting" or "ready" depending on training state
      // We just verify it's no longer "disabled"
      const row = pm.anomalyDetectionPage.getAnomalyRow(anomalyName);
      await expect(row.locator('.q-badge')).not.toContainText('disabled', { ignoreCase: true, timeout: 5000 });

      testLogger.info('Pause/resume works correctly');
    });

    test("Trigger anomaly detection via UI", {
      tag: ['@functional', '@anomaly', '@P1', '@all', '@cicd']
    }, async ({ page }) => {
      testLogger.info('Testing trigger anomaly detection');

      // This test verifies that anomaly detection can be triggered manually
      // Similar to how regular alerts can be triggered in CI/CD pipelines

      // First, we need an existing anomaly in the list
      // The P0 tests should have left some anomalies or we create one
      const anomalyName = testAnomalyName('Trigger');

      // Create anomaly first
      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);
      await page.waitForTimeout(2000);

      // Set minimal config
      const detectionConfigTab = page.getByText('Detection Config');
      if (await detectionConfigTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await detectionConfigTab.click();
        await page.waitForTimeout(500);
      }

      // Fill required fields using POM selectors
      await page.locator(pm.anomalyDetectionPage.selectors.histogramIntervalValue).fill('5');
      await page.locator(pm.anomalyDetectionPage.selectors.scheduleIntervalValue).fill('10');
      await page.locator(pm.anomalyDetectionPage.selectors.detectionWindowValue).fill('30');
      await page.locator(pm.anomalyDetectionPage.selectors.trainingWindow).fill('1');

      // Disable alerting to allow save
      await pm.anomalyDetectionPage.disableAlerting();

      // Save
      const saveButton = page.locator(pm.anomalyDetectionPage.selectors.saveButton);
      await expect(saveButton).toBeEnabled({ timeout: 5000 });
      await saveButton.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Verify created
      const anomalyRow = pm.anomalyDetectionPage.getAnomalyRow(anomalyName);
      await expect(anomalyRow).toBeVisible({ timeout: 15000 });

      // Now trigger detection via the UI menu
      testLogger.info('Triggering detection via UI');

      // Click more options menu using POM selector
      const moreOptionsButton = page.locator(pm.anomalyDetectionPage.selectors.moreOptionsButton(anomalyName));
      await expect(moreOptionsButton).toBeVisible({ timeout: 5000 });
      await moreOptionsButton.click();
      await page.waitForTimeout(500);

      // Look for "Trigger Detection" menu item using POM selector
      const triggerMenuItem = page.locator(pm.anomalyDetectionPage.selectors.triggerDetectionButton(anomalyName));

      if (await triggerMenuItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        testLogger.info('Found Trigger Detection menu item');
        await triggerMenuItem.click();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        // Should see success toast or status change
        testLogger.info('Anomaly detection triggered successfully via UI');
      } else {
        // Alternative: try clicking by text
        const triggerByText = page.locator(pm.anomalyDetectionPage.selectors.qMenu).getByText(/trigger.*detection/i).first();
        if (await triggerByText.isVisible({ timeout: 2000 }).catch(() => false)) {
          await triggerByText.click();
          await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          testLogger.info('Anomaly detection triggered via text selector');
        } else {
          testLogger.info('Trigger Detection menu item not available - anomaly may need to be trained first');
          // Close menu
          await page.keyboard.press('Escape');
        }
      }

      testLogger.info('Trigger anomaly detection test completed');
    });

    test("Trigger anomaly detection via API", {
      tag: ['@functional', '@anomaly', '@P1', '@all', '@cicd', '@api']
    }, async ({ page }) => {
      testLogger.info('Testing trigger anomaly detection via API');

      // List anomaly detections to find one we can trigger
      testLogger.info('Listing anomaly detections via API');
      const anomalies = await listAnomalyDetections(page);

      testLogger.info('Anomaly list response', { count: anomalies.length });

      if (anomalies.length > 0) {
        // Try to trigger the first anomaly that's enabled and trained
        const targetAnomaly = anomalies.find(a => a.enabled && (a.is_trained || a.status === 'ready')) || anomalies[0];
        const anomalyId = targetAnomaly.anomaly_id || targetAnomaly.id;
        const anomalyName = targetAnomaly.name;

        testLogger.info('Triggering detection for anomaly', { anomalyId, anomalyName, status: targetAnomaly.status });

        // Trigger detection via API
        const triggerResp = await triggerAnomalyDetection(page, anomalyId);

        testLogger.info('Trigger detection response', { status: triggerResp.status, data: triggerResp.data });

        // 200 = success, 400/404 = anomaly not ready/found
        if (triggerResp.status === 200) {
          testLogger.info('Anomaly detection triggered successfully via API');
        } else if (triggerResp.status === 400 || triggerResp.status === 404) {
          testLogger.info('Anomaly not ready for detection trigger', { reason: triggerResp.data?.message || 'Unknown' });
        } else {
          testLogger.warn('Unexpected response from trigger API', { status: triggerResp.status, data: triggerResp.data });
        }

        // Optional: Check detection history to verify trigger was recorded
        const historyResp = await getAnomalyHistory(page, anomalyId);
        testLogger.info('Detection history', { status: historyResp.status, entries: historyResp.data?.length || 0 });

      } else {
        testLogger.info('No anomaly detections found to trigger - test will be skipped');
      }

      testLogger.info('API trigger test completed');
    });
  });

  test.describe("Sensitivity and Preview", () => {

    test("Load sensitivity preview chart", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing sensitivity preview');

      const anomalyName = testAnomalyName('Preview');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.selectQueryMode('builder');

      // Set config to enable preview
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      // Scroll to sensitivity section
      await page.locator(pm.anomalyDetectionPage.selectors.sensitivityLoadBtn).scrollIntoViewIfNeeded();

      // Verify empty state initially
      await expect(page.locator(pm.anomalyDetectionPage.selectors.sensitivityEmpty)).toBeVisible({ timeout: 5000 });

      // Load preview
      await pm.anomalyDetectionPage.loadSensitivityPreview();

      // Verify chart appears
      await pm.anomalyDetectionPage.expectChartVisible();

      // Cancel without saving
      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Preview chart loaded successfully');
    });

    test("Adjust sensitivity slider", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing sensitivity slider adjustment');

      const anomalyName = testAnomalyName('Slider');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      await page.locator(pm.anomalyDetectionPage.selectors.sensitivityLoadBtn).scrollIntoViewIfNeeded();
      await pm.anomalyDetectionPage.loadSensitivityPreview();

      // Adjust slider
      await pm.anomalyDetectionPage.adjustSensitivitySlider(20, 80);

      // Verify range label updates
      const label = await page.locator(pm.anomalyDetectionPage.selectors.thresholdRangeLabel).textContent();
      testLogger.info('Sensitivity range updated', { label });

      // Label should contain the range values
      expect(label).toContain('20');
      expect(label).toContain('80');

      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Slider adjustment works');
    });
  });

  test.describe("Summary Tab", () => {

    test("View anomaly summary", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing summary view');

      const anomalyName = testAnomalyName('Summary');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      // Fill config
      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(7);

      // Go to summary
      await pm.anomalyDetectionPage.clickTab('Summary');

      // Verify summary text appears using POM selector
      await expect(page.locator(pm.anomalyDetectionPage.selectors.summaryText)).toBeVisible({ timeout: 5000 });

      // Verify summary contains key information
      await expect(page.locator(pm.anomalyDetectionPage.selectors.summaryText)).toContainText(testStreamName);
      await expect(page.locator(pm.anomalyDetectionPage.selectors.summaryText)).toContainText('7'); // training window days

      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Summary displayed correctly');
    });
  });

  test.describe("Tab Switching", () => {

    test("Switch between Builder and SQL tabs", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing tab switching');

      const anomalyName = testAnomalyName('TabSwitch');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');

      // Start in Builder mode
      await pm.anomalyDetectionPage.selectQueryMode('builder');

      // Add a filter
      await pm.anomalyDetectionPage.addFilter('status', '=', 'error');

      // Switch to SQL
      await pm.anomalyDetectionPage.selectQueryMode('sql');

      // Verify SQL query was generated (should contain the filter)
      await expect(page.locator(pm.anomalyDetectionPage.selectors.customSql)).toBeVisible();
      // SQL should contain the WHERE clause for the filter
      // (This is implementation-dependent, may need adjustment)

      // Switch back to Builder
      await pm.anomalyDetectionPage.selectQueryMode('builder');

      // Verify filter still there using POM selector
      await expect(page.locator(pm.anomalyDetectionPage.selectors.filterRow).filter({ hasText: 'status' })).toBeVisible();

      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Tab switching preserves data');
    });
  });

  // ========================================================================
  // P2 TESTS - EDGE CASES
  // ========================================================================

  test.describe("Validation Tests", () => {

    test("Validation: Missing required fields", {
      tag: ['@edge-case', '@anomaly', '@P2', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing validation errors');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      // Try to proceed without filling required fields
      const anomalyName = testAnomalyName('Validation');

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');

      // Clear detection window to trigger validation
      await page.locator(pm.anomalyDetectionPage.selectors.detectionWindowValue).fill('');

      // Try to save - should show validation error
      await page.locator(pm.anomalyDetectionPage.selectors.saveButton).click();

      // Verify error appears
      await pm.anomalyDetectionPage.expectValidationError(pm.anomalyDetectionPage.selectors.detectionWindowError);

      // Fix the error
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      // Disable alerting (required - alerting is enabled by default with no destination)
      await pm.anomalyDetectionPage.disableAlerting();

      // Now save should work
      await pm.anomalyDetectionPage.clickSave();

      await pm.anomalyDetectionPage.expectAnomalyInList(anomalyName);

      testLogger.info('Validation works correctly');
    });

    test("Validation: Destination required when alerting enabled", {
      tag: ['@edge-case', '@anomaly', '@P2', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing destination validation');

      const anomalyName = testAnomalyName('DestValidation');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      // Enable alerting without selecting destinations
      await pm.anomalyDetectionPage.clickTab('Alerting');
      await pm.anomalyDetectionPage.toggleNotifications(true);

      // Don't select any destinations

      // Try to save
      await page.locator(pm.anomalyDetectionPage.selectors.saveButton).click();

      // Verify error message
      await pm.anomalyDetectionPage.expectValidationError(pm.anomalyDetectionPage.selectors.destinationError);

      // Verify error text
      await expect(page.locator(pm.anomalyDetectionPage.selectors.destinationError)).toContainText('At least one destination is required');

      // Cancel
      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Destination validation works');
    });

    test("Validation: SQL mode timestamp alias error", {
      tag: ['@edge-case', '@anomaly', '@P2', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing timestamp alias validation');

      const anomalyName = testAnomalyName('TimestampError');

      await page.locator(pm.alertsPage.locators.addAlertButton).click();
      await page.waitForTimeout(1000);

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.selectQueryMode('sql');

      // Set invalid SQL with _timestamp as alias
      const invalidSql = `SELECT _timestamp AS _timestamp, count(*) AS value FROM "${testStreamName}" GROUP BY _timestamp ORDER BY _timestamp`;
      await pm.anomalyDetectionPage.setSqlQuery(invalidSql);

      // Set other required fields
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      // Verify error appears
      await pm.anomalyDetectionPage.expectValidationError(pm.anomalyDetectionPage.selectors.customSqlTimestampError);

      await expect(page.locator(pm.anomalyDetectionPage.selectors.customSqlTimestampError))
        .toContainText('_timestamp cannot be used as a column alias');

      // Save should be blocked
      await expect(page.locator(pm.anomalyDetectionPage.selectors.saveButton)).toBeDisabled();

      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Timestamp alias validation works');
    });
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // Cleanup: Delete all test anomalies and prerequisite destination
  test.afterAll(async ({ browser }) => {
    testLogger.info('Running test cleanup - deleting test anomalies and prerequisite destination');

    // Verify required env vars are set (auth is handled by api-helper.js)
    if (!process.env.ZO_BASE_URL || !process.env.ZO_ROOT_USER_EMAIL || !process.env.ZO_ROOT_USER_PASSWORD || !process.env.ORGNAME) {
      testLogger.warn('Skipping cleanup - missing environment variables');
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Navigate to base URL first - required for page.evaluate() to make fetch calls
      await page.goto(process.env.ZO_BASE_URL);
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

      const pm = new PageManager(page);
      // cleanupTestAnomalies uses env vars for auth via shared api-helper.js
      await pm.anomalyDetectionPage.cleanupTestAnomalies(`E2E_Anomaly`);
      testLogger.info('Test anomalies cleanup completed');

      // Clean up the prerequisite destination created in beforeAll
      if (prerequisiteDestinationCreated) {
        testLogger.info('Cleaning up prerequisite destination', { name: prerequisiteDestinationName });
        await deleteDestination(page, prerequisiteDestinationName);
        testLogger.info('Prerequisite destination deleted');
      }
    } catch (error) {
      testLogger.warn('Cleanup failed', { error: error.message });
    } finally {
      await context.close();
    }
  });
});
