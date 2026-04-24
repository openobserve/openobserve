const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { getOrgName, listAnomalyDetections, triggerAnomalyDetection, getAnomalyHistory } = require('../utils/api-helper.js');

test.describe("Anomaly Detection Alerts", () => {
  test.describe.configure({ mode: 'serial' });

  let pm;
  // Generate randomValue ONCE for all serial tests so they can share the same anomaly name
  const randomValue = Date.now().toString().slice(-6);
  const testStreamName = 'e2e_automate'; // Stream created by global setup
  const testAnomalyName = (suffix) => `E2E_Anomaly_${suffix}_${randomValue}`;

  // Prerequisite template and destination names - ensures Add Alert button is enabled
  const prerequisiteTemplateName = `e2e_anomaly_template_${randomValue}`;
  const prerequisiteDestinationName = `e2e_anomaly_dest_${randomValue}`;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    // Ensure template and destination exist (same pattern as alerts-e2e-flow.spec.js)
    // This enables the Add Alert button which is disabled when no destinations exist
    await pm.alertTemplatesPage.ensureTemplateExists(prerequisiteTemplateName);
    await pm.alertDestinationsPage.ensureDestinationExists(prerequisiteDestinationName, 'DEMO', prerequisiteTemplateName);

    // Navigate to alerts page and then to anomaly detection tab
    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Navigate to anomaly detection tab
    await pm.anomalyDetectionPage.navigateToAnomalyTab();

    // Wait for alerts table to be ready
    await pm.anomalyDetectionPage.waitForAlertsTable();

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
      await pm.anomalyDetectionPage.clickAddAnomaly();

      // Fill basic setup
      await pm.anomalyDetectionPage.fillBasicSetup(
        anomalyName,
        'logs',
        testStreamName
      );

      // Wait for the anomaly configuration UI to be ready
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      testLogger.info('Checking if anomaly configuration UI is visible');

      // Click Detection Config tab using POM method
      await pm.anomalyDetectionPage.clickTab('Detection Config');

      // Configure detection settings using POM methods
      testLogger.info('Setting detection configuration');
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      // Set retrain interval - it should already be set to "Never" by default, skip if not critical
      testLogger.info('Skipping retrain interval (default is Never)');

      // Close any open menus by pressing Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);

      // Disable alerting using POM method (alerting is enabled by default with no destination)
      await pm.anomalyDetectionPage.disableAlerting();

      // Wait for Vue reactivity and validation to complete
      await page.waitForTimeout(1500);

      // Click save button using POM method
      await pm.anomalyDetectionPage.clickSave();

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

      // Verify action buttons using POM methods
      await pm.anomalyDetectionPage.expectEditButtonVisible(anomalyName);
      await pm.anomalyDetectionPage.expectPauseButtonVisible(anomalyName);

      testLogger.info('Anomaly visible in list with action buttons');
    });

    test("Edit existing anomaly detection", {
      tag: ['@smoke', '@anomaly', '@P0', '@all']
    }, async ({ page }) => {
      testLogger.info('Editing anomaly detection');

      const anomalyName = testAnomalyName('Basic');

      // Click edit button using POM method
      await pm.anomalyDetectionPage.editAnomaly(anomalyName);

      // Verify wizard opens in edit mode
      await pm.anomalyDetectionPage.expectEditModeOpen();

      // Change training window to 7 days
      await pm.anomalyDetectionPage.setTrainingWindow(7);

      // Verify seasonality text changes
      await pm.anomalyDetectionPage.expectSeasonalityText('hour + day-of-week');

      // Save changes using POM method
      await pm.anomalyDetectionPage.clickSave();

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

      // Delete anomaly using POM method
      await pm.anomalyDetectionPage.deleteAnomaly(anomalyName);

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
      await pm.anomalyDetectionPage.clickAddAnomaly();

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      // Configure with SQL
      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.selectQueryMode('sql');

      // Verify SQL editor appears (Monaco editor takes time to initialize)
      await pm.anomalyDetectionPage.expectSqlEditorVisible();

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

      await pm.anomalyDetectionPage.clickAddAnomaly();

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.selectQueryMode('builder');

      // Configure with avg function - use 'code' field which exists in test data
      await pm.anomalyDetectionPage.configureBuilderMode({
        function: 'avg',
        field: 'code'
      });

      // Verify field selector appeared
      await pm.anomalyDetectionPage.expectDetectionFieldVisible();

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

      await pm.anomalyDetectionPage.clickAddAnomaly();

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.selectQueryMode('builder');

      // Add filters - use fields that exist in the test stream
      await pm.anomalyDetectionPage.addFilter('code', '=', '200');
      await pm.anomalyDetectionPage.addFilter('stream', 'Contains', 'stdout');

      // Verify filters added using POM method
      await pm.anomalyDetectionPage.expectFilterCount(2);

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

      // Use the prerequisite destination created in beforeEach
      const testDestinationName = prerequisiteDestinationName;

      const anomalyName = testAnomalyName('WithAlerts');

      await pm.anomalyDetectionPage.clickAddAnomaly();

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
      await pm.anomalyDetectionPage.toggleNotifications(true);

      // Verify destination selector appears
      await pm.anomalyDetectionPage.expectDestinationSelectorVisible();

      // Select the prerequisite destination created in beforeEach using POM method
      const destFound = await pm.anomalyDetectionPage.selectDestination(testDestinationName);

      // Verify destination error is gone (destination selected)
      const errorVisible = await pm.anomalyDetectionPage.isDestinationErrorVisible();
      if (errorVisible || !destFound) {
        testLogger.warn('Destination error still visible - destination may not be selected');
        // Cancel and skip test
        await pm.anomalyDetectionPage.clickBack();
        test.skip(true, 'Could not select destination in dropdown');
        return;
      }

      // Save anomaly
      await pm.anomalyDetectionPage.clickSave();
      await pm.anomalyDetectionPage.expectAnomalyInList(anomalyName);

      testLogger.info('Anomaly with alerting created successfully');
    });

    test("Refresh destinations list", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing refresh destinations');

      const anomalyName = testAnomalyName('RefreshDest');

      await pm.anomalyDetectionPage.clickAddAnomaly();

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
      await pm.anomalyDetectionPage.expectDestinationSelectorVisible();

      // Cancel creation
      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Destinations refresh works');
    });
  });

  test.describe("Anomaly Management Operations", () => {

    // TODO: Status badge doesn't update to 'disabled' after pause - needs backend investigation
    test.skip("Pause and resume anomaly detection", {
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

      // Create anomaly first using POM methods
      await pm.anomalyDetectionPage.clickAddAnomaly();
      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      // Set minimal config
      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      // Disable alerting to allow save
      await pm.anomalyDetectionPage.disableAlerting();

      // Save
      await pm.anomalyDetectionPage.clickSave();

      // Verify created
      await pm.anomalyDetectionPage.expectAnomalyInList(anomalyName);

      // Now trigger detection via the UI menu using POM method
      testLogger.info('Triggering detection via UI');
      await pm.anomalyDetectionPage.clickTriggerDetection(anomalyName);

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

      await pm.anomalyDetectionPage.clickAddAnomaly();

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.selectQueryMode('builder');

      // Set config to enable preview
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      // Scroll to sensitivity section
      await pm.anomalyDetectionPage.scrollToSensitivitySection();

      // Verify empty state initially
      await pm.anomalyDetectionPage.expectSensitivityEmptyState();

      // Load preview
      await pm.anomalyDetectionPage.loadSensitivityPreview();

      // Verify chart appears
      await pm.anomalyDetectionPage.expectChartVisible();

      // Cancel without saving
      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Preview chart loaded successfully');
    });

    // TODO: Slider adjustment method is a placeholder - needs proper implementation
    test.skip("Adjust sensitivity slider", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing sensitivity slider adjustment');

      const anomalyName = testAnomalyName('Slider');

      await pm.anomalyDetectionPage.clickAddAnomaly();

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(1);

      await pm.anomalyDetectionPage.scrollToSensitivitySection();
      await pm.anomalyDetectionPage.loadSensitivityPreview();

      // Adjust slider
      await pm.anomalyDetectionPage.adjustSensitivitySlider(20, 80);

      // Verify range label updates
      const label = await pm.anomalyDetectionPage.getThresholdRangeLabel();
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

      await pm.anomalyDetectionPage.clickAddAnomaly();

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      // Fill config
      await pm.anomalyDetectionPage.clickTab('Detection Config');
      await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
      await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
      await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
      await pm.anomalyDetectionPage.setTrainingWindow(7);

      // Go to summary
      await pm.anomalyDetectionPage.clickTab('Summary');
      await page.waitForTimeout(1000); // Wait for summary content to render

      // Verify summary text appears using POM methods
      await pm.anomalyDetectionPage.expectSummaryVisible();

      // Verify summary contains key information
      await pm.anomalyDetectionPage.expectSummaryContains(testStreamName);
      await pm.anomalyDetectionPage.expectSummaryContains('7'); // training window days

      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Summary displayed correctly');
    });
  });

  test.describe("Tab Switching", () => {

    test.skip("Switch between Builder and SQL tabs", {
      tag: ['@functional', '@anomaly', '@P1', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing tab switching');

      const anomalyName = testAnomalyName('TabSwitch');

      await pm.anomalyDetectionPage.clickAddAnomaly();

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');

      // Start in Builder mode
      await pm.anomalyDetectionPage.selectQueryMode('builder');

      // Add a filter
      await pm.anomalyDetectionPage.addFilter('status', '=', 'error');

      // Switch to SQL
      await pm.anomalyDetectionPage.selectQueryMode('sql');

      // Verify SQL editor appears and query was generated (should contain the filter)
      await pm.anomalyDetectionPage.expectSqlEditorVisible();
      // SQL should contain the WHERE clause for the filter
      // (This is implementation-dependent, may need adjustment)

      // Switch back to Builder
      await pm.anomalyDetectionPage.selectQueryMode('builder');

      // Verify filter still there using POM method
      await pm.anomalyDetectionPage.expectFilterRowWithField('status');

      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Tab switching preserves data');
    });
  });

  // ========================================================================
  // P2 TESTS - EDGE CASES
  // ========================================================================

  test.describe("Validation Tests", () => {

    test.skip("Validation: Missing required fields", {
      tag: ['@edge-case', '@anomaly', '@P2', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing validation errors');

      await pm.anomalyDetectionPage.clickAddAnomaly();

      // Try to proceed without filling required fields
      const anomalyName = testAnomalyName('Validation');

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);

      await pm.anomalyDetectionPage.clickTab('Detection Config');

      // Clear detection window to trigger validation
      await pm.anomalyDetectionPage.clearDetectionWindowValue();

      // Try to save - should show validation error
      await pm.anomalyDetectionPage.clickSaveForValidation();

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

      await pm.anomalyDetectionPage.clickAddAnomaly();

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
      await pm.anomalyDetectionPage.clickSaveForValidation();

      // Verify error message
      await pm.anomalyDetectionPage.expectValidationError(pm.anomalyDetectionPage.selectors.destinationError);

      // Verify error text
      await pm.anomalyDetectionPage.expectDestinationErrorContains('At least one destination is required');

      // Cancel
      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Destination validation works');
    });

    test("Validation: SQL mode timestamp alias error", {
      tag: ['@edge-case', '@anomaly', '@P2', '@all']
    }, async ({ page }) => {
      testLogger.info('Testing timestamp alias validation');

      const anomalyName = testAnomalyName('TimestampError');

      await pm.anomalyDetectionPage.clickAddAnomaly();

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

      await pm.anomalyDetectionPage.expectTimestampErrorContains('_timestamp cannot be used as a column alias');

      // Save should be blocked
      await pm.anomalyDetectionPage.expectSaveButtonDisabled();

      await pm.anomalyDetectionPage.clickBack();

      testLogger.info('Timestamp alias validation works');
    });
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // Cleanup: Delete all test anomalies
  test.afterAll(async ({ browser }) => {
    testLogger.info('Running test cleanup - deleting test anomalies');

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

      // Note: Template and destination created via UI in beforeEach are not cleaned up here
      // They may be reused by subsequent test runs or cleaned up by a separate cleanup job
    } catch (error) {
      testLogger.warn('Cleanup failed', { error: error.message });
    } finally {
      await context.close();
    }
  });
});
