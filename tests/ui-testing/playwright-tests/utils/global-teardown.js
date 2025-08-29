const path = require('path');
const fs = require('fs');
const testLogger = require('./test-logger.js');

/**
 * Global teardown for all tests
 * This runs once after all tests complete
 */
async function globalTeardown() {
  testLogger.info('Starting global teardown');
  
  try {
    // Clean up authentication files if needed
    const authFile = path.join(__dirname, 'auth', 'user.json');
    
    if (fs.existsSync(authFile)) {
      testLogger.info('🗑️  Cleaning up authentication state');
      // Optionally remove auth file - comment out if you want to keep it
      // fs.unlinkSync(authFile);
    }
    
    // Add any other cleanup tasks here
    testLogger.info('✅ Global teardown completed');
    
  } catch (error) {
    testLogger.error('Global teardown failed', { error });
    // Don't throw error to avoid failing the entire test run
  }
}

module.exports = globalTeardown;