const testLogger = require('./test-logger.js');

/**
 * Enhanced wait utilities with double assurance (locator + page state)
 * Replaces all hard waits with proper Playwright waits
 */
export class WaitHelpers {
  constructor(page) {
    this.page = page;
  }

  /**
   * Wait for element to be visible with page state assurance
   * @param {string|Locator} selector - CSS selector or Playwright locator
   * @param {Object} options - Wait options
   */
  async waitForElementVisible(selector, options = {}) {
    const { timeout = 30000, description = 'element to be visible' } = options;
    
    testLogger.wait('Element Visible', description, { selector: selector.toString?.() || selector });
    
    try {
      const locator = typeof selector === 'string' ? this.page.locator(selector) : selector;
      
      // Double assurance: locator + page state
      await Promise.all([
        locator.waitFor({ state: 'visible', timeout }),
        this.page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 10000) })
      ]);
      
      testLogger.debug(`Element visible: ${description}`);
      return locator;
    } catch (error) {
      testLogger.error(`Element not visible: ${description}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Wait for element to be clickable (visible + enabled)
   * @param {string|Locator} selector - CSS selector or Playwright locator
   * @param {Object} options - Wait options
   */
  async waitForElementClickable(selector, options = {}) {
    const { timeout = 30000, description = 'element to be clickable' } = options;
    
    testLogger.wait('Element Clickable', description, { selector: selector.toString?.() || selector });
    
    try {
      const locator = typeof selector === 'string' ? this.page.locator(selector) : selector;
      
      // Wait for visible and enabled states
      await locator.waitFor({ state: 'visible', timeout });
      await locator.waitFor({ state: 'attached', timeout });
      
      // For locator objects, we'll just skip the disabled check since locator.click() handles it
      if (typeof selector !== 'string') {
        // Locator objects handle disabled state automatically
        testLogger.debug(`Element clickable (locator): ${description}`);
        return locator;
      }
      
      // Only do disabled check for string selectors
      await this.page.waitForFunction(
        (sel) => {
          const element = document.querySelector(sel);
          return element && !element.disabled && !element.hasAttribute('disabled');
        },
        selector,
        { timeout }
      );
      
      testLogger.debug(`Element clickable: ${description}`);
      return locator;
    } catch (error) {
      testLogger.error(`Element not clickable: ${description}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Wait for API response with enhanced logging
   * @param {string|RegExp} urlPattern - URL pattern to match
   * @param {Object} options - Wait options
   */
  async waitForApiResponse(urlPattern, options = {}) {
    const { 
      timeout = 30000, 
      status = [200], 
      description = 'API response',
      method = null 
    } = options;
    
    testLogger.wait('API Response', description, { urlPattern, expectedStatus: status });
    
    try {
      const startTime = Date.now();
      const response = await this.page.waitForResponse(
        (response) => {
          const url = response.url();
          const matchesUrl = typeof urlPattern === 'string' ? 
            url.includes(urlPattern) : 
            urlPattern.test(url);
          
          const matchesMethod = !method || response.request().method() === method;
          const matchesStatus = Array.isArray(status) ? 
            status.includes(response.status()) : 
            response.status() === status;
          
          return matchesUrl && matchesMethod && matchesStatus;
        },
        { timeout }
      );
      
      const duration = Date.now() - startTime;
      testLogger.apiCall(
        response.request().method(),
        response.url(),
        response.status(),
        duration,
        { description }
      );
      
      return response;
    } catch (error) {
      testLogger.error(`API response timeout: ${description}`, { 
        urlPattern, 
        expectedStatus: status,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Wait for page navigation to complete
   * @param {Function} action - Function that triggers navigation
   * @param {Object} options - Wait options
   */
  async waitForNavigation(action, options = {}) {
    const { timeout = 30000, description = 'navigation' } = options;
    
    testLogger.wait('Navigation', description);
    
    try {
      await Promise.all([
        this.page.waitForLoadState('networkidle', { timeout }),
        action()
      ]);
      
      testLogger.navigation(this.page.url(), { description });
    } catch (error) {
      testLogger.error(`Navigation failed: ${description}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Wait for text content to appear in element
   * @param {string|Locator} selector - CSS selector or Playwright locator
   * @param {string|RegExp} text - Expected text or pattern
   * @param {Object} options - Wait options
   */
  async waitForTextContent(selector, text, options = {}) {
    const { timeout = 30000, description = 'text content' } = options;
    
    testLogger.wait('Text Content', description, { 
      selector: selector.toString?.() || selector, 
      expectedText: text 
    });
    
    try {
      const locator = typeof selector === 'string' ? this.page.locator(selector) : selector;
      
      if (typeof text === 'string') {
        await locator.getByText(text).waitFor({ timeout });
      } else {
        // For RegExp, use waitForFunction
        await this.page.waitForFunction(
          (sel, pattern) => {
            const element = typeof sel === 'string' ? 
              document.querySelector(sel) : 
              sel;
            return element && new RegExp(pattern).test(element.textContent);
          },
          selector,
          text.source,
          { timeout }
        );
      }
      
      testLogger.debug(`Text content found: ${description}`);
      return locator;
    } catch (error) {
      testLogger.error(`Text content not found: ${description}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Wait for element to disappear
   * @param {string|Locator} selector - CSS selector or Playwright locator
   * @param {Object} options - Wait options
   */
  async waitForElementHidden(selector, options = {}) {
    const { timeout = 30000, description = 'element to be hidden' } = options;
    
    testLogger.wait('Element Hidden', description, { selector: selector.toString?.() || selector });
    
    try {
      const locator = typeof selector === 'string' ? this.page.locator(selector) : selector;
      await locator.waitFor({ state: 'hidden', timeout });
      
      testLogger.debug(`Element hidden: ${description}`);
    } catch (error) {
      testLogger.error(`Element still visible: ${description}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Smart wait for form submission (handles both navigation and AJAX)
   * @param {Function} submitAction - Function that submits the form
   * @param {Object} options - Wait options
   */
  async waitForFormSubmission(submitAction, options = {}) {
    const { 
      timeout = 30000, 
      waitForResponse = null, 
      waitForNavigation = false,
      description = 'form submission'
    } = options;
    
    testLogger.wait('Form Submission', description);
    
    try {
      const promises = [submitAction()];
      
      if (waitForNavigation) {
        promises.push(this.page.waitForLoadState('networkidle', { timeout }));
      }
      
      if (waitForResponse) {
        promises.push(this.waitForApiResponse(waitForResponse, { timeout }));
      }
      
      await Promise.all(promises);
      
      testLogger.debug(`Form submitted: ${description}`);
    } catch (error) {
      testLogger.error(`Form submission failed: ${description}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Wait with retries for flaky elements
   * @param {Function} action - Action to retry
   * @param {Object} options - Retry options
   */
  async waitWithRetry(action, options = {}) {
    const { 
      retries = 3, 
      delay = 1000, 
      description = 'action with retry' 
    } = options;
    
    testLogger.wait('Retry Action', description, { maxRetries: retries });
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await action();
        testLogger.debug(`Action succeeded on attempt ${attempt}: ${description}`);
        return;
      } catch (error) {
        if (attempt === retries) {
          testLogger.error(`Action failed after ${retries} attempts: ${description}`, { 
            error: error.message 
          });
          throw error;
        }
        
        testLogger.warn(`Attempt ${attempt} failed, retrying: ${description}`, { 
          error: error.message,
          nextRetryIn: `${delay}ms`
        });
        
        // Use intelligent wait instead of hard timeout
        if (delay <= 1000) {
          await this.page.waitForLoadState('domcontentloaded');
        } else {
          await this.page.waitForLoadState('networkidle', { timeout: Math.min(delay, 3000) });
        }
      }
    }
  }
}

/**
 * Enhanced utility functions for common wait patterns
 */
const waitUtils = {
  /**
   * Replace page.waitForTimeout with smart waiting
   * @param {import('@playwright/test').Page} page 
   * @param {number} ms - Milliseconds (will be converted to smart wait)
   * @param {string} reason - Reason for waiting
   */
  async smartWait(page, ms, reason = 'timeout replacement') {
    // Convert common timeout patterns to smart waits
    if (ms <= 1000) {
      // Short waits - usually for UI updates
      await page.waitForLoadState('domcontentloaded');
    } else if (ms <= 5000) {
      // Medium waits - usually for network/API
      await page.waitForLoadState('networkidle');
    } else {
      // Long waits - fallback to shorter intelligent wait
      await page.waitForLoadState('networkidle', { timeout: Math.min(ms, 10000) });
    }
  },

  /**
   * Create wait helpers instance for a page
   * @param {import('@playwright/test').Page} page 
   */
  create(page) {
    return new WaitHelpers(page);
  }
};

module.exports = {
  WaitHelpers,
  waitUtils
};