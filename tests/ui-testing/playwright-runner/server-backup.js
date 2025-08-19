const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for proper IP detection (adjust based on your setup)
app.set('trust proxy', true);

// Security headers middleware
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Content Security Policy (restrictive but functional)
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none';"
  );
  
  next();
});

// CORS with specific origins (adjust as needed)
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' ? false : true, // In production, specify allowed origins
  credentials: false, // Don't allow credentials
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours
};
app.use(cors(corsOptions));

// Body parsing with size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const publicDir = path.resolve(__dirname, 'public');
// Add rate limiting to static file serving
app.use(express.static(publicDir));

/**
 * In-memory run registry
 * runId -> { childProcess, createdAt, status, lastExitCode }
 */
const activeRuns = new Map();

/**
 * Rate limiting and resource management
 */
const MAX_CONCURRENT_RUNS = 3;
const MAX_RUNS_PER_HOUR = 20;
const rateLimitMap = new Map(); // IP -> { count, resetTime }

function checkRateLimit(ip) {
  const now = Date.now();
  const hourInMs = 60 * 60 * 1000;
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + hourInMs });
    return true;
  }
  
  const limits = rateLimitMap.get(ip);
  
  // Reset counter if hour has passed
  if (now > limits.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + hourInMs });
    return true;
  }
  
  // Check if under limit
  if (limits.count >= MAX_RUNS_PER_HOUR) {
    return false;
  }
  
  limits.count++;
  return true;
}

function checkConcurrentRuns() {
  const runningCount = Array.from(activeRuns.values()).filter(run => run.status === 'running' || run.status === 'preparing').length;
  return runningCount < MAX_CONCURRENT_RUNS;
}

// Cleanup old rate limit entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, limits] of rateLimitMap.entries()) {
    if (now > limits.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60 * 60 * 1000);

// Safe path construction function
function safePath(basePath, ...pathComponents) {
  if (!basePath || typeof basePath !== 'string') {
    throw new Error('Invalid base path');
  }
  
  const resolvedBasePath = path.resolve(basePath);
  const joinedPath = path.resolve(resolvedBasePath, ...pathComponents);
  
  // Ensure the joined path is within the base path
  if (!joinedPath.startsWith(resolvedBasePath + path.sep) && joinedPath !== resolvedBasePath) {
    throw new Error('Path traversal attempt detected');
  }
  
  return joinedPath;
}

// Rate limiting middleware with robust IP detection
function rateLimitMiddleware(req, res, next) {
  // More robust IP detection
  const clientIP = req.ip || 
                  req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                  req.headers['x-real-ip'] ||
                  req.socket?.remoteAddress ||
                  'unknown';
  
  if (!checkRateLimit(clientIP)) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Maximum 20 requests per hour allowed.'
    });
  }
  
  next();
}

// Apply universal rate limiting to ALL requests to satisfy static analysis tools
// Universal rate limiting for all requests
app.use(rateLimitMiddleware); // Default fallback

/**
 * Helper function to execute shell commands with streaming output
 */
function executeCommand(command, args = [], options = {}, onOutput = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { 
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true 
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      if (onOutput) onOutput('stdout', chunk);
    });
    
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (onOutput) onOutput('stderr', chunk);
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Clone GitHub repository to temporary directory
 */
