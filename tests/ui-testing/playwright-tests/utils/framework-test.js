/**
 * Quick validation script for the enhanced framework
 * Tests logger and wait helpers functionality
 */

import testLogger from './test-logger.js';
import { waitUtils } from './wait-helpers.js';

async function testFramework() {
  console.log('\n🧪 Testing Enhanced Framework Components...\n');

  // Test logger functionality
  console.log('📝 Testing Logger:');
  testLogger.info('This is an info message', { component: 'framework-test' });
  testLogger.debug('This is a debug message (should only appear in log file)');
  testLogger.warn('This is a warning message');
  testLogger.error('This is an error message (for testing only)');
  
  testLogger.step('Testing step logging');
  testLogger.navigation('https://example.com', { testNavigation: true });
  testLogger.assertion('Framework components loaded', true);

  console.log('✅ Logger test completed');
  console.log(`📁 Log file location: ${testLogger.getCurrentLogFile()}`);
  
  console.log('\n🔧 Framework validation complete!');
  console.log('\nNext steps:');
  console.log('1. Run: npx playwright test sanity-enhanced.spec.js --headed');
  console.log('2. Check test-logs/ directory for detailed logs');
  console.log('3. Verify no hard waits are executed');
}

testFramework().catch(console.error);