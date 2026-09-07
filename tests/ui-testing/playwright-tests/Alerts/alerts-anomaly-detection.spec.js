// Copyright 2026 OpenObserve Inc.
//
// Anomaly Detection — end-to-end suite.
//
// Anomaly detection is an alert *type*, not a module: it lives behind the
// `anomalyDetection` tab on the Alerts list and is edited in the AddAlert
// wizard's anomaly-config / anomaly-alerting tabs. This file is the single
// anomaly suite — it replaces the former Anomaly/ folder and the separate
// anomaly-detection-form-validation spec.
//
// ENTERPRISE-ONLY. `anomaly_detection_enabled` is false unless the binary is
// built with --features enterprise, and OSS CI is not, so every test here skips
// there. Deliberately absent from the OSS ci_matrix.json — build-ci-matrix.js
// rejects a spec listed in both the base and the overlay — and registered in
// o2-enterprise's ci_matrix.ent.json under `append.Alerts` instead.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { listAnomalyDetections, triggerAnomalyDetection, getAnomalyHistory, deleteDestination, deleteTemplate, createMockDestination, destinationExists, searchSql, seedAnomalyStream, waitForStream,
  triggerAnomalyTraining, waitForAnomalyTrained } = require('../utils/api-helper.js');

test.describe('Anomaly Detection', () => {
  let pm;
  // One value per run so the lifecycle chain can hand names between tests.
  const randomValue = Date.now().toString().slice(-6);
  const testStreamName = 'e2e_automate';
  const anomalyName = (suffix) => `E2E_Anomaly_${suffix}_${randomValue}`;

  // The Add button is disabled while the org has no destination, so both must
  // exist before any wizard test can open.
  const prerequisiteTemplateName = `e2e_anomaly_template_${randomValue}`;
  const prerequisiteDestinationName = `e2e_anomaly_dest_${randomValue}`;

  const builderAnomaly = anomalyName('builder');
  const sqlAnomaly = anomalyName('sql');

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    await pm.alertTemplatesPage.ensureTemplateExists(prerequisiteTemplateName);
    // Created through the API, like the template above, rather than driven
    // through the destinations form. The URL must be routable and absolute:
    // the SSRF guard rejects bare placeholders ("relative URL without a base")
    // and private IPs, and a silently failed create leaves every test without
    // the destination it later selects.
    const dest = await createMockDestination(
      page,
      prerequisiteDestinationName,
      prerequisiteTemplateName,
    );
    // beforeEach runs before every test, so only the first call in a worker
    // actually creates it; the rest come back 400 "already exists" (not 409).
    // Assert the destination EXISTS rather than pinning a status code — that
    // is what the tests depend on, and it survives the API changing its mind.
    if (dest.status !== 200) {
      expect(
        await destinationExists(page, prerequisiteDestinationName),
        `destination ${prerequisiteDestinationName} missing; create returned ${dest.status}: ${JSON.stringify(dest.data)}`,
      ).toBe(true);
    }

    // Presence of the tab is the only honest feature check — AlertList coerces
    // activeTab back to "all" without rewriting ?tab=, so the URL always lies.
    const available = await pm.anomalyDetectionPage.isAnomalyDetectionAvailable();
    test.skip(!available, 'Anomaly Detection is disabled on this build (OSS, or ZO_ANOMALY_DETECTION_DISABLED)');

    await pm.anomalyDetectionPage.navigateToAnomalyTab();
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // ════════════════════════════════════════════════════════════════════════
  // Form validation — the wizard never disables Save; it validates on click
  // ════════════════════════════════════════════════════════════════════════

  test.describe('Form validation', () => {
    test('blank name blocks save and paints the name field', {
      tag: ['@anomaly', '@P0', '@smoke', '@all'],
    }, async () => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();

      // OForm keeps submit enabled and validates on click, so the offending
      // field gets painted rather than the user guessing why a grey button
      // does nothing.
      await expect(pm.anomalyDetectionPage.getSaveBtnLocator()).toBeEnabled();
      await pm.anomalyDetectionPage.save();

      await expect(pm.anomalyDetectionPage.getNameErrorLocator()).toHaveText('Anomaly name is required.');
      await expect(
        pm.anomalyDetectionPage.getToastLocator(/fix the highlighted fields/i),
      ).toBeVisible();

      await pm.anomalyDetectionPage.cancel();
    });

    test('stream type select is present when the wizard opens', {
      tag: ['@anomaly', '@P0', '@smoke', '@all'],
    }, async ({ page }) => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await expect(page.locator(pm.anomalyDetectionPage.selectors.streamTypeSelect)).toBeVisible();
      await pm.anomalyDetectionPage.cancel();
    });

    test('cancel closes the wizard and returns to the list', {
      tag: ['@anomaly', '@P2', '@functional', '@all'],
    }, async ({ page }) => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await pm.anomalyDetectionPage.cancel();
      await expect(page.locator(pm.anomalyDetectionPage.selectors.listTable)).toBeVisible();
    });

    test('destination is required once notifications are enabled', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async () => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName('destreq'), 'logs', testStreamName);
      await pm.anomalyDetectionPage.openAlertingTab();
      await pm.anomalyDetectionPage.toggleNotifications(true);
      await pm.anomalyDetectionPage.save();

      await expect(pm.anomalyDetectionPage.getDestinationErrorLocator()).toBeVisible();
      await pm.anomalyDetectionPage.cancel();
    });

    test('SQL mode rejects aliasing the timestamp column', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async ({ page }) => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName('alias'), 'logs', testStreamName);
      await pm.anomalyDetectionPage.openConfigTab();
      await pm.anomalyDetectionPage.selectQueryMode('custom_sql');
      await pm.anomalyDetectionPage.setCustomSql(
        `SELECT histogram(_timestamp) AS _timestamp, count(*) AS value FROM "${testStreamName}"`,
      );
      await pm.anomalyDetectionPage.save();

      // Bare-Monaco errors only render after the first submit attempt.
      await expect(
        page.locator(pm.anomalyDetectionPage.selectors.customSqlTimestampError),
      ).toBeVisible();
      await pm.anomalyDetectionPage.cancel();
    });

    test('empty SQL in custom_sql mode blocks save', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async ({ page }) => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName('emptysql'), 'logs', testStreamName);
      await pm.anomalyDetectionPage.openConfigTab();
      await pm.anomalyDetectionPage.selectQueryMode('custom_sql');
      // The mode switch seeds a default query, so the editor has to be emptied
      // to reach the required-SQL state at all.
      await pm.anomalyDetectionPage.clearCustomSql();
      await pm.anomalyDetectionPage.save();

      await expect(
        page.locator(pm.anomalyDetectionPage.selectors.customSqlRequiredError),
      ).toBeVisible();
      await pm.anomalyDetectionPage.cancel();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Sensitivity — tier toggle and percentile input share the `threshold` field
  // ════════════════════════════════════════════════════════════════════════

  test.describe('Sensitivity', () => {
    test.beforeEach(async () => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName('sens'), 'logs', testStreamName);
      await pm.anomalyDetectionPage.openConfigTab();
    });

    test.afterEach(async () => {
      await pm.anomalyDetectionPage.cancel();
    });

    test('each tier writes its percentile into the shared threshold field', {
      tag: ['@anomaly', '@P0', '@smoke', '@all'],
    }, async () => {
      for (const [tier, percentile] of [[99, '99'], [97, '97'], [95, '95']]) {
        await pm.anomalyDetectionPage.selectSensitivityTier(tier);
        expect(await pm.anomalyDetectionPage.getSensitivityPercentile()).toBe(percentile);
        expect(await pm.anomalyDetectionPage.getActiveSensitivityTier()).toBe(tier);
      }
    });

    test('typing a tier percentile lights that tier up', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async () => {
      await pm.anomalyDetectionPage.setSensitivityPercentile(95);
      expect(await pm.anomalyDetectionPage.getActiveSensitivityTier()).toBe(95);
    });

    test('an off-tier percentile is accepted with no tier selected', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async () => {
      await pm.anomalyDetectionPage.setSensitivityPercentile(88);
      await expect(pm.anomalyDetectionPage.getSensitivityErrorLocator()).toBeHidden();
      expect(await pm.anomalyDetectionPage.getActiveSensitivityTier()).toBeNull();
    });

    test('the hint restates the flag rate at the current resolution', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async () => {
      await pm.anomalyDetectionPage.setHistogramInterval(5, 'm');
      await pm.anomalyDetectionPage.selectSensitivityTier(97);

      // 97 flags the most unusual 3% of buckets; at 5m resolution that is
      // 288 buckets/day * 0.03 ≈ 9 per day.
      const hint = pm.anomalyDetectionPage.getSensitivityHintLocator();
      await expect(hint).toBeVisible();
      await expect(hint).toContainText('3%');
      await expect(hint).toContainText('5m');
    });

    test('the hint recomputes when the resolution changes', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async () => {
      await pm.anomalyDetectionPage.selectSensitivityTier(97);
      await pm.anomalyDetectionPage.setHistogramInterval(5, 'm');
      const atFiveMinutes = await pm.anomalyDetectionPage.getSensitivityHintLocator().textContent();

      await pm.anomalyDetectionPage.setHistogramInterval(1, 'h');
      await expect(pm.anomalyDetectionPage.getSensitivityHintLocator()).not.toHaveText(atFiveMinutes);
      await expect(pm.anomalyDetectionPage.getSensitivityHintLocator()).toContainText('1h');
    });

    for (const [label, value] of [['below the floor', 49], ['above the ceiling', 100], ['fractional', 97.5]]) {
      test(`rejects a ${label} percentile`, {
        tag: ['@anomaly', '@P1', '@functional', '@all'],
      }, async () => {
        await pm.anomalyDetectionPage.setSensitivityPercentile(value);
        await pm.anomalyDetectionPage.save();
        await expect(pm.anomalyDetectionPage.getSensitivityErrorLocator()).toHaveText(
          'Enter a whole number between 50 and 99',
        );
      });
    }

    test('the hint is suppressed while the percentile is invalid', {
      tag: ['@anomaly', '@P2', '@functional', '@all'],
    }, async () => {
      await pm.anomalyDetectionPage.setSensitivityPercentile(49);
      await expect(pm.anomalyDetectionPage.getSensitivityHintLocator()).toBeHidden();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Builder mode — filters and the read-only SQL preview
  // ════════════════════════════════════════════════════════════════════════

  test.describe('Builder mode', () => {
    test.beforeEach(async () => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName('builderui'), 'logs', testStreamName);
      await pm.anomalyDetectionPage.openConfigTab();
    });

    test.afterEach(async () => {
      await pm.anomalyDetectionPage.cancel();
    });

    test('the detection-function field appears only for non-count functions', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async ({ page }) => {
      const fieldSelect = page.locator(pm.anomalyDetectionPage.selectors.detectionFunctionField);
      await expect(fieldSelect).toBeHidden();

      await pm.anomalyDetectionPage.selectDetectionFunction('avg');
      await expect(fieldSelect).toBeVisible();

      await pm.anomalyDetectionPage.selectDetectionFunction('count');
      await expect(fieldSelect).toBeHidden();
    });

    test('filters can be added and removed', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async () => {
      const rows = pm.anomalyDetectionPage.getFilterRows();
      const initial = await rows.count();

      await pm.anomalyDetectionPage.addFilter('kubernetes_namespace_name', '=', 'ziox');
      await expect(rows).toHaveCount(initial + 1);

      await pm.anomalyDetectionPage.removeFilter(initial);
      await expect(rows).toHaveCount(initial);
    });

    test('the SQL preview reflects the builder configuration', {
      tag: ['@anomaly', '@P0', '@smoke', '@all'],
    }, async () => {
      await pm.anomalyDetectionPage.selectDetectionFunction('count');
      await pm.anomalyDetectionPage.setHistogramInterval(5, 'm');

      const sql = await pm.anomalyDetectionPage.getSqlPreviewText();
      // The anomaly query must alias its time column as time_bucket and its
      // measure as value — that contract is what the preview proves.
      expect(sql).toContain('time_bucket');
      expect(sql).toContain(testStreamName);
    });

    test('the SQL preview is hidden in custom_sql mode', {
      tag: ['@anomaly', '@P2', '@functional', '@all'],
    }, async ({ page }) => {
      await expect(page.locator(pm.anomalyDetectionPage.selectors.sqlPreview)).toBeVisible();
      await pm.anomalyDetectionPage.selectQueryMode('custom_sql');
      await expect(page.locator(pm.anomalyDetectionPage.selectors.sqlPreview)).toBeHidden();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Data preview — auto-loads, no "Load preview" button any more
  // ════════════════════════════════════════════════════════════════════════

  test.describe('Data preview', () => {
    test('empty until a stream is chosen, then populates on its own', {
      tag: ['@anomaly', '@P0', '@smoke', '@all'],
    }, async () => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await expect(pm.anomalyDetectionPage.getDataPreviewEmptyLocator()).toBeVisible();

      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName('preview'), 'logs', testStreamName);

      // Edits are debounced 600ms before the query fires; nothing is clicked.
      await pm.anomalyDetectionPage.waitForDataPreview();
      await expect(pm.anomalyDetectionPage.getDataPreviewEmptyLocator()).toBeHidden();

      await pm.anomalyDetectionPage.cancel();
    });

    test('a mid-edit blank interval keeps the last chart instead of blanking', {
      tag: ['@anomaly', '@P2', '@functional', '@all'],
    }, async () => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName('previewedit'), 'logs', testStreamName);
      await pm.anomalyDetectionPage.waitForDataPreview();

      await pm.anomalyDetectionPage.openConfigTab();
      await pm.anomalyDetectionPage.fillFormInput(
        pm.anomalyDetectionPage.selectors.histogramIntervalValue,
        '',
      );

      // canPreview goes false, which blocks the query but must not tear the
      // chart down — the empty state means "nothing to preview", not "invalid".
      await expect(pm.anomalyDetectionPage.getDataPreviewChartLocator()).toBeVisible();

      await pm.anomalyDetectionPage.cancel();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Alerting step — priority, tags, destinations
  // ════════════════════════════════════════════════════════════════════════

  test.describe('Alerting configuration', () => {
    test.beforeEach(async () => {
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await pm.anomalyDetectionPage.fillBasicSetup(anomalyName('alerting'), 'logs', testStreamName);
      await pm.anomalyDetectionPage.openAlertingTab();
    });

    test.afterEach(async () => {
      await pm.anomalyDetectionPage.cancel();
    });

    test('priority and tags are settable', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async ({ page }) => {
      await pm.anomalyDetectionPage.selectPriority(2);
      // Assert the rendered label, not data-test-selected-value: OSelect emits
      // that attribute only from its searchable trigger, and priority is a
      // non-searchable select rendered by the reka SelectTrigger branch.
      await expect(
        page.locator(`${pm.anomalyDetectionPage.selectors.prioritySelect} [data-test$="-trigger"]`),
      ).toContainText('P2');

      await pm.anomalyDetectionPage.addTags(['team-platform']);
      await expect(page.locator(pm.anomalyDetectionPage.selectors.tagsInput)).toContainText('team-platform');
    });

    test('the destination picker appears only when notifications are on', {
      tag: ['@anomaly', '@P1', '@functional', '@all'],
    }, async ({ page }) => {
      const destination = page.locator(pm.anomalyDetectionPage.selectors.destination);
      await pm.anomalyDetectionPage.toggleNotifications(false);
      await expect(destination).toBeHidden();

      await pm.anomalyDetectionPage.toggleNotifications(true);
      await expect(destination).toBeVisible();
    });

    test('the destination list can be refreshed', {
      tag: ['@anomaly', '@P2', '@functional', '@all'],
    }, async ({ page }) => {
      await pm.anomalyDetectionPage.toggleNotifications(true);
      await pm.anomalyDetectionPage.refreshDestinations();
      await expect(page.locator(pm.anomalyDetectionPage.selectors.destination)).toBeVisible();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Lifecycle and detection charts
  //
  // Serial: these share one anomaly, created by the first test and deleted by
  // the last, and the charts read that same record. They sit under one parent
  // so the ordering is declared rather than depending across describes — and so
  // a failure here cannot abort the independent describes above.
  // ════════════════════════════════════════════════════════════════════════

  test.describe('Lifecycle and detection charts', () => {
    test.describe.configure({ mode: 'serial' });

    test.describe('Lifecycle', () => {
      test('creates an anomaly in builder mode', {
        tag: ['@anomaly', '@P0', '@smoke', '@all'],
      }, async () => {
        await pm.anomalyDetectionPage.openAddAnomalyWizard();
        await pm.anomalyDetectionPage.fillBasicSetup(builderAnomaly, 'logs', testStreamName);

        await pm.anomalyDetectionPage.openConfigTab();
        await pm.anomalyDetectionPage.selectDetectionFunction('count');
        await pm.anomalyDetectionPage.setHistogramInterval(5, 'm');
        await pm.anomalyDetectionPage.setScheduleInterval(10, 'm');
        await pm.anomalyDetectionPage.setDetectionWindow(1, 'h');
        await pm.anomalyDetectionPage.setTrainingWindow(7);
        await pm.anomalyDetectionPage.selectRetrainInterval(7);
        await pm.anomalyDetectionPage.selectSensitivityTier(97);

        await pm.anomalyDetectionPage.openAlertingTab();
        await pm.anomalyDetectionPage.toggleNotifications(true);
        await pm.anomalyDetectionPage.selectDestinations([prerequisiteDestinationName]);

        await pm.anomalyDetectionPage.saveAndExpectSuccess();

        await pm.anomalyDetectionPage.navigateToAnomalyTab();
        await pm.anomalyDetectionPage.searchAnomaly(builderAnomaly);
        await expect(pm.anomalyDetectionPage.getRow(builderAnomaly)).toBeVisible();
      });

      test('creates an anomaly in SQL mode', {
        tag: ['@anomaly', '@P1', '@functional', '@all'],
      }, async () => {
        await pm.anomalyDetectionPage.openAddAnomalyWizard();
        await pm.anomalyDetectionPage.fillBasicSetup(sqlAnomaly, 'logs', testStreamName);

        await pm.anomalyDetectionPage.openConfigTab();
        await pm.anomalyDetectionPage.selectQueryMode('custom_sql');
        await pm.anomalyDetectionPage.setCustomSql(
          `SELECT histogram(_timestamp, '5 minute') AS time_bucket, count(*) AS value FROM "${testStreamName}" GROUP BY time_bucket`,
        );
        await pm.anomalyDetectionPage.setHistogramInterval(5, 'm');

        await pm.anomalyDetectionPage.openAlertingTab();
        await pm.anomalyDetectionPage.toggleNotifications(false);

        await pm.anomalyDetectionPage.saveAndExpectSuccess();

        await pm.anomalyDetectionPage.navigateToAnomalyTab();
        await pm.anomalyDetectionPage.searchAnomaly(sqlAnomaly);
        await expect(pm.anomalyDetectionPage.getRow(sqlAnomaly)).toBeVisible();
      });

      test('edit mode loads the saved configuration', {
        tag: ['@anomaly', '@P1', '@functional', '@all'],
      }, async ({ page }) => {
        await pm.anomalyDetectionPage.searchAnomaly(builderAnomaly);
        await pm.anomalyDetectionPage.openEdit(builderAnomaly);

        // The name is readonly in edit mode, so it renders as plain text.
        await expect(page.locator(pm.anomalyDetectionPage.selectors.nameValue)).toContainText(builderAnomaly);

        await pm.anomalyDetectionPage.openConfigTab();
        // The percentile readback only exists where the tier controls do; on
        // older builds the edit-load path is still covered by the name above.
        if (await pm.anomalyDetectionPage.hasSensitivityTiers()) {
          expect(await pm.anomalyDetectionPage.getSensitivityPercentile()).toBe('97');
        }

        await pm.anomalyDetectionPage.cancel();
      });

      test('pause and resume toggle the anomaly', {
        tag: ['@anomaly', '@P1', '@functional', '@all'],
      }, async () => {
        await pm.anomalyDetectionPage.searchAnomaly(builderAnomaly);
        await pm.anomalyDetectionPage.togglePause(builderAnomaly);
        await expect(pm.anomalyDetectionPage.getToastLocator(/success/i)).toBeVisible();

        await pm.anomalyDetectionPage.togglePause(builderAnomaly);
        await expect(pm.anomalyDetectionPage.getRow(builderAnomaly)).toBeVisible();
      });

      test('detection can be triggered from the row menu', {
        tag: ['@anomaly', '@P2', '@functional', '@all'],
      }, async () => {
        await pm.anomalyDetectionPage.searchAnomaly(builderAnomaly);
        await pm.anomalyDetectionPage.triggerDetection(builderAnomaly);
        await expect(pm.anomalyDetectionPage.getToastLocator(/detection|triggered/i)).toBeVisible();
      });

      test('detection can be triggered via the API and lands in history', {
        tag: ['@anomaly', '@P2', '@api', '@all'],
      }, async ({ page }) => {
        const anomalies = await listAnomalyDetections(page);
        const target = anomalies.find((a) => a.name === builderAnomaly);
        expect(target, `anomaly ${builderAnomaly} should be listed by the API`).toBeTruthy();

        const id = target.anomaly_id || target.id;
        const triggered = await triggerAnomalyDetection(page, id);

        // A config created seconds ago has no trained model yet, so a detection
        // run is expected to be refused. What matters is that the refusal says
        // why — the handler funnels every non-"not found" error into a 500, so
        // an empty body here would leave the caller with nothing to act on.
        if (![200, 202].includes(triggered.status)) {
          const body = JSON.stringify(triggered.data ?? triggered.body ?? {});
          expect(
            body.length > 2,
            `detect returned ${triggered.status} with no explanation: ${body}`,
          ).toBe(true);
          testLogger.info('Detection refused on an untrained config', {
            status: triggered.status,
            body,
          });
        }

        // getAnomalyHistory returns the raw {status, data} envelope and the
        // endpoint serialises a bare array, verified against a live response.
        // (The DetectionHistoryResponse {history: [...]} utoipa annotation on
        // the handler does NOT match what it actually returns.)
        const history = await getAnomalyHistory(page, id);
        expect(history.status).toBe(200);
        expect(Array.isArray(history.data)).toBe(true);
      });

      test('deletes an anomaly', {
        tag: ['@anomaly', '@P0', '@smoke', '@all'],
      }, async () => {
        await pm.anomalyDetectionPage.searchAnomaly(sqlAnomaly);
        await pm.anomalyDetectionPage.deleteAnomaly(sqlAnomaly);
        await expect(pm.anomalyDetectionPage.getRow(sqlAnomaly)).toBeHidden();
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Detection charts — three readings of the `_anomalies` stream
    // ══════════════════════════════════════════════════════════════════════

    test.describe('Detection charts', () => {
      test('the detail page renders all three panels behind one range picker', {
        tag: ['@anomaly', '@P1', '@functional', '@all'],
      }, async () => {
        await pm.anomalyDetectionPage.searchAnomaly(builderAnomaly);
        await pm.anomalyDetectionPage.openDetail(builderAnomaly);

        await expect(pm.anomalyDetectionPage.getDetectionChartsLocator()).toBeVisible();
        for (const key of ['metric', 'score', 'deviation']) {
          await expect(pm.anomalyDetectionPage.getChartPanelLocator(key)).toBeVisible();
        }
      });

      test('the shared range picker drives every panel', {
        tag: ['@anomaly', '@P2', '@functional', '@all'],
      }, async ({ page }) => {
        await pm.anomalyDetectionPage.searchAnomaly(builderAnomaly);
        await pm.anomalyDetectionPage.openDetail(builderAnomaly);
        await expect(pm.anomalyDetectionPage.getDetectionChartsLocator()).toBeVisible();

        // One picker for all three: separate pickers would let the panels
        // silently disagree about which window they are showing.
        for (const range of ['1h', '6h', '24h']) {
          await pm.anomalyDetectionPage.selectChartRange(range);
          await expect(
            page.locator(pm.anomalyDetectionPage.selectors.chartRangeItem(range)),
          ).toHaveAttribute('data-state', 'on');
        }
      });

      test('a panel with no model data shows its unavailable state, not a broken chart', {
        tag: ['@anomaly', '@P2', '@functional', '@all'],
      }, async () => {
        await pm.anomalyDetectionPage.searchAnomaly(builderAnomaly);
        await pm.anomalyDetectionPage.openDetail(builderAnomaly);

        // A freshly created anomaly has not trained, so each panel is either a
        // rendered chart or the explicit unavailable state — never neither.
        // Poll rather than count once: the panels mount asynchronously, and a
        // bare count() races the render instead of waiting for it.
        for (const key of ['metric', 'score', 'deviation']) {
          const body = pm.anomalyDetectionPage.getChartBodyLocator(key);
          const empty = pm.anomalyDetectionPage.getChartEmptyLocator(key);
          await expect
            .poll(async () => (await body.count()) + (await empty.count()), {
              timeout: 30000,
              message: `panel ${key} rendered neither a chart nor its empty state`,
            })
            .toBeGreaterThan(0);
        }
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // End to end: a seeded spike is trained on, detected, alerted and charted.
  //
  // The only test that exercises the feature's actual purpose. Everything else
  // stops at "the config saved"; this one proves the model fires. Training
  // needs history, so the stream is seeded with backdated buckets — the shared
  // e2e_automate stream is all stamped "now" and cannot train a model.
  // ════════════════════════════════════════════════════════════════════════

  test.describe('End to end detection', () => {
    test.describe.configure({ mode: 'serial' });

    const firingName = anomalyName('fire');
    const seededStream = `anomaly_e2e_${randomValue}`;

    test('a seeded spike is detected, alerted on, and charted', {
      tag: ['@anomaly', '@P0', '@smoke', '@e2e', '@all'],
    }, async ({ page }) => {
      test.slow();

      // 2 days of 5m buckets at a flat baseline, with a 120-count spike in the
      // most recent buckets so it lands inside the 1h detection window.
      const seed = await seedAnomalyStream(page, seededStream, {
        hours: 4,
        bucketSeconds: 60,
        baseline: 10,
        spikeValue: 120,
        spikeBuckets: 4,
      });
      expect(seed.status, `seeding ${seededStream} failed: ${JSON.stringify(seed.data)}`).toBe(200);
      await waitForStream(page, seededStream);
      // The app caches its stream list from page load, which happened before
      // the seed — without a reload the new stream is absent from the picker
      // even though the API already lists it.
      await page.reload();
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

      await pm.anomalyDetectionPage.navigateToAnomalyTab();
      await pm.anomalyDetectionPage.openAddAnomalyWizard();
      await pm.anomalyDetectionPage.fillBasicSetup(firingName, 'logs', seededStream);

      await pm.anomalyDetectionPage.openConfigTab();
      await pm.anomalyDetectionPage.selectDetectionFunction('count');
      // Resolution matches the seeded bucket width — at 5m the 1m buckets
      // collapse and the model sees a fifth of the points.
      await pm.anomalyDetectionPage.setHistogramInterval(1, 'm');
      await pm.anomalyDetectionPage.setScheduleInterval(10, 'm');
      await pm.anomalyDetectionPage.setDetectionWindow(1, 'h');
      await pm.anomalyDetectionPage.setTrainingWindow(1);
      await pm.anomalyDetectionPage.selectSensitivityTier(95);

      await pm.anomalyDetectionPage.openAlertingTab();
      await pm.anomalyDetectionPage.toggleNotifications(true);
      await pm.anomalyDetectionPage.selectDestinations([prerequisiteDestinationName]);
      await pm.anomalyDetectionPage.saveAndExpectSuccess();

      const configs = await listAnomalyDetections(page);
      const created = configs.find((c) => c.name === firingName);
      expect(created, `${firingName} should be listed by the API`).toBeTruthy();
      const id = created.anomaly_id || created.id;

      // The notification is sent inline by the detection run, gated on
      // `anomaly_count > 0 && alert_enabled`. If the wizard failed to persist
      // either of these, detection still "succeeds" and no alert is ever sent —
      // a silent hole this suite would otherwise not notice.
      expect(created.alert_enabled, 'alert_enabled must persist from the wizard').toBe(true);
      expect(created.alert_destinations).toContain(prerequisiteDestinationName);

      // Training and detection have no UI trigger that reports completion, so
      // they are driven through the API; the assertions below are on the result.
      const trainStarted = await triggerAnomalyTraining(page, id);
      expect([200, 202]).toContain(trainStarted.status);
      const trained = await waitForAnomalyTrained(page, id);
      expect(trained.is_trained).toBe(true);

      const detected = await triggerAnomalyDetection(page, id);
      expect(
        detected.status,
        `detection failed: ${JSON.stringify(detected.data)}`,
      ).toBe(200);

      // The spike must be found, and found as the worst point — a run that
      // flags only baseline noise would otherwise look like a pass.
      expect(detected.data.anomalies_found).toBeGreaterThan(0);
      const worst = Math.max(...detected.data.anomalies.map((a) => a.actual_value));
      expect(worst).toBe(120);
      const spike = detected.data.anomalies.find((a) => a.actual_value === 120);
      expect(spike.is_anomaly).toBe(true);
      expect(spike.score).toBeGreaterThan(spike.threshold_value);

      // Each detection run writes one row per scored bucket to _anomalies,
      // which is the only source the detail-page charts read.
      await pm.anomalyDetectionPage.navigateToAnomalyTab();
      await pm.anomalyDetectionPage.searchAnomaly(firingName);
      await pm.anomalyDetectionPage.openDetail(firingName);
      await expect(pm.anomalyDetectionPage.getDetectionChartsLocator()).toBeVisible();
      for (const key of ['metric', 'score', 'deviation']) {
        await expect(pm.anomalyDetectionPage.getChartPanelLocator(key)).toBeVisible();
      }

      // The flagged overlay must sit exactly ON the metric it marks. The
      // renderer colours a series, not a segment, so the flagged buckets are a
      // second null-gapped line — and taking max(actual_value) over the flagged
      // ROWS instead of the bucket reads a different row wherever a bucket holds
      // both a flagged and an unflagged point, drawing the overlay BELOW the
      // metric. The SQL shape is unit-tested; this checks the values it returns.
      const chartRows = await searchSql(
        page,
        `SELECT histogram(_timestamp, '5m') AS zo_sql_key, ` +
          `max(actual_value) AS zo_sql_num, ` +
          `CASE WHEN max(CASE WHEN is_anomaly THEN 1 ELSE 0 END) = 1 ` +
          `THEN max(actual_value) END AS anomaly_value ` +
          `FROM "_anomalies" WHERE anomaly_id = '${id}' ` +
          `GROUP BY zo_sql_key ORDER BY zo_sql_key`,
      );
      const flagged = chartRows.filter((r) => r.anomaly_value !== null && r.anomaly_value !== undefined);
      expect(flagged.length, 'the charted series must flag at least one bucket').toBeGreaterThan(0);
      for (const row of flagged) {
        expect(
          row.anomaly_value,
          `overlay ${row.anomaly_value} must equal the metric ${row.zo_sql_num} at ${row.zo_sql_key}`,
        ).toBe(row.zo_sql_num);
      }
      expect(Math.max(...flagged.map((r) => r.anomaly_value))).toBe(120);

      // Delivery. The notification is sent inline by the detection run, so a
      // regression that stops it would otherwise pass every assertion above.
      // Where the webhook points back at this instance's own ingest endpoint
      // the alert becomes a queryable receipt; that only works where loopback
      // is allowlisted (ZO_SSRF_ALLOW_LOOPBACK), so an external webhook is
      // simply not readable and the check is skipped rather than faked.
      const webhook = process.env.MOCK_WEBHOOK_URL || '';
      const receiptStream = webhook.match(/\/api\/[^/]+\/([^/]+)\/_json/)?.[1];
      if (/localhost|127\.0\.0\.1/.test(webhook) && receiptStream) {
        await expect
          .poll(
            async () =>
              (await searchSql(page, `SELECT * FROM "${receiptStream}"`, 3600)).filter((r) =>
                JSON.stringify(r).includes(firingName),
              ).length,
            { timeout: 60000, message: `no webhook receipt for ${firingName} in ${receiptStream}` },
          )
          .toBeGreaterThan(0);
      } else {
        testLogger.info('Skipping delivery receipt — webhook is not a loopback ingest URL', { webhook });
      }
    });
  });

  test.afterAll(async ({ browser }) => {
    if (
      !process.env.ZO_BASE_URL ||
      !process.env.ZO_ROOT_USER_EMAIL ||
      !process.env.ZO_ROOT_USER_PASSWORD ||
      !process.env.ORGNAME
    ) {
      testLogger.warn('Skipping cleanup - missing environment variables');
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // page.evaluate() can only fetch once the page is on the app origin.
      await page.goto(process.env.ZO_BASE_URL);
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      const cleanupPm = new PageManager(page);
      // Scope to THIS worker's run id. afterAll fires once per worker, and the
      // config runs 5 of them, so deleting by the shared "E2E_Anomaly" prefix
      // lets a worker finishing early wipe another worker's fixtures mid-test.
      await cleanupPm.anomalyDetectionPage.cleanupTestAnomalies(randomValue);
      // Destination last: it cannot be removed while an anomaly still points at
      // it. Left uncleaned these accumulate every run, and a long destination
      // list is what makes the virtualized picker drop options out of the DOM.
      await deleteDestination(page, prerequisiteDestinationName);
      // Template after the destination that references it. Both are named per
      // worker, so this only ever removes what this run created.
      await deleteTemplate(page, prerequisiteTemplateName);
    } catch (error) {
      testLogger.warn('Cleanup failed', { error: error.message });
    } finally {
      await context.close();
    }
  });
});
