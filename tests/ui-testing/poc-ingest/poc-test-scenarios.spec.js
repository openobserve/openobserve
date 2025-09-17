// POC Test Scenarios for OpenObserve Dashboard Demo
const { test, expect } = require('@playwright/test');

test.describe('POC Authentication Tests', () => {
  test('should always pass - valid login simulation', async ({ page }) => {
    // Simple passing test
    await page.goto('data:text/html,<html><body>Login Success 200</body></html>');
    const response = await page.locator('body').textContent();
    expect(response).toContain('Login Success');
  });

  test('should fail consistently - invalid credentials', async ({ page }) => {
    // Simulate a failed authentication test  
    await page.goto('data:text/html,<html><body>Login Failed 401</body></html>');
    const response = await page.locator('body').textContent();
    expect(response).toContain('Success'); // This will fail
  });
});

test.describe('POC Data Ingestion Tests', () => {
  test('should pass - data ingestion endpoint', async ({ page }) => {
    // Simple passing test
    await page.goto('data:text/html,<html><body>Data ingested successfully</body></html>');
    const response = await page.locator('body').textContent();
    expect(response).toContain('ingested');
  });

  test('should be flaky - network dependent operation', async ({ page }) => {
    // This test will be truly flaky - fail on first attempt, pass on retry
    await page.goto('data:text/html,<html><body>Flaky operation result</body></html>');
    
    // Get current retry count from test info
    const testInfo = test.info();
    if (testInfo.retry === 0) {
      // Fail on first attempt
      expect('fail').toBe('pass');
    } else {
      // Pass on retry
      expect('pass').toBe('pass');
    }
  });
});

test.describe('POC Query Tests', () => {
  test('should pass - basic query validation', async ({ page }) => {
    // Simple passing test
    await page.goto('data:text/html,<html><body>Query executed successfully</body></html>');
    const response = await page.locator('body').textContent();
    expect(response).toContain('Query executed');
  });

  test('should fail - malformed query', async ({ page }) => {
    // Simple failing test
    await page.goto('data:text/html,<html><body>Query syntax error</body></html>');
    const response = await page.locator('body').textContent();
    expect(response).toContain('Success'); // This will fail
  });
});

test.describe('POC CTE Query Tests', () => {
  test('should pass - simple CTE query test', async ({ page }) => {
    // Simple passing CTE test
    await page.goto('data:text/html,<html><body>CTE query executed successfully</body></html>');
    const response = await page.locator('body').textContent();
    expect(response).toContain('CTE query executed');
  });

  test('should fail - complex CTE validation', async ({ page }) => {
    // CTE test that will fail
    await page.goto('data:text/html,<html><body>CTE query failed validation</body></html>');
    const response = await page.locator('body').textContent();
    expect(response).toContain('Success'); // This will fail
  });

  test('should be flaky - CTE performance dependent test', async ({ page }) => {
    // This test will be flaky - fail on first attempt, pass on retry
    await page.goto('data:text/html,<html><body>CTE performance test</body></html>');
    
    // Get current retry count from test info
    const testInfo = test.info();
    if (testInfo.retry === 0) {
      // Fail on first attempt
      expect('cte_fail').toBe('cte_pass');
    } else {
      // Pass on retry
      expect('cte_pass').toBe('cte_pass');
    }
  });
});