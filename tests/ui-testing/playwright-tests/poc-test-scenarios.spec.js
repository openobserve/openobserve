import { test, expect } from './baseFixtures.js';

test.describe('POC Test Scenarios for Observability', () => {
  
  // Configure retries to create flaky behavior
  test.describe.configure({ 
    mode: 'parallel',
    retries: 2  // This will help create flaky results
  });
  
  // Always passing test
  test('should always pass', async ({ page }) => {
    await page.goto('https://httpbin.org/status/200');
    expect(await page.textContent('body')).toContain('');
  });

  // Always failing test
  test('should always fail', async ({ page }) => {
    await page.goto('https://httpbin.org/status/200');
    // Intentionally failing assertion
    expect(1).toBe(2);
  });

  // Flaky test that randomly passes or fails
  test('flaky test - random pass/fail', async ({ page }) => {
    const random = Math.random();
    console.log('Random value:', random);
    
    await page.goto('https://httpbin.org/status/200');
    
    // 50% chance of passing
    if (random > 0.5) {
      expect(true).toBe(true);
    } else {
      expect(true).toBe(false);
    }
  });

  // Another flaky test - timeout based
  test('flaky test - timeout scenario', async ({ page }) => {
    const shouldTimeout = Math.random() > 0.6;
    
    if (shouldTimeout) {
      // This will timeout and fail
      await page.goto('https://httpbin.org/delay/10', { timeout: 3000 });
    } else {
      // This will pass
      await page.goto('https://httpbin.org/status/200');
      expect(await page.locator('body').isVisible()).toBe(true);
    }
  });

  // Test with different durations
  test('slow test', async ({ page }) => {
    await page.goto('https://httpbin.org/delay/2');
    expect(await page.locator('body').isVisible()).toBe(true);
  });

  test('fast test', async ({ page }) => {
    await page.goto('https://httpbin.org/status/200');
    expect(await page.locator('body').isVisible()).toBe(true);
  });
});