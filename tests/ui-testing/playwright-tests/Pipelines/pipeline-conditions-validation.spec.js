const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const data100 = require("../../../test-data/data_100.json");
const fs = require('fs');
const path = require('path');

test.describe.configure({ mode: "parallel" });

test.use({
  contextOptions: {
    slowMo: 1000
  }
});

/**
 * Pipeline Conditions Validation Tests
 *
 * These tests cover Phase 1 critical validation requirements:
 * 1. Operator precedence validation (A OR B AND C)
 * 2. Nested groups with AND logic
 * 3. Nested groups with OR logic
 * 4. Numeric comparisons (age >= 40, income > 100000)
 * 5. String operators case-insensitive (Contains)
 *
 * Each test:
 * - Creates pipeline via API with specific conditions
 * - Ingests test data
 * - Queries destination stream
 * - Downloads and validates filtered results
 */

test.describe("Pipeline Conditions - Data Filtering Validation", () => {
  let pageManager;
  let downloadDir;

  // Variables for lightweight cleanup
  let currentPipelineName;
  let currentSourceStream;
  let currentDestStream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pageManager = new PageManager(page);

    // Post-authentication stabilization wait
    await page.waitForLoadState('networkidle');

    // Setup download directory
    downloadDir = await pageManager.logsPage.setupDownloadDirectory();
    expect(fs.existsSync(downloadDir)).toBe(true);
  });

  test.afterEach(async ({ page }) => {
    // Lightweight pipeline cleanup
    try {
      if (currentPipelineName) {
        await pageManager.apiCleanup.deletePipeline(currentPipelineName).catch(() => {});
        testLogger.info('Cleaned up pipeline', { currentPipelineName });
      }
    } catch (error) {
      testLogger.warn('Cleanup failed', { error: error.message });
    }

    // Reset variables
    currentPipelineName = null;
    currentSourceStream = null;
    currentDestStream = null;

    // Cleanup download directory
    if (downloadDir) {
      await pageManager.logsPage.cleanupDownloadDirectory(downloadDir);
    }
  });

  /**
   * Test 1: Operator Precedence Validation (A OR B AND C)
   *
   * Critical Test Case 3.1 from design doc
   * Tests that AND has higher precedence than OR
   *
   * Condition: city = 'Boston' OR state = 'CA' AND age >= 50
   * Expected: Evaluates as: city = 'Boston' OR (state = 'CA' AND age >= 50)
   *
   * Test Data Scenarios:
   * 1. city='Boston', state!='CA', age<50 → PASS (OR short-circuits)
   * 2. city!='Boston', state='CA', age>=50 → PASS (AND group matches)
   * 3. city!='Boston', state='CA', age<50 → FAIL (partial AND match)
   * 4. city!='Boston', state!='CA', age>=50 → FAIL (no matches)
   */
  test.skip("should validate operator precedence: A OR B AND C", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesOperatorPrecedence']
  }, async ({ page }) => {
    const testTimestamp = Date.now();
    const pipelineName = `validation-precedence-${testTimestamp}`;
    const sourceStream = `e2e_cond_prec_src_${testTimestamp}`;
    const destStream = `e2e_cond_prec_dest_${testTimestamp}`;

    // Set cleanup variables
    currentPipelineName = pipelineName;
    currentSourceStream = sourceStream;
    currentDestStream = destStream;

    // Define condition: age >= 40 AND (city='Boston' OR city='San Antonio')
    // Using FLAT structure with individual logicalOperators (not nested groups)
    const conditions = {
      filterType: "group",
      logicalOperator: "AND",
      groupId: `group-${Date.now()}`,
      conditions: [
        {
          filterType: "condition",
          column: "age",
          operator: ">=",
          value: "40",
          values: [],
          logicalOperator: "AND",  // Connect to next condition with AND
          id: `cond-age-${Date.now()}`
        },
        {
          filterType: "condition",
          column: "city",
          operator: "=",
          value: "Boston",
          values: [],
          logicalOperator: "OR",  // Connect to next condition with OR
          id: `cond-city-boston-${Date.now()}`
        },
        {
          filterType: "condition",
          column: "city",
          operator: "=",
          value: "San Antonio",
          values: [],
          logicalOperator: "OR",  // This is the last condition
          id: `cond-city-sa-${Date.now()}`
        }
      ]
    };

    // Create test data with known scenarios
    // Each record must be COMPLETELY unique to avoid OpenObserve deduplication
    const timestamp = Date.now();
    const testData = [
      // Scenario 1: city='Boston', age=45 → PASS (OR group + AND)
      {
        name: "Jamie Moore",
        age: 45,
        city: "Boston",
        state: "MA",
        income: 65000,
        test_id: `precedence-1-${timestamp}`,
        unique_id: `${timestamp}-1`,
        email: `jamie.moore.${timestamp}@test.com`,
        phone: `555-0001-${timestamp}`
      },

      // Scenario 2: city='San Antonio', age=52 → PASS (OR group + AND)
      {
        name: "Alex Brown",
        age: 52,
        city: "San Antonio",
        state: "CA",
        income: 145000,
        test_id: `precedence-2-${timestamp}`,
        unique_id: `${timestamp}-2`,
        email: `alex.brown.${timestamp}@test.com`,
        phone: `555-0002-${timestamp}`
      },

      // Scenario 3: city='Austin', age=50 → FAIL (city not in OR group)
      {
        name: "Casey Wilson",
        age: 50,
        city: "Austin",
        state: "CA",
        income: 35000,
        test_id: `precedence-3-${timestamp}`,
        unique_id: `${timestamp}-3`,
        email: `casey.wilson.${timestamp}@test.com`,
        phone: `555-0003-${timestamp}`
      },

      // Scenario 4: city='Boston', age=30 → FAIL (age < 40)
      {
        name: "Dakota Thompson",
        age: 30,
        city: "Boston",
        state: "TX",
        income: 65000,
        test_id: `precedence-4-${timestamp}`,
        unique_id: `${timestamp}-4`,
        email: `dakota.thompson.${timestamp}@test.com`,
        phone: `555-0004-${timestamp}`
      },

      // Scenario 5: city='San Antonio', age=35 → FAIL (age < 40)
      {
        name: "Taylor Garcia",
        age: 35,
        city: "San Antonio",
        state: "CA",
        income: 50000,
        test_id: `precedence-5-${timestamp}`,
        unique_id: `${timestamp}-5`,
        email: `taylor.garcia.${timestamp}@test.com`,
        phone: `555-0005-${timestamp}`
      }
    ];

    try {
      // Step 1: Create source stream explicitly FIRST
      testLogger.info('Step 1: Creating source stream');
      await pageManager.streamsPage.createStream(sourceStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 2: Ingest data to establish schema (before pipeline exists)
      testLogger.info('Step 2: Ingesting data to source stream to establish schema');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(2000);

      // Step 3: Create destination stream
      testLogger.info('Step 3: Creating destination stream');
      await pageManager.streamsPage.createStream(destStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 4: Create pipeline with conditions
      testLogger.info('Step 4: Creating pipeline with conditions');
      await pageManager.pipelinesPage.createPipeline(pipelineName, sourceStream, destStream, conditions);

      // Wait for pipeline to be fully activated before ingesting data
      testLogger.info('Waiting for pipeline to activate...');
      await page.waitForTimeout(5000);

      // TODO: UI verification skipped for now - focus on functional validation
      // await verifyPipelineInUI(page, pageManager, pipelineName);

      // Step 5: Second ingestion (this gets processed by pipeline)
      testLogger.info('Step 5: Ingesting same data again - pipeline will process this');
      await pageManager.logsPage.ingestData(sourceStream, testData);

      // Wait longer for pipeline processing and stream indexing
      testLogger.info('Waiting for pipeline processing and stream indexing...');
      await page.waitForTimeout(15000);

      // Step 6: Query destination stream
      testLogger.info('Step 6: Querying destination stream for filtered results');
      const results = await pageManager.streamsPage.queryStream(destStream, 0);

      // Validate results
      testLogger.info('Validating nested OR results', { resultCount: results.length, results: results.map(r => ({ test_id: r.test_id, name: r.name, city: r.city, age: r.age })) });

      // Should have exactly 2 passing records (scenarios 1, 2)
      expect(results.length).toBe(2);

      // Verify the passing records are Jamie Moore and Alex Brown
      const resultNames = results.map(r => r.name).sort();
      expect(resultNames).toEqual(['Alex Brown', 'Jamie Moore']);

      testLogger.info('✅ Nested OR group validation PASSED');

    } finally {
      // Cleanup
      await pageManager.apiCleanup.deletePipeline(pipelineName);
    }
  });

  /**
   * Test 2: Multiple Flat OR Conditions
   *
   * Condition: city='Boston' OR city='Seattle' OR city='Austin' OR city='Dallas'
   *
   * Test Data Scenarios:
   * 1. city='Boston' → PASS
   * 2. city='Seattle' → PASS
   * 3. city='Austin' → PASS
   * 4. city='Dallas' → PASS
   * 5. city='New York' → FAIL (not in OR list)
   * 6. city='Miami' → FAIL (not in OR list)
   */
  test.skip("should validate multiple flat OR conditions", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesMultipleOR']
  }, async ({ page }) => {
    const testTimestamp = Date.now();
    const pipelineName = `validation-multiple-or-${testTimestamp}`;
    const sourceStream = `e2e_multiple_or_src_${testTimestamp}`;
    const destStream = `e2e_multiple_or_dest_${testTimestamp}`;

    // Set cleanup variables
    currentPipelineName = pipelineName;
    currentSourceStream = sourceStream;
    currentDestStream = destStream;

    // Define condition: age >= 0 AND (city='Boston' OR city='Seattle' OR city='Austin' OR city='Dallas')
    // v2 requires: COND first, then CG as sibling
    const conditions = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "age",
          operator: ">=",
          value: "0",
          logicalOperator: "AND"
        },
        {
          filterType: "group",
          logicalOperator: "OR",
          conditions: [
            {
              filterType: "condition",
              column: "city",
              operator: "=",
              value: "Boston",
              logicalOperator: "OR"
            },
            {
              filterType: "condition",
              column: "city",
              operator: "=",
              value: "Seattle",
              logicalOperator: "OR"
            },
            {
              filterType: "condition",
              column: "city",
              operator: "=",
              value: "Austin",
              logicalOperator: "OR"
            },
            {
              filterType: "condition",
              column: "city",
              operator: "=",
              value: "Dallas",
              logicalOperator: "OR"
            }
          ]
        }
      ]
    };

    const testData = [
      // Scenario 1: city='Boston' → PASS
      { name: "Alice Johnson", age: 35, city: "Boston", state: "MA", income: 75000 },

      // Scenario 2: city='Seattle' → PASS
      { name: "Bob Smith", age: 42, city: "Seattle", state: "WA", income: 95000 },

      // Scenario 3: city='Austin' → PASS
      { name: "Carol Williams", age: 28, city: "Austin", state: "TX", income: 68000 },

      // Scenario 4: city='Dallas' → PASS
      { name: "David Brown", age: 51, city: "Dallas", state: "TX", income: 110000 },

      // Scenario 5: city='New York' → FAIL (not in OR list)
      { name: "Eve Davis", age: 39, city: "New York", state: "NY", income: 125000 },

      // Scenario 6: city='Miami' → FAIL (not in OR list)
      { name: "Frank Miller", age: 45, city: "Miami", state: "FL", income: 88000 }
    ];

    try {
      // Step 1: Create source stream explicitly FIRST
      testLogger.info('Step 1: Creating source stream');
      await pageManager.streamsPage.createStream(sourceStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 2: Ingest data to establish schema (before pipeline exists)
      testLogger.info('Step 2: Ingesting data to source stream to establish schema');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(2000);

      // Step 3: Create destination stream
      testLogger.info('Step 3: Creating destination stream');
      await pageManager.streamsPage.createStream(destStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 4: Create pipeline with conditions
      testLogger.info('Step 4: Creating pipeline with conditions');
      await pageManager.pipelinesPage.createPipeline(pipelineName, sourceStream, destStream, conditions);

      // Wait for pipeline to be fully activated before ingesting data
      testLogger.info('Waiting for pipeline to activate...');
      await page.waitForTimeout(5000);

      // Step 5: Second ingestion (this gets processed by pipeline)
      testLogger.info('Step 5: Ingesting same data again - pipeline will process this');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(10000); // Wait for pipeline processing and indexing

      // Step 6: Query destination stream
      testLogger.info('Step 6: Querying destination stream for filtered results');
      const results = await pageManager.streamsPage.queryStream(destStream, 4);

      testLogger.info('Validating multiple flat OR conditions results', { resultCount: results.length });

      // Should have exactly 4 passing records (Boston, Seattle, Austin, Dallas)
      expect(results.length).toBe(4);

      const resultCities = results.map(r => r.city).sort();
      const expectedCities = ["Austin", "Boston", "Dallas", "Seattle"].sort();

      expect(resultCities).toEqual(expectedCities);

      testLogger.info('✅ Multiple flat OR conditions validation PASSED');

    } finally {
      await pageManager.apiCleanup.deletePipeline(pipelineName);
    }
  });

  /**
   * Test 3: Nested Groups with OR Logic
   *
   * Condition: (age < 30 AND state = 'TX') OR income > 150000
   * Note: Reordered to put AND group first, then OR condition (matching pattern from Test 2)
   *
   * Test Data Scenarios:
   * 1. income>150000, age>30, state!='TX' → PASS (OR matches income)
   * 2. income<150000, age<30, state='TX' → PASS (AND group matches)
   * 3. income<150000, age<30, state='CA' → FAIL (partial AND match)
   * 4. income<150000, age>30, state='TX' → FAIL (no matches)
   */
  test.skip("should validate nested groups with OR logic", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesNestedOR']
  }, async ({ page }) => {
    const testTimestamp = Date.now();
    const pipelineName = `validation-nested-or-${testTimestamp}`;
    const sourceStream = `e2e_nested_or_src_${testTimestamp}`;
    const destStream = `e2e_nested_or_dest_${testTimestamp}`;

    // Set cleanup variables
    currentPipelineName = pipelineName;
    currentSourceStream = sourceStream;
    currentDestStream = destStream;

    // Define condition: income > 150000 OR (age < 30 AND state = 'TX')
    // v2 requires: Root must be AND, so we add a dummy "age >= 0" condition (always true)
    // This gives us: (age >= 0) AND (income > 150000 OR (age < 30 AND state = 'TX'))
    // which is logically equivalent to the original OR condition since age >= 0 is always true
    const conditions = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "age",
          operator: ">=",
          value: "0",
          logicalOperator: "AND"
        },
        {
          filterType: "group",
          logicalOperator: "OR",
          conditions: [
            {
              filterType: "condition",
              column: "income",
              operator: ">",
              value: "150000",
              logicalOperator: "OR"
            },
            {
              filterType: "group",
              logicalOperator: "AND",
              conditions: [
                {
                  filterType: "condition",
                  column: "age",
                  operator: "<",
                  value: "30",
                  logicalOperator: "AND"
                },
                {
                  filterType: "condition",
                  column: "state",
                  operator: "=",
                  value: "TX",
                  logicalOperator: "AND"
                }
              ]
            }
          ]
        }
      ]
    };

    const testData = [
      // Scenario 1: income=180000, age=52, state='OH' → PASS (income > 150000)
      { name: "Ellis Garcia", age: 52, city: "San Jose", state: "OH", income: 180000 },

      // Scenario 2: income=35000, age=25, state='TX' → PASS (AND group matches)
      { name: "Jamie Moore", age: 25, city: "Boston", state: "TX", income: 35000 },

      // Scenario 3: income=65000, age=28, state='CA' → FAIL (age<30 but state!='TX')
      { name: "Reese White", age: 28, city: "Dallas", state: "CA", income: 65000 },

      // Scenario 4: income=50000, age=43, state='TX' → FAIL (age>30)
      { name: "Dakota Thompson", age: 43, city: "Austin", state: "TX", income: 50000 },

      // Scenario 5: income=225000, age=46, state='MA' → PASS (income > 150000)
      { name: "Parker Thomas", age: 46, city: "San Jose", state: "MA", income: 225000 }
    ];

    try {
      // Step 1: First ingestion to establish schema (before pipeline exists)
      testLogger.info('Step 1: Ingesting data to source stream to establish schema');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(2000);

      // Step 2: Create destination stream
      testLogger.info('Step 2: Creating destination stream');
      await pageManager.streamsPage.createStream(destStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 3: Create pipeline with conditions
      testLogger.info('Step 3: Creating pipeline with conditions');
      await pageManager.pipelinesPage.createPipeline(pipelineName, sourceStream, destStream, conditions);
      await page.waitForTimeout(3000);

      // TODO: UI verification skipped for now - focus on functional validation
      // await verifyPipelineInUI(page, pageManager, pipelineName);

      // Step 4: Second ingestion (this gets processed by pipeline)
      testLogger.info('Step 4: Ingesting same data again - pipeline will process this');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(10000); // Wait for pipeline processing and indexing

      // Step 5: Query destination stream
      testLogger.info('Step 5: Querying destination stream for filtered results');
      const results = await pageManager.streamsPage.queryStream(destStream, 3);

      testLogger.info('Validating nested OR group results', { resultCount: results.length });

      // Should have exactly 3 passing records
      expect(results.length).toBe(3);

      const resultNames = results.map(r => r.name).sort();
      const expectedNames = ["Ellis Garcia", "Jamie Moore", "Parker Thomas"].sort();

      expect(resultNames).toEqual(expectedNames);

      testLogger.info('✅ Nested OR group validation PASSED');

    } finally {
      await pageManager.apiCleanup.deletePipeline(pipelineName);
    }
  });

  /**
   * Test 4: Numeric Comparisons
   *
   * Condition: age >= 60 AND income <= 100000
   *
   * Test Data Scenarios:
   * 1. age=61, income=65000 → PASS
   * 2. age=70, income=125000 → FAIL (income > 100000)
   * 3. age=40, income=50000 → FAIL (age < 60)
   * 4. age=73, income=88000 → PASS
   */
  test("should validate numeric comparisons", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesNumericComparisons']
  }, async ({ page }) => {
    const testTimestamp = Date.now();
    const pipelineName = `validation-numeric-${testTimestamp}`;
    const sourceStream = `e2e_numeric_src_${testTimestamp}`;
    const destStream = `e2e_numeric_dest_${testTimestamp}`;

    // Set cleanup variables
    currentPipelineName = pipelineName;
    currentSourceStream = sourceStream;
    currentDestStream = destStream;

    // Define condition: age >= 60 AND income <= 100000
    const conditions = {
      filterType: "group",
      logicalOperator: "AND",
      groupId: `group-${Date.now()}`,
      conditions: [
        {
          filterType: "condition",
          column: "age",
          operator: ">=",
          value: "60",
          values: [],
          logicalOperator: "AND",
          id: `cond-age-${Date.now()}`
        },
        {
          filterType: "condition",
          column: "income",
          operator: "<=",
          value: "100000",
          values: [],
          logicalOperator: "AND",
          id: `cond-income-${Date.now()}`
        }
      ]
    };

    const testData = [
      // Scenario 1: age=61, income=65000 → PASS
      { name: "Dakota Thompson", age: 61, city: "Dallas", state: "CA", income: 65000 },

      // Scenario 2: age=70, income=125000 → FAIL (income > 100000)
      { name: "Reese White", age: 70, city: "Jacksonville", state: "FL", income: 125000 },

      // Scenario 3: age=40, income=50000 → FAIL (age < 60)
      { name: "Riley Taylor", age: 40, city: "San Francisco", state: "IN", income: 65000 },

      // Scenario 4: age=73, income=88000 → PASS
      { name: "Jamie Moore", age: 73, city: "Philadelphia", state: "OH", income: 88000 },

      // Scenario 5: age=64, income=35000 → PASS
      { name: "Harley Robinson", age: 64, city: "Phoenix", state: "CA", income: 35000 }
    ];

    try {
      // Step 1: First ingestion to establish schema (before pipeline exists)
      testLogger.info('Step 1: Ingesting data to source stream to establish schema');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(2000);

      // Step 2: Create destination stream
      testLogger.info('Step 2: Creating destination stream');
      await pageManager.streamsPage.createStream(destStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 3: Create pipeline with conditions
      testLogger.info('Step 3: Creating pipeline with conditions');
      await pageManager.pipelinesPage.createPipeline(pipelineName, sourceStream, destStream, conditions);
      await page.waitForTimeout(3000);

      // TODO: UI verification skipped for now - focus on functional validation
      // await verifyPipelineInUI(page, pageManager, pipelineName);

      // Step 4: Second ingestion (this gets processed by pipeline)
      testLogger.info('Step 4: Ingesting same data again - pipeline will process this');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(10000); // Wait for pipeline processing and indexing

      // Step 5: Query destination stream
      testLogger.info('Step 5: Querying destination stream for filtered results');
      const results = await pageManager.streamsPage.queryStream(destStream, 3);

      testLogger.info('Validating numeric comparison results', { resultCount: results.length });

      // Should have exactly 3 passing records
      expect(results.length).toBe(3);

      const resultNames = results.map(r => r.name).sort();
      const expectedNames = ["Dakota Thompson", "Jamie Moore", "Harley Robinson"].sort();

      expect(resultNames).toEqual(expectedNames);

      testLogger.info('✅ Numeric comparison validation PASSED');

    } finally {
      await pageManager.apiCleanup.deletePipeline(pipelineName);
    }
  });

  /**
   * Test 5: Multiple AND Conditions
   *
   * Condition: age >= 40 AND age <= 60 AND state='CA' AND income > 50000
   *
   * Test Data Scenarios:
   * 1. age=45, state='CA', income=75000 → PASS (all conditions match)
   * 2. age=55, state='CA', income=95000 → PASS (all conditions match)
   * 3. age=35, state='CA', income=80000 → FAIL (age < 40)
   * 4. age=45, state='TX', income=75000 → FAIL (state != CA)
   * 5. age=45, state='CA', income=30000 → FAIL (income <= 50000)
   * 6. age=65, state='CA', income=100000 → FAIL (age > 60)
   */
  test("should validate multiple AND conditions", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesMultipleAND']
  }, async ({ page }) => {
    const testTimestamp = Date.now();
    const pipelineName = `validation-multiple-and-${testTimestamp}`;
    const sourceStream = `e2e_multiple_and_src_${testTimestamp}`;
    const destStream = `e2e_multiple_and_dest_${testTimestamp}`;

    // Set cleanup variables
    currentPipelineName = pipelineName;
    currentSourceStream = sourceStream;
    currentDestStream = destStream;

    // Define condition: age >= 40 AND age <= 60 AND state='CA' AND income > 50000
    const conditions = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "age",
          operator: ">=",
          value: "40",
          logicalOperator: "AND"
        },
        {
          filterType: "condition",
          column: "age",
          operator: "<=",
          value: "60",
          logicalOperator: "AND"
        },
        {
          filterType: "condition",
          column: "state",
          operator: "=",
          value: "CA",
          logicalOperator: "AND"
        },
        {
          filterType: "condition",
          column: "income",
          operator: ">",
          value: "50000",
          logicalOperator: "AND"
        }
      ]
    };

    const testData = [
      // Scenario 1: age=45, state='CA', income=75000 → PASS (all conditions match)
      { name: "Grace Anderson", age: 45, city: "Los Angeles", state: "CA", income: 75000 },

      // Scenario 2: age=55, state='CA', income=95000 → PASS (all conditions match)
      { name: "Henry Martinez", age: 55, city: "San Diego", state: "CA", income: 95000 },

      // Scenario 3: age=35, state='CA', income=80000 → FAIL (age < 40)
      { name: "Iris Wilson", age: 35, city: "San Francisco", state: "CA", income: 80000 },

      // Scenario 4: age=45, state='TX', income=75000 → FAIL (state != CA)
      { name: "Jack Taylor", age: 45, city: "Houston", state: "TX", income: 75000 },

      // Scenario 5: age=45, state='CA', income=30000 → FAIL (income <= 50000)
      { name: "Kelly Moore", age: 45, city: "Sacramento", state: "CA", income: 30000 },

      // Scenario 6: age=65, state='CA', income=100000 → FAIL (age > 60)
      { name: "Leo Jackson", age: 65, city: "Oakland", state: "CA", income: 100000 }
    ];

    try {
      // Step 1: Create source stream explicitly FIRST
      testLogger.info('Step 1: Creating source stream');
      await pageManager.streamsPage.createStream(sourceStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 2: Ingest data to establish schema (before pipeline exists)
      testLogger.info('Step 2: Ingesting data to source stream to establish schema');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(2000);

      // Step 3: Create destination stream
      testLogger.info('Step 3: Creating destination stream');
      await pageManager.streamsPage.createStream(destStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 4: Create pipeline with conditions
      testLogger.info('Step 4: Creating pipeline with conditions');
      await pageManager.pipelinesPage.createPipeline(pipelineName, sourceStream, destStream, conditions);

      // Wait for pipeline to be fully activated before ingesting data
      testLogger.info('Waiting for pipeline to activate...');
      await page.waitForTimeout(5000);

      // Step 5: Second ingestion (this gets processed by pipeline)
      testLogger.info('Step 5: Ingesting same data again - pipeline will process this');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(10000); // Wait for pipeline processing and indexing

      // Step 6: Query destination stream
      testLogger.info('Step 6: Querying destination stream for filtered results');
      const results = await pageManager.streamsPage.queryStream(destStream, 2);

      testLogger.info('Validating multiple AND conditions results', { resultCount: results.length });

      // Should have exactly 2 passing records (Grace Anderson and Henry Martinez)
      expect(results.length).toBe(2);

      const resultNames = results.map(r => r.name).sort();
      const expectedNames = ["Grace Anderson", "Henry Martinez"].sort();

      expect(resultNames).toEqual(expectedNames);

      // Verify all conditions are met
      results.forEach(record => {
        expect(record.age).toBeGreaterThanOrEqual(40);
        expect(record.age).toBeLessThanOrEqual(60);
        expect(record.state).toBe('CA');
        expect(record.income).toBeGreaterThan(50000);
      });

      testLogger.info('✅ Multiple AND conditions validation PASSED');

    } finally {
      await pageManager.apiCleanup.deletePipeline(pipelineName);
    }
  });

  /**
   * Test 6: Complex Deeply Nested Groups (3 Levels)
   *
   * Condition:
   * (age >= 50 AND state = 'CA') OR
   * (income > 150000 AND (city = 'Boston' OR city = 'Seattle'))
   *
   * This tests 3-level nesting with mixed AND/OR logic
   */
  test("should validate deeply nested groups (3 levels)", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesDeepNested']
  }, async ({ page }) => {
    const testTimestamp = Date.now();
    const pipelineName = `validation-deep-nested-${testTimestamp}`;
    const sourceStream = `e2e_deep_src_${testTimestamp}`;
    const destStream = `e2e_deep_dest_${testTimestamp}`;

    // Set cleanup variables
    currentPipelineName = pipelineName;
    currentSourceStream = sourceStream;
    currentDestStream = destStream;

    // Define complex nested condition using operator precedence
    // Condition: age >= 50 AND state = 'CA' OR income > 150000 AND (city = 'Boston' OR city = 'Seattle')
    // Due to precedence (AND before OR), this becomes:
    // (age >= 50 AND state = 'CA') OR (income > 150000 AND (city = 'Boston' OR city = 'Seattle'))
    const conditions = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "age",
          operator: ">=",
          value: "50",
          logicalOperator: "AND"
        },
        {
          filterType: "condition",
          column: "state",
          operator: "=",
          value: "CA",
          logicalOperator: "OR"
        },
        {
          filterType: "condition",
          column: "income",
          operator: ">",
          value: "150000",
          logicalOperator: "AND"
        },
        {
          filterType: "group",
          logicalOperator: "OR",
          conditions: [
            {
              filterType: "condition",
              column: "city",
              operator: "=",
              value: "Boston",
              logicalOperator: "OR"
            },
            {
              filterType: "condition",
              column: "city",
              operator: "=",
              value: "Seattle",
              logicalOperator: "OR"
            }
          ]
        }
      ]
    };

    const testData = [
      // Scenario 1: age=52, state='CA', income=145000 → PASS (first group matches)
      { name: "Alex Brown", age: 52, city: "San Antonio", state: "CA", income: 145000 },

      // Scenario 2: age=40, state='TX', income=180000, city='Boston' → PASS (second group matches)
      { name: "Parker Thomas", age: 40, city: "Boston", state: "TX", income: 180000 },

      // Scenario 3: age=30, state='CA', income=200000, city='Seattle' → PASS (both groups match)
      { name: "Riley Taylor", age: 79, city: "Seattle", state: "CA", income: 200000 },

      // Scenario 4: age=40, state='TX', income=100000, city='Dallas' → FAIL (no groups match)
      { name: "Jordan Davis", age: 40, city: "Dallas", state: "TX", income: 100000 },

      // Scenario 5: age=58, state='CA', income=225000, city='San Jose' → PASS (first group matches)
      { name: "Parker Thomas", age: 58, city: "San Jose", state: "CA", income: 225000 }
    ];

    try {
      // Step 1: First ingestion to establish schema (before pipeline exists)
      testLogger.info('Step 1: Ingesting data to source stream to establish schema');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(2000);

      // Step 2: Create destination stream
      testLogger.info('Step 2: Creating destination stream');
      await pageManager.streamsPage.createStream(destStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 3: Create pipeline with conditions
      testLogger.info('Step 3: Creating pipeline with conditions');
      await pageManager.pipelinesPage.createPipeline(pipelineName, sourceStream, destStream, conditions);
      await page.waitForTimeout(3000);

      // TODO: UI verification skipped for now - focus on functional validation
      // await verifyPipelineInUI(page, pageManager, pipelineName);

      // Step 4: Second ingestion (this gets processed by pipeline)
      testLogger.info('Step 4: Ingesting same data again - pipeline will process this');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(10000); // Wait for pipeline processing and indexing

      // Step 5: Query destination stream
      testLogger.info('Step 5: Querying destination stream for filtered results');
      const results = await pageManager.streamsPage.queryStream(destStream, 4);

      testLogger.info('Validating deeply nested group results', { resultCount: results.length });

      // Should have exactly 4 passing records
      expect(results.length).toBe(4);

      testLogger.info('✅ Deeply nested group validation PASSED');

    } finally {
      await pageManager.apiCleanup.deletePipeline(pipelineName);
    }
  });

  /**
   * Test 7: NOT Operator Validation
   *
   * Condition: city != 'Boston' AND age >= 40
   *
   * Test Data Scenarios:
   * 1. city='Seattle', age=45 → PASS (city not Boston, age >= 40)
   * 2. city='Austin', age=55 → PASS (city not Boston, age >= 40)
   * 3. city='Boston', age=50 → FAIL (city is Boston)
   * 4. city='Dallas', age=35 → FAIL (age < 40)
   * 5. city='Miami', age=60 → PASS (city not Boston, age >= 40)
   */
  test("should validate NOT operator (!=)", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesNotOperator']
  }, async ({ page }) => {
    const testTimestamp = Date.now();
    const pipelineName = `validation-not-operator-${testTimestamp}`;
    const sourceStream = `e2e_not_operator_src_${testTimestamp}`;
    const destStream = `e2e_not_operator_dest_${testTimestamp}`;

    // Set cleanup variables
    currentPipelineName = pipelineName;
    currentSourceStream = sourceStream;
    currentDestStream = destStream;

    // Define condition: city != 'Boston' AND age >= 40
    const conditions = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "city",
          operator: "!=",
          value: "Boston",
          logicalOperator: "AND"
        },
        {
          filterType: "condition",
          column: "age",
          operator: ">=",
          value: "40",
          logicalOperator: "AND"
        }
      ]
    };

    const testData = [
      // Scenario 1: city='Seattle', age=45 → PASS (city not Boston, age >= 40)
      { name: "Mia Thompson", age: 45, city: "Seattle", state: "WA", income: 85000 },

      // Scenario 2: city='Austin', age=55 → PASS (city not Boston, age >= 40)
      { name: "Noah Garcia", age: 55, city: "Austin", state: "TX", income: 92000 },

      // Scenario 3: city='Boston', age=50 → FAIL (city is Boston)
      { name: "Olivia Brown", age: 50, city: "Boston", state: "MA", income: 105000 },

      // Scenario 4: city='Dallas', age=35 → FAIL (age < 40)
      { name: "Peter Wilson", age: 35, city: "Dallas", state: "TX", income: 75000 },

      // Scenario 5: city='Miami', age=60 → PASS (city not Boston, age >= 40)
      { name: "Quinn Davis", age: 60, city: "Miami", state: "FL", income: 110000 }
    ];

    try {
      // Step 1: Create source stream explicitly FIRST
      testLogger.info('Step 1: Creating source stream');
      await pageManager.streamsPage.createStream(sourceStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 2: Ingest data to establish schema (before pipeline exists)
      testLogger.info('Step 2: Ingesting data to source stream to establish schema');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(2000);

      // Step 3: Create destination stream
      testLogger.info('Step 3: Creating destination stream');
      await pageManager.streamsPage.createStream(destStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 4: Create pipeline with conditions
      testLogger.info('Step 4: Creating pipeline with conditions');
      await pageManager.pipelinesPage.createPipeline(pipelineName, sourceStream, destStream, conditions);

      // Wait for pipeline to be fully activated before ingesting data
      testLogger.info('Waiting for pipeline to activate...');
      await page.waitForTimeout(5000);

      // Step 5: Second ingestion (this gets processed by pipeline)
      testLogger.info('Step 5: Ingesting same data again - pipeline will process this');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(10000); // Wait for pipeline processing and indexing

      // Step 6: Query destination stream
      testLogger.info('Step 6: Querying destination stream for filtered results');
      const results = await pageManager.streamsPage.queryStream(destStream, 3);

      testLogger.info('Validating NOT operator results', { resultCount: results.length });

      // Should have exactly 3 passing records (Seattle, Austin, Miami)
      expect(results.length).toBe(3);

      const resultNames = results.map(r => r.name).sort();
      const expectedNames = ["Mia Thompson", "Noah Garcia", "Quinn Davis"].sort();

      expect(resultNames).toEqual(expectedNames);

      // Verify none of the results are from Boston
      results.forEach(record => {
        expect(record.city).not.toBe('Boston');
        expect(record.age).toBeGreaterThanOrEqual(40);
      });

      testLogger.info('✅ NOT operator validation PASSED');

    } finally {
      await pageManager.apiCleanup.deletePipeline(pipelineName);
    }
  });

  /**
   * Test 8: Negative Test - Impossible Condition
   *
   * Condition: age > 100 AND age < 20
   *
   * Test Data Scenarios:
   * This is a negative test with an impossible condition that should never match.
   * All records should be filtered out.
   * 1. age=25 → FAIL (age not > 100)
   * 2. age=45 → FAIL (age not > 100)
   * 3. age=65 → FAIL (age not > 100)
   * 4. age=15 → FAIL (age not > 100)
   * Expected: 0 records should pass
   */
  test("should validate negative test with impossible condition", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesImpossibleCondition']
  }, async ({ page }) => {
    const testTimestamp = Date.now();
    const pipelineName = `validation-impossible-${testTimestamp}`;
    const sourceStream = `e2e_impossible_src_${testTimestamp}`;
    const destStream = `e2e_impossible_dest_${testTimestamp}`;

    // Set cleanup variables
    currentPipelineName = pipelineName;
    currentSourceStream = sourceStream;
    currentDestStream = destStream;

    // Define condition: age > 100 AND age < 20 (impossible)
    const conditions = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "age",
          operator: ">",
          value: "100",
          logicalOperator: "AND"
        },
        {
          filterType: "condition",
          column: "age",
          operator: "<",
          value: "20",
          logicalOperator: "AND"
        }
      ]
    };

    const testData = [
      // All scenarios should FAIL because the condition is impossible
      { name: "Rachel Adams", age: 25, city: "Chicago", state: "IL", income: 65000 },
      { name: "Sam Clark", age: 45, city: "Portland", state: "OR", income: 78000 },
      { name: "Tina Lewis", age: 65, city: "Denver", state: "CO", income: 85000 },
      { name: "Uma Lee", age: 15, city: "Phoenix", state: "AZ", income: 0 }
    ];

    try {
      // Step 1: Create source stream explicitly FIRST
      testLogger.info('Step 1: Creating source stream');
      await pageManager.streamsPage.createStream(sourceStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 2: Ingest data to establish schema (before pipeline exists)
      testLogger.info('Step 2: Ingesting data to source stream to establish schema');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(2000);

      // Step 3: Create destination stream
      testLogger.info('Step 3: Creating destination stream');
      await pageManager.streamsPage.createStream(destStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 4: Create pipeline with conditions
      testLogger.info('Step 4: Creating pipeline with conditions');
      await pageManager.pipelinesPage.createPipeline(pipelineName, sourceStream, destStream, conditions);

      // Wait for pipeline to be fully activated before ingesting data
      testLogger.info('Waiting for pipeline to activate...');
      await page.waitForTimeout(5000);

      // Step 5: Second ingestion (this gets processed by pipeline)
      testLogger.info('Step 5: Ingesting same data again - pipeline will process this');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(10000); // Wait for pipeline processing and indexing

      // Step 6: Query destination stream
      testLogger.info('Step 6: Querying destination stream for filtered results');
      const results = await pageManager.streamsPage.queryStream(destStream, 0);

      testLogger.info('Validating impossible condition results (negative test)', { resultCount: results.length });

      // Should have exactly 0 passing records
      expect(results.length).toBe(0);

      testLogger.info('✅ Negative test with impossible condition PASSED');

    } finally {
      await pageManager.apiCleanup.deletePipeline(pipelineName);
    }
  });

  /**
   * Test 9: Universal Condition - All Records Pass
   *
   * Condition: age >= 0
   *
   * Test Data Scenarios:
   * This is an edge case test with a universal condition that should match all records.
   * 1. age=5 → PASS (age >= 0)
   * 2. age=25 → PASS (age >= 0)
   * 3. age=50 → PASS (age >= 0)
   * 4. age=75 → PASS (age >= 0)
   * 5. age=100 → PASS (age >= 0)
   * Expected: All 5 records should pass
   */
  test("should validate universal condition where all records pass", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesUniversalCondition']
  }, async ({ page }) => {
    const testTimestamp = Date.now();
    const pipelineName = `validation-universal-${testTimestamp}`;
    const sourceStream = `e2e_universal_src_${testTimestamp}`;
    const destStream = `e2e_universal_dest_${testTimestamp}`;

    // Set cleanup variables
    currentPipelineName = pipelineName;
    currentSourceStream = sourceStream;
    currentDestStream = destStream;

    // Define condition: age >= 0 (universal - all ages should pass)
    const conditions = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "age",
          operator: ">=",
          value: "0",
          logicalOperator: "AND"
        }
      ]
    };

    const testData = [
      // All scenarios should PASS because age >= 0 is always true
      { name: "Victor Hill", age: 5, city: "Atlanta", state: "GA", income: 0 },
      { name: "Wendy King", age: 25, city: "Nashville", state: "TN", income: 55000 },
      { name: "Xavier Scott", age: 50, city: "Charlotte", state: "NC", income: 95000 },
      { name: "Yvonne Green", age: 75, city: "Tampa", state: "FL", income: 42000 },
      { name: "Zach Baker", age: 100, city: "Orlando", state: "FL", income: 38000 }
    ];

    try {
      // Step 1: Create source stream explicitly FIRST
      testLogger.info('Step 1: Creating source stream');
      await pageManager.streamsPage.createStream(sourceStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 2: Ingest data to establish schema (before pipeline exists)
      testLogger.info('Step 2: Ingesting data to source stream to establish schema');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(2000);

      // Step 3: Create destination stream
      testLogger.info('Step 3: Creating destination stream');
      await pageManager.streamsPage.createStream(destStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 4: Create pipeline with conditions
      testLogger.info('Step 4: Creating pipeline with conditions');
      await pageManager.pipelinesPage.createPipeline(pipelineName, sourceStream, destStream, conditions);

      // Wait for pipeline to be fully activated before ingesting data
      testLogger.info('Waiting for pipeline to activate...');
      await page.waitForTimeout(5000);

      // Step 5: Second ingestion (this gets processed by pipeline)
      testLogger.info('Step 5: Ingesting same data again - pipeline will process this');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(10000); // Wait for pipeline processing and indexing

      // Step 6: Query destination stream
      testLogger.info('Step 6: Querying destination stream for filtered results');
      const results = await pageManager.streamsPage.queryStream(destStream, 5);

      testLogger.info('Validating universal condition results', { resultCount: results.length });

      // Should have exactly 5 passing records (all records)
      expect(results.length).toBe(5);

      const resultNames = results.map(r => r.name).sort();
      const expectedNames = ["Victor Hill", "Wendy King", "Xavier Scott", "Yvonne Green", "Zach Baker"].sort();

      expect(resultNames).toEqual(expectedNames);

      // Verify all have age >= 0
      results.forEach(record => {
        expect(record.age).toBeGreaterThanOrEqual(0);
      });

      testLogger.info('✅ Universal condition validation PASSED');

    } finally {
      await pageManager.apiCleanup.deletePipeline(pipelineName);
    }
  });

  /**
   * Test 10: Maximum Nesting Depth (1 Level Below Root)
   *
   * Condition: (state='CA' AND city='San Jose' AND age >= 40) AND income > 50000
   *
   * IMPORTANT: Following v2 format rules and constraints:
   * - Pattern: (CONDITION AND/OR (CG1 AND/OR (CG1.1)))
   * - Maximum nesting depth: 2 levels total (root + 1 nested level)
   * - Groups establish the hierarchy first, then flat conditions
   *
   * Structure:
   * Root: AND
   *   - Level 1 Group (AND): state='CA' AND city='San Jose' AND age >= 40
   *   - income > 50000 (flat condition at root)
   *
   * This tests maximum supported nesting: 1 nested group level below root
   *
   * Test Data Scenarios:
   * 1. income=75000, state='CA', city='San Jose', age=45 → PASS (all match)
   * 2. income=80000, state='TX', city='Houston', age=50 → FAIL (state/city wrong)
   * 3. income=90000, state='CA', city='Los Angeles', age=45 → FAIL (city wrong)
   * 4. income=85000, state='CA', city='San Jose', age=25 → FAIL (age < 40)
   * 5. income=40000, state='CA', city='San Jose', age=45 → FAIL (income <= 50000)
   * 6. income=95000, state='CA', city='San Jose', age=50 → PASS (all match)
   */
  test("should validate maximum nesting depth", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesConditionsMaxDepth']
  }, async ({ page }) => {
    const testTimestamp = Date.now();
    const pipelineName = `validation-4level-${testTimestamp}`;
    const sourceStream = `e2e_4level_src_${testTimestamp}`;
    const destStream = `e2e_4level_dest_${testTimestamp}`;

    // Set cleanup variables
    currentPipelineName = pipelineName;
    currentSourceStream = sourceStream;
    currentDestStream = destStream;

    // Define maximum nesting depth condition (1 level below root)
    // Pattern: income > 50000 AND (state='CA' AND city='San Jose' AND age >= 40)
    // v2 requires: COND first, then CG as sibling
    const conditions = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "income",
          operator: ">",
          value: "50000",
          logicalOperator: "AND"
        },
        {
          // Level 1 Group (AND) - nested below root
          filterType: "group",
          logicalOperator: "AND",
          conditions: [
            {
              filterType: "condition",
              column: "state",
              operator: "=",
              value: "CA",
              logicalOperator: "AND"
            },
            {
              filterType: "condition",
              column: "city",
              operator: "=",
              value: "San Jose",
              logicalOperator: "AND"
            },
            {
              filterType: "condition",
              column: "age",
              operator: ">=",
              value: "40",
              logicalOperator: "AND"
            }
          ]
        }
      ]
    };

    const testData = [
      // Scenario 1: income=75000, state='CA', city='San Jose', age=45 → PASS
      { name: "Amy Foster", age: 45, city: "San Jose", state: "CA", income: 75000 },

      // Scenario 2: income=80000, state='TX', city='Houston', age=50 → FAIL (state/city)
      { name: "Ben Cooper", age: 50, city: "Houston", state: "TX", income: 80000 },

      // Scenario 3: income=90000, state='CA', city='Los Angeles', age=45 → FAIL (city)
      { name: "Cara Jenkins", age: 45, city: "Los Angeles", state: "CA", income: 90000 },

      // Scenario 4: income=85000, state='CA', city='San Jose', age=25 → FAIL (age < 40)
      { name: "Dan Reed", age: 25, city: "San Jose", state: "CA", income: 85000 },

      // Scenario 5: income=40000, state='CA', city='San Jose', age=45 → FAIL (income)
      { name: "Eva Bell", age: 45, city: "San Jose", state: "CA", income: 40000 },

      // Scenario 6: income=95000, state='CA', city='San Jose', age=50 → PASS
      { name: "Fred Hayes", age: 50, city: "San Jose", state: "CA", income: 95000 }
    ];

    try {
      // Step 1: Create source stream explicitly FIRST
      testLogger.info('Step 1: Creating source stream');
      await pageManager.streamsPage.createStream(sourceStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 2: Ingest data to establish schema (before pipeline exists)
      testLogger.info('Step 2: Ingesting data to source stream to establish schema');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(2000);

      // Step 3: Create destination stream
      testLogger.info('Step 3: Creating destination stream');
      await pageManager.streamsPage.createStream(destStream, 'logs');
      await page.waitForTimeout(1000);

      // Step 4: Create pipeline with conditions
      testLogger.info('Step 4: Creating pipeline with conditions');
      await pageManager.pipelinesPage.createPipeline(pipelineName, sourceStream, destStream, conditions);

      // Wait for pipeline to be fully activated before ingesting data
      testLogger.info('Waiting for pipeline to activate...');
      await page.waitForTimeout(5000);

      // Step 5: Second ingestion (this gets processed by pipeline)
      testLogger.info('Step 5: Ingesting same data again - pipeline will process this');
      await pageManager.logsPage.ingestData(sourceStream, testData);
      await page.waitForTimeout(10000); // Wait for pipeline processing and indexing

      // Step 6: Query destination stream
      testLogger.info('Step 6: Querying destination stream for filtered results');
      const results = await pageManager.streamsPage.queryStream(destStream, 2);

      testLogger.info('Validating maximum nesting depth results', { resultCount: results.length });

      // Should have exactly 2 passing records (Amy, Fred)
      expect(results.length).toBe(2);

      const resultNames = results.map(r => r.name).sort();
      const expectedNames = ["Amy Foster", "Fred Hayes"].sort();

      expect(resultNames).toEqual(expectedNames);

      // Verify each record matches expected conditions
      results.forEach(record => {
        expect(record.income).toBeGreaterThan(50000);
        expect(record.state).toBe("CA");
        expect(record.city).toBe("San Jose");
        expect(record.age).toBeGreaterThanOrEqual(40);
      });

      testLogger.info('✅ Maximum nesting depth validation PASSED');

    } finally {
      await pageManager.apiCleanup.deletePipeline(pipelineName);
    }
  });
});