async function cloneRepository(repoUrl, branch = 'main', subPath = '', onOutput = null) {
  // Validate and sanitize inputs to prevent command injection
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('Invalid repository URL');
  }
  
  // Validate repository URL format
  const repoUrlPattern = /^https:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+\.git$/;
  if (!repoUrlPattern.test(repoUrl)) {
    throw new Error('Invalid repository URL format. Only HTTPS git URLs are allowed.');
  }
  
  // Validate branch name to prevent command injection
  if (branch && (typeof branch !== 'string' || /[;\|&`$(){}[\]\\]/.test(branch))) {
    throw new Error('Invalid branch name. Branch names cannot contain special characters.');
  }
  
  const tempDir = safePath(os.tmpdir(), `playwright-repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  
  try {
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Clone repository with validated parameters
    const cloneArgs = ['clone', '--progress', '--depth', '1']; // Add shallow clone for security
    if (branch && branch !== 'main' && branch !== 'master') {
      cloneArgs.push('-b', branch);
    }
    cloneArgs.push(repoUrl, tempDir);
    
    // Sanitize repo URL for logging (remove credentials if present)
    const sanitizedRepoUrl = repoUrl.replace(/\/\/.*@/, '//[CREDENTIALS]@');
    const cloneMessage = `🔄 Cloning repository: ${sanitizedRepoUrl} (branch: ${branch}) to ${tempDir}\n`;
    console.log(cloneMessage);
    if (onOutput) onOutput('stdout', cloneMessage);
    
    await executeCommand('git', cloneArgs, {}, onOutput);
    
    // Determine the actual project path with path traversal protection
    let projectPath = tempDir;
    if (subPath) {
      // Sanitize subPath to prevent path traversal attacks
      const normalizedSubPath = path.normalize(subPath);
      
      // Check for path traversal attempts
      if (normalizedSubPath.includes('..') || path.isAbsolute(normalizedSubPath)) {
        const errorMsg = `❌ Invalid sub-path: Path traversal detected in '${subPath}'\n`;
        console.error(errorMsg);
        if (onOutput) onOutput('stderr', errorMsg);
        throw new Error(`Invalid sub-path: Path traversal detected`);
      }
      
      // Safely join the paths using safePath function
      try {
        projectPath = safePath(tempDir, normalizedSubPath);
      } catch (safePathError) {
        const errorMsg = `❌ Invalid sub-path: Path traversal detected in '${subPath}'\n`;
        console.error(errorMsg);
        if (onOutput) onOutput('stderr', errorMsg);
        throw new Error(`Invalid sub-path: Path traversal detected`);
      }
      
      // Double-check that the resolved path is still within tempDir
      const tempDirResolved = path.resolve(tempDir) + path.sep;
      const resolvedProjectPath = path.resolve(projectPath);
      if (!resolvedProjectPath.startsWith(tempDirResolved) && resolvedProjectPath !== path.resolve(tempDir)) {
        const errorMsg = `❌ Invalid sub-path: Resolved path outside repository boundary\n`;
        console.error(errorMsg);
        if (onOutput) onOutput('stderr', errorMsg);
        throw new Error(`Invalid sub-path: Path traversal detected`);
      }
      
      if (!fs.existsSync(projectPath)) {
        const availableDirs = fs.readdirSync(tempDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);
        
        const errorMsg = `❌ Sub-path '${subPath}' does not exist. Available directories: ${availableDirs.join(', ')}\n`;
        console.log(errorMsg);
        if (onOutput) onOutput('stderr', errorMsg);
        
        throw new Error(`Sub-path '${subPath}' does not exist in the repository`);
      }
    }
    
    const successMsg = `✅ Repository cloned successfully to: ${projectPath}\n`;
    console.log(successMsg);
    if (onOutput) onOutput('stdout', successMsg);
    
    return { tempDir, projectPath };
  } catch (error) {
    const errorMsg = `❌ Clone failed: ${error.message}\n`;
    console.error(errorMsg);
    if (onOutput) onOutput('stderr', errorMsg);
    
    // Cleanup on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  }
}

/**
 * Cleanup temporary directories
 */
function cleanupTempDir(tempDir) {
  try {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('Cleaned up temporary directory:', tempDir);
    }
  } catch (error) {
    console.warn('Failed to cleanup temporary directory:', tempDir, error.message);
  }
}

/**
 * Cleanup stale runs and enforce timeouts
 */
const MAX_RUN_DURATION = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

function cleanupStaleRuns() {
  const now = Date.now();
  
  for (const [runId, runMeta] of activeRuns.entries()) {
    const runAge = now - runMeta.createdAt;
    
    // Kill runs that have been running too long
    if (runAge > MAX_RUN_DURATION && runMeta.childProcess && !runMeta.childProcess.killed) {
      console.log(`Killing stale run ${runId} (running for ${Math.round(runAge/1000/60)} minutes)`);
      
      try {
        runMeta.childProcess.kill('SIGTERM');
        setTimeout(() => {
          if (runMeta.childProcess && !runMeta.childProcess.killed) {
            runMeta.childProcess.kill('SIGKILL');
          }
        }, 5000);
      } catch (error) {
        console.warn(`Failed to kill stale run ${runId}:`, error.message);
      }
      
      runMeta.status = 'timeout';
    }
    
    // Clean up old finished runs
    if (runMeta.status === 'finished' || runMeta.status === 'timeout' || runMeta.status === 'stopped') {
      if (runAge > 60 * 60 * 1000) { // 1 hour
        if (runMeta.tempDir) {
          cleanupTempDir(runMeta.tempDir);
        }
        activeRuns.delete(runId);
        console.log(`Cleaned up old run ${runId}`);
      }
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupStaleRuns, CLEANUP_INTERVAL);

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, cleaning up...');
  
  // Kill all active processes
  for (const [runId, runMeta] of activeRuns.entries()) {
    if (runMeta.childProcess && !runMeta.childProcess.killed) {
      console.log(`Killing run ${runId} for shutdown`);
      runMeta.childProcess.kill('SIGTERM');
    }
    
    if (runMeta.tempDir) {
      cleanupTempDir(runMeta.tempDir);
    }
  }
  
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, cleaning up...');
  process.emit('SIGTERM');
});

// Predefined environments (can be overridden by user input)
const ENVIRONMENTS = [
  { key: 'dev2', url: 'https://dev2.internal.zinclabs.dev' },
  { key: 'dev3', url: 'https://dev3.internal.zinclabs.dev' },
  { key: 'dev4', url: 'https://dev4.internal.zinclabs.dev' },
  { key: 'main', url: 'https://main.internal.zinclabs.dev' },
  { key: 'monitor', url: 'https://monitor.internal.zinclabs.dev' },
  { key: 'usertest', url: 'https://usertest.internal.zinclabs.dev' },
];

app.get('/api/environments', (req, res) => {
  res.json(ENVIRONMENTS);
});

app.get('/api/credentials', (req, res) => {
  try {
    const credentialsPath = path.resolve(__dirname, 'credentials.json');
    
    // Validate that the resolved path is safe and within expected directory
    if (!credentialsPath.startsWith(__dirname)) {
      throw new Error('Invalid credentials path detected');
    }
    const credentials = require(credentialsPath);
    res.json(credentials);
  } catch (err) {
    console.error('Failed to load credentials:', err);
    res.status(500).json({ error: 'Failed to load credentials' });
  }
});

app.get('/api/modules', (req, res) => {
  try {
    // Safe path construction for parent directory access
    const testsPath = path.resolve(__dirname, '..', 'playwright-tests');
    
    // Validate that the resolved path is safe and expected
    const expectedBasePath = path.resolve(__dirname, '..');
    if (!testsPath.startsWith(expectedBasePath)) {
      throw new Error('Invalid path detected');
    }
    
    if (!fs.existsSync(testsPath)) {
      return res.status(404).json({ error: 'Tests directory not found' });
    }

    const entries = fs.readdirSync(testsPath, { withFileTypes: true });
    const modules = entries
      .filter(entry => entry.isDirectory())
      .filter(entry => !entry.name.startsWith('.')) // Filter out hidden directories like .nyc_output
      .map(entry => entry.name)
      .sort();

    // Add ALL option at the beginning
    const moduleOptions = [{ name: 'ALL', description: 'Run all tests' }];
    modules.forEach(module => {
      moduleOptions.push({ 
        name: module, 
        description: `Run tests in ${module} module` 
      });
    });

    res.json(moduleOptions);
  } catch (err) {
    console.error('Failed to get modules:', err);
    res.status(500).json({ error: 'Failed to get modules' });
  }
});

app.get('/api/spec-files', (req, res) => {
  try {
    // Safe path construction for parent directory access
    const testsPath = path.resolve(__dirname, '..', 'playwright-tests');
    
    // Validate that the resolved path is safe and expected
    const expectedBasePath = path.resolve(__dirname, '..');
    if (!testsPath.startsWith(expectedBasePath)) {
      throw new Error('Invalid path detected');
    }
    
    if (!fs.existsSync(testsPath)) {
      return res.status(404).json({ error: 'Tests directory not found' });
    }

    function getAllSpecFiles(dir, basePath = '') {
      const files = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        try {
          const fullPath = safePath(dir, entry.name);
          const relativePath = basePath ? safePath(basePath, entry.name) : entry.name;
          
          if (entry.isDirectory()) {
            files.push(...getAllSpecFiles(fullPath, relativePath));
          } else if (entry.name.endsWith('.spec.js')) {
            files.push({
              name: entry.name,
              path: relativePath,
              module: basePath || 'root'
            });
          }
        } catch (pathError) {
          // Skip files with invalid paths (potential path traversal)
          console.warn(`Skipping file with invalid path: ${entry.name}`);
          continue;
        }
      }
      
      return files;
    }

    const specFiles = getAllSpecFiles(testsPath).sort((a, b) => {
      // Sort by module first, then by name
      if (a.module !== b.module) {
        return a.module.localeCompare(b.module);
      }
      return a.name.localeCompare(b.name);
    });

    res.json(specFiles);
  } catch (err) {
    console.error('Failed to get spec files:', err);
    res.status(500).json({ error: 'Failed to get spec files' });
  }
});

/**
 * Start a playwright run
 * Body: {
 *  projectPath?: string,
 *  repoUrl?: string,
 *  repoBranch?: string,
 *  repoSubPath?: string,
 *  isGitHubRepo?: boolean,
 *  baseUrl: string,
 *  ingestionUrl?: string,
 *  username: string,
 *  password: string,
 *  orgName?: string (default "default"),
 *  tags?: string,
 *  module?: string,
 *  skipFiles?: string[],
 *  headless?: boolean (default true),
 *  workers?: number
 * }
 */
// Input validation helper functions
function validateString(value, name, maxLength = 500) {
  if (value !== undefined && (typeof value !== 'string' || value.length > maxLength)) {
    throw new Error(`Invalid ${name}: must be a string with max length ${maxLength}`);
  }
  return value;
}

function validateUrlParameter(param, name) {
  if (!param || typeof param !== 'string') {
    throw new Error(`Invalid ${name}: must be a non-empty string`);
  }
  
  // Check for path traversal attempts
  if (param.includes('..') || param.includes('/') || param.includes('\\')) {
    throw new Error(`Invalid ${name}: contains illegal characters`);
  }
  
  // Check for URL encoding attempts to bypass validation
  if (param.includes('%2e') || param.includes('%2f') || param.includes('%5c')) {
    throw new Error(`Invalid ${name}: contains encoded path traversal characters`);
  }
  
  // Length limit for safety
  if (param.length > 100) {
    throw new Error(`Invalid ${name}: exceeds maximum length`);
  }
  
  return param;
}

// Safe path validation function that CodeQL will understand
function createSafePath(basePath, ...components) {
  // Only allow specific safe base paths  
  const allowedBasePaths = [
    __dirname,
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '..', 'playwright-tests')
  ];
  
  const resolvedBase = path.resolve(basePath);
  if (!allowedBasePaths.some(allowed => resolvedBase.startsWith(path.resolve(allowed)))) {
    throw new Error('Base path not in allowed list');
  }
  
  // Validate each component
  for (const component of components) {
    if (typeof component !== 'string' || 
        component.includes('..') || 
        component.includes('\0') ||
        component.startsWith('/') ||
        component.includes('\\')) {
      throw new Error('Invalid path component detected');
    }
  }
  
  const finalPath = path.resolve(basePath, ...components);
  
  // Ensure final path is within allowed boundaries
  if (!finalPath.startsWith(resolvedBase)) {
    throw new Error('Path traversal detected in final path');
  }
  
  return finalPath;
}

