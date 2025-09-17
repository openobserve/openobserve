const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: '../.env' });

const BASE_URL = process.env.ZO_BASE_URL;
const USER = process.env.ZO_ROOT_USER_EMAIL;
const PASS = process.env.ZO_ROOT_USER_PASSWORD;

async function uploadTestResults() {
  try {
    console.log('📊 Uploading POC test results to OpenObserve...');
    
    // Read the test results
    const testResults = JSON.parse(fs.readFileSync('./test-result.json', 'utf8'));
    const dashboardConfig = JSON.parse(fs.readFileSync('./poc-test-results-dashboard.json', 'utf8'));
    
    // Extract test data for ingestion
    const testData = [];
    const timestamp = new Date(testResults.stats.startTime).toISOString();
    
    testResults.suites.forEach(suite => {
      suite.suites.forEach(testSuite => {
        testSuite.specs.forEach(spec => {
          const testRecord = {
            _timestamp: timestamp,
            suite: testSuite.title,
            test_name: spec.title,
            status: spec.ok ? (spec.tests[0].status === 'flaky' ? 'flaky' : 'passed') : 'failed',
            duration_ms: spec.tests[0].results[0].duration,
            retry_count: spec.tests[0].results.length - 1,
            passed: spec.ok ? 1 : 0,
            failed: spec.ok ? 0 : 1,
            flaky: spec.tests[0].status === 'flaky' ? 1 : 0,
            stream: 'pw_automation'
          };
          testData.push(testRecord);
        });
      });
    });
    
    console.log('📈 Test data summary:');
    console.log(`  • Total tests: ${testData.length}`);
    console.log(`  • Passed: ${testData.filter(t => t.status === 'passed').length}`);
    console.log(`  • Failed: ${testData.filter(t => t.status === 'failed').length}`);
    console.log(`  • Flaky: ${testData.filter(t => t.status === 'flaky').length}`);
    console.log(`  • Total duration: ${testResults.stats.duration}ms`);
    
    // Create logs ingestion payload
    const payload = {
      stream_name: 'pw_automation',
      data: testData
    };
    
    // Save formatted data for manual review
    fs.writeFileSync('./formatted-test-data.json', JSON.stringify(payload, null, 2));
    console.log('💾 Formatted test data saved to formatted-test-data.json');
    
    // Save dashboard config for import
    console.log('📋 Dashboard configuration saved to poc-test-results-dashboard.json');
    console.log(`📊 Dashboard can be imported to: ${BASE_URL}/web/dashboards`);
    
    console.log('\n🎯 Next steps:');
    console.log('1. Import the dashboard JSON via the OpenObserve UI');
    console.log('2. Use formatted-test-data.json for bulk ingestion if needed');
    console.log('3. The dashboard will show the POC test results visualization');
    
    return {
      testData,
      dashboardConfig,
      stats: testResults.stats
    };
    
  } catch (error) {
    console.error('❌ Error uploading results:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  uploadTestResults().catch(console.error);
}

module.exports = { uploadTestResults };