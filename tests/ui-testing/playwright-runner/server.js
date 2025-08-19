const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

/**
 * In-memory run registry
 * runId -> { childProcess, createdAt, status, lastExitCode }
 */
const activeRuns = new Map();

/**
 * Helper function to execute shell commands
 */
function executeCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { 
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true 
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
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
async function cloneRepository(repoUrl, branch = 'main', subPath = '') {
  const tempDir = path.join(os.tmpdir(), `playwright-repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  
  try {
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Clone repository
    const cloneArgs = ['clone'];
    if (branch && branch !== 'main' && branch !== 'master') {
      cloneArgs.push('-b', branch);
    }
    cloneArgs.push(repoUrl, tempDir);
    
    console.log('Cloning repository:', repoUrl, 'to', tempDir);
    await executeCommand('git', cloneArgs);
    
    // Determine the actual project path
    let projectPath = tempDir;
    if (subPath) {
      projectPath = path.join(tempDir, subPath);
      if (!fs.existsSync(projectPath)) {
        console.log(`Sub-path '${subPath}' does not exist. Available directories:`, 
          fs.readdirSync(tempDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name));
        throw new Error(`Sub-path '${subPath}' does not exist in the repository`);
      }
    }
    
    console.log('Repository cloned successfully to:', projectPath);
    return { tempDir, projectPath };
  } catch (error) {
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
    const credentialsPath = path.join(__dirname, 'credentials.json');
    const credentials = require(credentialsPath);
    res.json(credentials);
  } catch (err) {
    console.error('Failed to load credentials:', err);
    res.status(500).json({ error: 'Failed to load credentials' });
  }
});

app.get('/api/modules', (req, res) => {
  try {
    const testsPath = path.join(__dirname, '..', 'playwright-tests');
    
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
    const testsPath = path.join(__dirname, '..', 'playwright-tests');
    
    if (!fs.existsSync(testsPath)) {
      return res.status(404).json({ error: 'Tests directory not found' });
    }

    function getAllSpecFiles(dir, basePath = '') {
      const files = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(basePath, entry.name);
        
        if (entry.isDirectory()) {
          files.push(...getAllSpecFiles(fullPath, relativePath));
        } else if (entry.name.endsWith('.spec.js')) {
          files.push({
            name: entry.name,
            path: relativePath,
            module: basePath || 'root'
          });
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
app.post('/api/run', async (req, res) => {
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

  try {
    // Handle GitHub repository cloning
    if (isGitHubRepo) {
      console.log(`Cloning GitHub repository: ${repoUrl}`);
      const cloneResult = await cloneRepository(repoUrl, repoBranch, repoSubPath);
      actualProjectPath = cloneResult.projectPath;
      tempDir = cloneResult.tempDir;
      console.log(`Using cloned repository at: ${actualProjectPath}`);
    }

    // Verify project path exists
    if (!fs.existsSync(actualProjectPath)) {
      throw new Error(`Project path does not exist: ${actualProjectPath}`);
    }

    // Search for playwright.config.js in the path and subdirectories
    let playwrightConfigPath = null;
    const possibleConfigLocations = [
      path.join(actualProjectPath, 'playwright.config.js'),
      path.join(actualProjectPath, 'tests', 'playwright.config.js'),
      path.join(actualProjectPath, 'tests', 'ui-testing', 'playwright.config.js'),
      path.join(actualProjectPath, 'ui-testing', 'playwright.config.js'),
      path.join(actualProjectPath, 'e2e', 'playwright.config.js')
    ];

    for (const configPath of possibleConfigLocations) {
      if (fs.existsSync(configPath)) {
        playwrightConfigPath = configPath;
        // Update actualProjectPath to the directory containing the config
        actualProjectPath = path.dirname(configPath);
        console.log(`Found playwright.config.js at: ${configPath}`);
        console.log(`Using project path: ${actualProjectPath}`);
        break;
      }
    }

    if (!playwrightConfigPath) {
      throw new Error(`playwright.config.js not found in ${actualProjectPath} or common subdirectories (tests/, ui-testing/, e2e/)`);
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

    const childEnv = {
      ...process.env,
      ZO_ROOT_USER_EMAIL: String(username),
      ZO_ROOT_USER_PASSWORD: String(password),
      ZO_BASE_URL: String(baseUrl),
      INGESTION_URL: String(resolvedIngestionUrl),
      ORGNAME: String(orgName || 'default'),
      // Respect headless via environment too for frameworks that read it
      PLAYWRIGHT_HEADLESS: headless ? '1' : '0',
    };

    console.log('Running Playwright from directory:', actualProjectPath);
    console.log('Command:', cmd, args.join(' '));
    console.log('Environment variables set:', {
      ZO_BASE_URL: childEnv.ZO_BASE_URL,
      ZO_ROOT_USER_EMAIL: childEnv.ZO_ROOT_USER_EMAIL,
      ORGNAME: childEnv.ORGNAME
    });

    const child = spawn(cmd, args, {
      cwd: actualProjectPath,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    const runMeta = {
      childProcess: child,
      createdAt: Date.now(),
      status: 'running',
      lastExitCode: null,
      tempDir: tempDir, // Store temp dir for cleanup
    };
    activeRuns.set(runId, runMeta);

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
    
    return res.status(500).json({
      error: error.message || 'Failed to start test run'
    });
  }
});

/**
 * Stream logs from a run via Server-Sent Events
 */
app.get('/api/run/:runId/stream', (req, res) => {
  const { runId } = req.params;
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

  const onStdout = (chunk) => send('log', { stream: 'stdout', chunk: String(chunk) });
  const onStderr = (chunk) => send('log', { stream: 'stderr', chunk: String(chunk) });
  const onClose = (code) => {
    send('done', { exitCode: code });
    res.end();
  };

  run.childProcess.stdout.on('data', onStdout);
  run.childProcess.stderr.on('data', onStderr);
  run.childProcess.on('close', onClose);

  // Heartbeat to keep connection alive on some proxies
  const heartbeat = setInterval(() => send('heartbeat', Date.now()), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (!run.childProcess.killed) {
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

// Fallback to index.html for any non-API route (Express 5 compatible)
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Playwright Runner listening on http://localhost:${PORT}`);
});


