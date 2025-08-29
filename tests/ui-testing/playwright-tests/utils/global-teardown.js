const path = require('path');
const fs = require('fs');

/**
 * Global teardown for all tests
 * This runs once after all tests complete
 */
async function globalTeardown() {
  console.log('🧹 Starting global teardown...');
  
  try {
    // Clean up authentication files if needed
    const authFile = path.join(__dirname, 'auth', 'user.json');
    
    if (fs.existsSync(authFile)) {
      console.log('🗑️  Cleaning up authentication state');
      // Optionally remove auth file - comment out if you want to keep it
      // fs.unlinkSync(authFile);
    }
    
    // Add any other cleanup tasks here
    console.log('✅ Global teardown completed');
    
  } catch (error) {
    console.error('❌ Global teardown failed:', error);
    // Don't throw error to avoid failing the entire test run
  }
}

module.exports = globalTeardown;