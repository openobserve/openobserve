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
    // Note: We intentionally do NOT delete user.json here.
    // Global setup recreates it each run, and deleting it mid-run
    // causes race conditions when multiple test files run in parallel.

    // Add any other cleanup tasks here
    testLogger.info('✅ Global teardown completed');
    
  } catch (error) {
    testLogger.error('Global teardown failed', { error });
    // Don't throw error to avoid failing the entire test run
  }
}

module.exports = globalTeardown;