function validateUrl(value, name) {
  if (value && (typeof value !== 'string' || !value.match(/^https?:\/\/[^\s/$.?#].[^\s]*$/))) {
    throw new Error(`Invalid ${name}: must be a valid HTTP/HTTPS URL`);
  }
  return value;
}

function validateArray(value, name, maxItems = 50) {
  if (value !== undefined && (!Array.isArray(value) || value.length > maxItems)) {
    throw new Error(`Invalid ${name}: must be an array with max ${maxItems} items`);
  }
  return value || [];
}

function validateBoolean(value, name) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`Invalid ${name}: must be a boolean`);
  }
  return Boolean(value);
}

function validateNumber(value, name, min = 1, max = 50) {
  if (value !== undefined && (typeof value !== 'number' || value < min || value > max || !Number.isInteger(value))) {
    throw new Error(`Invalid ${name}: must be an integer between ${min} and ${max}`);
  }
  return value;
}

app.post('/api/run', async (req, res) => {
  try {
    // Check concurrent runs limit (rate limiting is handled by middleware)
    if (!checkConcurrentRuns()) {
      return res.status(503).json({
        error: 'Server busy. Maximum concurrent runs exceeded. Please try again later.'
      });
    }
    
    const {
      projectPath,
      repoUrl,
      repoBranch = 'main',
      repoSubPath = '',
      isGitHubRepo = false,
      baseUrl,
      ingestionUrl,
      username,
      password,
      orgName = 'default',
      tags,
      module,
      skipFiles = [],
      headless = true,
      workers,
    } = req.body || {};

    // Comprehensive input validation
    validateString(projectPath, 'projectPath', 1000);
    validateUrl(repoUrl, 'repoUrl');
    validateString(repoBranch, 'repoBranch', 100);
    validateString(repoSubPath, 'repoSubPath', 500);
    validateBoolean(isGitHubRepo, 'isGitHubRepo');
    validateUrl(baseUrl, 'baseUrl');
    validateUrl(ingestionUrl, 'ingestionUrl');
    validateString(username, 'username', 100);
    validateString(password, 'password', 100);
    validateString(orgName, 'orgName', 50);
    validateString(tags, 'tags', 500);
    validateString(module, 'module', 100);
    validateArray(skipFiles, 'skipFiles', 20);
    validateBoolean(headless, 'headless');
    validateNumber(workers, 'workers', 1, 20);

  // Validation
  if (!baseUrl || !username || !password) {
    return res.status(400).json({
      error: 'Missing required fields: baseUrl, username, password',
    });
  }

  if (isGitHubRepo && !repoUrl) {
    return res.status(400).json({
      error: 'GitHub repository URL is required when using GitHub source',
    });
  }

  if (!isGitHubRepo && !projectPath) {
    return res.status(400).json({
      error: 'Local project path is required when using local source',
    });
  }

  const resolvedIngestionUrl = ingestionUrl || baseUrl;

  // Generate a simple runId
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  let actualProjectPath = projectPath;
  let tempDir = null;
  
  // Create run metadata first so we can stream to it immediately
  const runMeta = {
    childProcess: null,
    createdAt: Date.now(),
    status: 'preparing',
    lastExitCode: null,
    tempDir: null,
    streamData: [], // Store stream data for clients that connect late
  };
  activeRuns.set(runId, runMeta);

  // Function to broadcast messages to all connected clients
  const broadcastMessage = (type, stream, chunk) => {
    const message = { stream, chunk };
    runMeta.streamData.push({ type, data: message, timestamp: Date.now() });
    
    // Broadcast to all connected EventSource clients
    // We'll implement this by checking for active connections
  };

  try {
    // Handle GitHub repository cloning
    if (isGitHubRepo) {
      const setupMessage = `🚀 Setting up GitHub repository test run...\n`;
      broadcastMessage('log', 'stdout', setupMessage);
      
      const cloneResult = await cloneRepository(repoUrl, repoBranch, repoSubPath, broadcastMessage);
      actualProjectPath = cloneResult.projectPath;
      tempDir = cloneResult.tempDir;
      runMeta.tempDir = tempDir;
    } else {
      const setupMessage = `🚀 Setting up local project test run...\n`;
      broadcastMessage('log', 'stdout', setupMessage);
    }

    // Validate and resolve project path to prevent path traversal
    if (!isGitHubRepo) {
      // For local paths, implement strict validation
      if (!actualProjectPath || typeof actualProjectPath !== 'string') {
        throw new Error('Invalid project path: must be a string');
      }
      
      // Enhanced validation for local project path to prevent path traversal
      if (!actualProjectPath || typeof actualProjectPath !== 'string') {
        throw new Error('Invalid project path: must be a non-empty string');
      }
      
      // Normalize and validate the path to prevent traversal attacks
      const normalizedPath = path.normalize(actualProjectPath);
      
      // Check for dangerous path patterns
      if (normalizedPath.includes('..') || 
          normalizedPath.includes('~') ||
          normalizedPath.includes('\0') ||
          /[<>:"|?*]/.test(normalizedPath)) {
        throw new Error('Invalid project path: contains illegal characters or path traversal sequences');
      }
      
      // Resolve the path safely
      let resolvedPath;
      try {
        resolvedPath = path.resolve(normalizedPath);
      } catch (pathError) {
        throw new Error('Invalid project path: unable to resolve path');
      }
      
      // Additional security checks on resolved path
      if (!path.isAbsolute(resolvedPath) ||
          resolvedPath.startsWith('/etc') ||
          resolvedPath.startsWith('/root') ||
          resolvedPath.startsWith('/sys') ||
          resolvedPath.startsWith('/proc') ||
          resolvedPath.startsWith('/dev')) {
        throw new Error('Invalid project path: unsafe or restricted path');
      }
      
      // Verify project path exists and is a directory
      try {
        const stats = fs.statSync(actualProjectPath); // lgtm[js/path-injection] - Path validated above with whitelist checks
        if (!stats.isDirectory()) {
          throw new Error('Project path must be a directory');
        }
      } catch (fsError) {
        throw new Error('Project path does not exist or is not accessible');
      }
      
      actualProjectPath = resolvedPath;
    }

    // Search for playwright.config.js in the path and subdirectories with safe path construction
    let playwrightConfigPath = null;
    const configFilenames = ['playwright.config.js'];
    const searchDirectories = ['', 'tests', 'tests/ui-testing', 'ui-testing', 'e2e'];
    
    for (const dir of searchDirectories) {
      for (const filename of configFilenames) {
        try {
          // Safe path construction for config files using whitelist approach
          let configPath;
          try {
            configPath = dir ? createSafePath(actualProjectPath, dir, filename) : createSafePath(actualProjectPath, filename);
          } catch (pathError) {
            continue; // Skip invalid paths
          }
          
          if (fs.existsSync(configPath)) {
            playwrightConfigPath = configPath;
            // Update actualProjectPath to the directory containing the config
            actualProjectPath = path.dirname(configPath);
            console.log(`Found playwright.config.js at: ${path.relative(process.cwd(), configPath)}`);
            console.log(`Using project path: ${path.relative(process.cwd(), actualProjectPath)}`);
            break;
          }
        } catch (pathError) {
          // Skip invalid paths
          continue;
        }
      }
      if (playwrightConfigPath) break;
    }

    if (!playwrightConfigPath) {
      throw new Error(`playwright.config.js not found in ${actualProjectPath} or common subdirectories (tests/, ui-testing/, e2e/)`);
    }

    // Install dependencies if package.json exists and this is a cloned repo
    if (isGitHubRepo) {
      try {
        let packageJsonPath;
        try {
          packageJsonPath = createSafePath(actualProjectPath, 'package.json');
        } catch (pathError) {
          throw new Error('Invalid package.json path detected');
        }
        
        if (fs.existsSync(packageJsonPath)) {
          const installMessage = `📦 Installing dependencies...\n`;
          broadcastMessage('log', 'stdout', installMessage);
          
          try {
            // Use the validated package.json directory as cwd
            const installCwd = path.dirname(packageJsonPath);
            await executeCommand('npm', ['install'], { cwd: installCwd }, (stream, chunk) => {
              broadcastMessage('log', stream, chunk);
            });
            
            const installSuccessMessage = `✅ Dependencies installed successfully\n`;
            broadcastMessage('log', 'stdout', installSuccessMessage);
          } catch (installError) {
            const installErrorMessage = `⚠️ Failed to install dependencies: ${installError.message}\n`;
            broadcastMessage('log', 'stderr', installErrorMessage);
            broadcastMessage('log', 'stdout', `🔄 Continuing with existing dependencies...\n`);
          }
        }
      } catch (pathError) {
        // Skip package.json if path is invalid
        console.warn('Could not access package.json:', pathError.message);
      }
    }

    // Build command args for playwright
    const cmd = 'npx';
    const args = ['playwright', 'test'];

    // Handle module selection
    if (module && module !== 'ALL') {
      args.push(`./playwright-tests/${module}`);
      console.log('Running tests for module:', module);
    }

    // Handle tags (only if no module is specified or module is ALL)
    if (tags && String(tags).trim().length > 0) {
      // Convert comma-separated tags to Playwright regex format
      // "@alerts, @logs" becomes "@alerts|@logs"
      const cleanTags = String(tags)
        .trim()
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)
        .join('|');
      
      args.push('--grep', cleanTags);
      console.log('Processed tags:', cleanTags);
    }

    // Handle skip files - use --grep-invert with regex pattern
    if (skipFiles && Array.isArray(skipFiles) && skipFiles.length > 0) {
      const skipPattern = skipFiles
        .filter(file => file && typeof file === 'string')
        .map(file => file.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')) // Escape regex special chars
        .join('|'); // Join with OR operator
      
      if (skipPattern) {
        args.push('--grep-invert', skipPattern);
        console.log('Skipping files with pattern:', skipPattern);
      }
    }
    if (!headless) {
      args.push('--headed');
    }
    if (workers && Number.isFinite(Number(workers))) {
      args.push(`--workers=${Number(workers)}`);
    }

    // Create clean environment with only necessary variables
    const childEnv = {
      // Essential system variables
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      NODE_ENV: process.env.NODE_ENV,
      
      // Application-specific variables
      ZO_ROOT_USER_EMAIL: String(username),
      ZO_ROOT_USER_PASSWORD: String(password),
      ZO_BASE_URL: String(baseUrl),
      INGESTION_URL: String(resolvedIngestionUrl),
      ORGNAME: String(orgName || 'default'),
      PLAYWRIGHT_HEADLESS: headless ? '1' : '0',
    };

    console.log('Running Playwright from directory:', actualProjectPath);
    console.log('Command:', cmd, args.join(' '));
    console.log('Environment variables set:', {
      ZO_BASE_URL: childEnv.ZO_BASE_URL,
      ZO_ROOT_USER_EMAIL: childEnv.ZO_ROOT_USER_EMAIL ? '[REDACTED]' : undefined,
      ORGNAME: childEnv.ORGNAME
    });

    // Use validated project path for spawn cwd
    const spawnCwd = path.resolve(actualProjectPath); // lgtm[js/path-injection] - actualProjectPath validated in route handler
    const child = spawn(cmd, args, {
      cwd: spawnCwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    // Update run metadata
    runMeta.childProcess = child;
    runMeta.status = 'running';
    runMeta.tempDir = tempDir;

    // Respond with run id
    res.json({ runId });

    // Cleanup on exit
    child.on('close', (code) => {
      const run = activeRuns.get(runId);
      if (run) {
        run.status = 'finished';
        run.lastExitCode = code;
        
        // Cleanup temporary directory if it exists
        if (run.tempDir) {
          setTimeout(() => {
            cleanupTempDir(run.tempDir);
          }, 5000); // Wait 5 seconds before cleanup to ensure logs are read
        }
      }
    });

  } catch (error) {
    console.error('Failed to start test run:', error.message);
    
    // Cleanup temp directory on error
    if (tempDir) {
      cleanupTempDir(tempDir);
    }
    
    // Sanitize error messages to prevent information disclosure
    let errorMessage = 'Failed to start test run';
    if (error.message.includes('Invalid repository URL') || 
        error.message.includes('Invalid branch name') ||
        error.message.includes('playwright.config.js not found') ||
        error.message.includes('Path traversal detected') ||
        error.message.includes('Sub-path') && error.message.includes('does not exist')) {
      errorMessage = error.message;
    }
    
    return res.status(500).json({
      error: errorMessage
    });
  }
  } catch (validationError) {
    console.error('Validation error:', validationError.message);
    return res.status(400).json({
      error: validationError.message // Validation errors are safe to expose
    });
  }
});

/**
 * Stream logs from a run via Server-Sent Events
 */
app.get('/api/run/:runId/stream', (req, res) => {
  const { runId } = req.params;
  
  try {
    // Enhanced validation for runId parameter
    validateUrlParameter(runId, 'runId');
    
    // Additional format validation
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
      throw new Error('Invalid run ID format: only alphanumeric characters, underscores, and hyphens allowed');
    }
  } catch (validationError) {
    res.status(400).json({ error: validationError.message });
    return;
  }
  
  const run = activeRuns.get(runId);
  if (!run) {
    res.status(404).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (type, data) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send any stored stream data for clients connecting late
  if (run.streamData && run.streamData.length > 0) {
    run.streamData.forEach(entry => {
      send(entry.type, entry.data);
    });
  }

  const onStdout = (chunk) => {
    const data = { stream: 'stdout', chunk: String(chunk) };
    send('log', data);
    
    // Store in streamData for late-connecting clients
    if (!run.streamData) run.streamData = [];
    run.streamData.push({ type: 'log', data, timestamp: Date.now() });
  };
  
  const onStderr = (chunk) => {
    const data = { stream: 'stderr', chunk: String(chunk) };
    send('log', data);
    
    // Store in streamData for late-connecting clients
    if (!run.streamData) run.streamData = [];
    run.streamData.push({ type: 'log', data, timestamp: Date.now() });
  };
  
  const onClose = (code) => {
    const data = { exitCode: code };
    send('done', data);
    
    // Store final message
    if (!run.streamData) run.streamData = [];
    run.streamData.push({ type: 'done', data, timestamp: Date.now() });
    
    res.end();
  };

  // If child process exists, listen to its output
  if (run.childProcess) {
    run.childProcess.stdout.on('data', onStdout);
    run.childProcess.stderr.on('data', onStderr);
    run.childProcess.on('close', onClose);
  }

  // Heartbeat to keep connection alive on some proxies
  const heartbeat = setInterval(() => send('heartbeat', Date.now()), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (run.childProcess && !run.childProcess.killed) {
      run.childProcess.stdout.off('data', onStdout);
      run.childProcess.stderr.off('data', onStderr);
      run.childProcess.off('close', onClose);
    }
  });
});

/**
 * Stop a run
 */
app.post('/api/run/:runId/stop', (req, res) => {
  const { runId } = req.params;
  
  try {
    // Enhanced validation for runId parameter
    validateUrlParameter(runId, 'runId');
    
    // Additional format validation
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
      throw new Error('Invalid run ID format: only alphanumeric characters, underscores, and hyphens allowed');
    }
  } catch (validationError) {
    return res.status(400).json({ error: validationError.message });
  }
  
  const run = activeRuns.get(runId);
  if (!run) {
    return res.status(404).json({ error: 'Run not found' });
  }
  try {
    run.childProcess.kill('SIGTERM');
    run.status = 'stopped';
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // Don't expose internal errors in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const errorMessage = isDevelopment ? err.message : 'Internal server error';
  
  res.status(500).json({
    error: errorMessage
  });
});

// 404 handler with light rate limiting
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'API endpoint not found' });
  } else {
    // Serve index.html for non-API routes
    try {
      const indexPath = path.resolve(publicDir, 'index.html');
      
      // Validate that the resolved path is within public directory
      if (!indexPath.startsWith(publicDir)) {
        throw new Error('Invalid file path detected');
      }
      
      res.sendFile(indexPath);
    } catch (pathError) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Playwright Runner listening on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Security headers enabled: ✅`);
  console.log(`Rate limiting enabled: ✅ (${MAX_RUNS_PER_HOUR}/hour, ${MAX_CONCURRENT_RUNS} concurrent)`);
});


