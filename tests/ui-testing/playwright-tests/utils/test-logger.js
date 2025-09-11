const winston = require('winston');
const path = require('path');
const fs = require('fs');

/**
 * Enhanced Test Logger with file and console output
 * Uses Winston for professional logging capabilities
 */
class TestLogger {
  constructor() {
    this.logsDir = path.join(process.cwd(), 'test-logs');
    this.ensureLogDirectory();
    this.logger = this.createLogger();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  createLogger() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logFile = path.join(this.logsDir, `test-run-${timestamp}.log`);
    
    return winston.createLogger({
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        // File transport - ALL logs
        new winston.transports.File({
          filename: logFile,
          level: 'debug',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, meta, ...other }) => {
              const hasMetaContent = meta && Object.keys(meta).length > 0;
              const metaStr = hasMetaContent ? ` | ${JSON.stringify(meta)}` : '';
              const otherStr = Object.keys(other).length ? ` | ${JSON.stringify(other)}` : '';
              return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}${otherStr}`;
            })
          )
        }),
        
        // Console transport - Major logs only (info, warn, error)
        new winston.transports.Console({
          level: 'info',
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message, meta, ...other }) => {
              const emoji = this.getLogEmoji(level);
              const hasMetaContent = meta && Object.keys(meta).length > 0;
              const metaStr = hasMetaContent ? ` | ${JSON.stringify(meta)}` : '';
              return `${timestamp} ${emoji} ${message}${metaStr}`;
            })
          )
        })
      ]
    });
  }

  getLogEmoji(level) {
    const emojis = {
      error: '❌',
      warn: '⚠️ ',
      info: '🔍',
      debug: '🐛'
    };
    return emojis[level.toLowerCase()] || '📝';
  }

  // Main logging methods
  debug(message, meta = {}) {
    this.logger.debug(message, { meta, testContext: this.getTestContext() });
  }

  info(message, meta = {}) {
    this.logger.info(message, { meta, testContext: this.getTestContext() });
  }

  warn(message, meta = {}) {
    this.logger.warn(message, { meta, testContext: this.getTestContext() });
  }

  error(message, meta = {}) {
    this.logger.error(message, { meta, testContext: this.getTestContext() });
  }

  // Test-specific logging methods
  testStart(testName, file) {
    this.info(`Test Started: ${testName}`, { file, action: 'test_start' });
  }

  testEnd(testName, status, duration) {
    const level = status === 'passed' ? 'info' : 'error';
    this.logger.log(level, `Test ${status.toUpperCase()}: ${testName}`, {
      status,
      duration: `${duration}ms`,
      action: 'test_end'
    });
  }

  step(stepName, meta = {}) {
    this.debug(`Step: ${stepName}`, { ...meta, action: 'test_step' });
  }

  action(actionName, locator, meta = {}) {
    this.debug(`Action: ${actionName}`, { 
      locator: locator?.toString?.() || locator, 
      ...meta, 
      action: 'user_action' 
    });
  }

  wait(waitType, condition, meta = {}) {
    this.debug(`Wait: ${waitType} - ${condition}`, { ...meta, action: 'wait' });
  }

  navigation(url, meta = {}) {
    this.info(`Navigation: ${url}`, { ...meta, action: 'navigation' });
  }

  assertion(description, result, meta = {}) {
    const level = result ? 'debug' : 'warn';
    this.logger.log(level, `Assertion: ${description} - ${result ? 'PASS' : 'FAIL'}`, {
      result,
      ...meta,
      action: 'assertion'
    });
  }

  apiCall(method, url, status, duration, meta = {}) {
    const level = status >= 200 && status < 400 ? 'debug' : 'warn';
    this.logger.log(level, `API: ${method} ${url} - ${status}`, {
      method,
      url,
      status,
      duration: `${duration}ms`,
      ...meta,
      action: 'api_call'
    });
  }

  // Utility methods
  getTestContext() {
    try {
      const stack = new Error().stack;
      // Match various test file patterns: .spec.js, .test.js, .e2e.js, etc.
      const testMatch = stack.match(/at.*\/([^\/]*\.(spec|test|e2e)\.js):(\d+):\d+/);
      if (testMatch) {
        return {
          file: testMatch[1],
          line: testMatch[3]
        };
      }
      
      // Fallback: match any .js file in the stack (less specific but more flexible)
      const jsMatch = stack.match(/at.*\/([^\/]*\.js):(\d+):\d+/);
      if (jsMatch) {
        return {
          file: jsMatch[1],
          line: jsMatch[2]
        };
      }
    } catch (e) {
      // Ignore error, return empty context
    }
    return {};
  }

  // Setup method to get current log file path
  getCurrentLogFile() {
    const fileTransport = this.logger.transports.find(t => t instanceof winston.transports.File);
    return fileTransport ? fileTransport.filename : null;
  }

  // Clean old log files (keep last 10)
  cleanOldLogs() {
    try {
      const files = fs.readdirSync(this.logsDir)
        .filter(file => file.startsWith('test-run-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(this.logsDir, file),
          mtime: fs.statSync(path.join(this.logsDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 10) {
        files.slice(10).forEach(file => {
          fs.unlinkSync(file.path);
          this.debug(`Cleaned old log file: ${file.name}`);
        });
      }
    } catch (error) {
      this.warn('Failed to clean old log files', { error: error.message });
    }
  }
}

// Create singleton instance
const testLogger = new TestLogger();

// Clean old logs on initialization
testLogger.cleanOldLogs();

module.exports = testLogger;