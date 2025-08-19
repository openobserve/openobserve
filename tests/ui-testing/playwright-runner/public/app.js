document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, initializing app...');
  const environmentSelect = document.getElementById('environment');
  
  if (!environmentSelect) {
    console.error('Environment select element not found!');
    return;
  }
  
  console.log('Environment select element found:', environmentSelect);
  const baseUrlInput = document.getElementById('baseUrl');
  const ingestionUrlInput = document.getElementById('ingestionUrl');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const orgNameInput = document.getElementById('orgName');
  const tagsInput = document.getElementById('tags');
  const workersInput = document.getElementById('workers');
  const headlessCheckbox = document.getElementById('headless');
  const projectPathInput = document.getElementById('projectPath');
  const runBtn = document.getElementById('runBtn');
  const stopBtn = document.getElementById('stopBtn');
  const logsEl = document.getElementById('logs');
  const statusEl = document.getElementById('status');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const copyLogsBtn = document.getElementById('copyLogsBtn');
  
  // Test counter elements
  const testCounter = document.getElementById('testCounter');
  const totalCount = document.getElementById('totalCount');
  const passedCount = document.getElementById('passedCount');
  const failedCount = document.getElementById('failedCount');
  const runningTest = document.getElementById('runningTest');

  // Tag autocomplete elements
  const tagSuggestions = document.getElementById('tagSuggestions');
  
  // Module selection elements
  const selectionTags = document.getElementById('selectionTags');
  const selectionModule = document.getElementById('selectionModule');
  const tagsSection = document.getElementById('tagsSection');
  const moduleSection = document.getElementById('moduleSection');
  const moduleInput = document.getElementById('module');
  const moduleSuggestions = document.getElementById('moduleSuggestions');
  
  // Skip files elements
  const skipFilesInput = document.getElementById('skipFiles');
  const skipSuggestions = document.getElementById('skipSuggestions');
  
  // Project source elements
  const sourceLocal = document.getElementById('sourceLocal');
  const sourceGithub = document.getElementById('sourceGithub');
  const localPathSection = document.getElementById('localPathSection');
  const githubRepoSection = document.getElementById('githubRepoSection');
  const repoUrlInput = document.getElementById('repoUrl');
  const repoBranchInput = document.getElementById('repoBranch');
  const repoSubPathInput = document.getElementById('repoSubPath');

  // Available tags with categories
  const availableTags = [
    { tag: '@all', category: 'main', description: 'Run all tests' },
    { tag: '@alerts', category: 'main', description: 'All alert tests' },
    { tag: '@logs', category: 'main', description: 'All log tests' },
    { tag: '@streams', category: 'main', description: 'All stream tests' },
    
    { tag: '@alertsImportExport', category: 'alerts', description: 'Import/Export alerts' },
    { tag: '@templateImport', category: 'alerts', description: 'Template imports' },
    { tag: '@destinationImport', category: 'alerts', description: 'Destination imports' },
    { tag: '@alertTemplate', category: 'alerts', description: 'Alert templates' },
    { tag: '@alertDestination', category: 'alerts', description: 'Alert destinations' },
    { tag: '@e2eAlerts', category: 'alerts', description: 'End-to-end alerts' },
    { tag: '@scheduledAlerts', category: 'alerts', description: 'Scheduled alerts' },
    { tag: '@alertsUIValidations', category: 'alerts', description: 'Alert validations' },
    { tag: '@deleteTemplate', category: 'alerts', description: 'Template deletion' },
    
    { tag: '@quickModeLogs', category: 'logs', description: 'Quick mode logs' },
    { tag: '@sqlQueryLogs', category: 'logs', description: 'SQL query logs' },
    { tag: '@vrlQueryLogs', category: 'logs', description: 'VRL query logs' },
    { tag: '@cteLogs', category: 'logs', description: 'CTE logs' },
    { tag: '@matchAllLogs', category: 'logs', description: 'Match all logs' },
    { tag: '@histogram', category: 'visual', description: 'Histogram tests' },
    { tag: '@interestingFields', category: 'logs', description: 'Interesting fields' },
    { tag: '@savedViewsValidation', category: 'logs', description: 'Saved views' },
    { tag: '@liveMode', category: 'logs', description: 'Live mode' },
    { tag: '@streamExplorer', category: 'logs', description: 'Stream explorer' },
    { tag: '@functionValidation', category: 'logs', description: 'Function validation' },
    
    { tag: '@sqlMode', category: 'technical', description: 'SQL mode tests' },
    { tag: '@joins', category: 'technical', description: 'SQL joins' },
    { tag: '@streaming', category: 'streams', description: 'Streaming tests' },
    { tag: '@streamName', category: 'streams', description: 'Stream naming' },
    { tag: '@casing', category: 'technical', description: 'Case sensitivity' },
    
    { tag: '@paginationLimit', category: 'technical', description: 'Pagination' },
    { tag: '@searchAroundSQL', category: 'technical', description: 'Search around SQL' },
    { tag: '@functionCRUD', category: 'technical', description: 'Function CRUD' },
    { tag: '@timestampViewLogs', category: 'logs', description: 'Timestamp views' },
    { tag: '@resetFilters', category: 'logs', description: 'Reset filters' },
    { tag: '@invalidQueryLogs', category: 'logs', description: 'Invalid queries' }
  ];

  let selectedSuggestionIndex = -1;

  const DEFAULT_PROJECT_PATH = '/Users/shrinathrao/Documents/Work Files/Project/myProject-openobserve/tests/ui-testing';
  projectPathInput.value = DEFAULT_PROJECT_PATH;

  let credentialsData = {};
  let availableModules = [];
  let availableSpecFiles = [];
  let selectedModule = '';
  let selectedSkipFiles = [];

  // Load credentials
  fetch('/api/credentials')
    .then((r) => r.json())
    .then((credentials) => {
      credentialsData = credentials;
    })
    .catch((err) => {
      console.warn('Failed to load credentials:', err);
    });

  fetch('/api/environments')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((envs) => {
      console.log('Loading environments:', envs);
      // Clear any existing options
      environmentSelect.innerHTML = '<option value="">Select environment...</option>';
      
      // Populate dropdown
      envs.forEach((e) => {
        const opt = document.createElement('option');
        opt.value = e.key;
        opt.textContent = `${e.key} (${e.url})`;
        opt.dataset.url = e.url;
        environmentSelect.appendChild(opt);
      });
      
      // Default selection
      if (envs.length) {
        environmentSelect.value = envs[0].key;
        baseUrlInput.value = envs[0].url;
        // Auto-fill credentials for default selection
        updateCredentials(envs[0].key);
      }
    })
    .catch((err) => {
      console.error('Failed to load environments:', err);
      environmentSelect.innerHTML = '<option value="">Error loading environments</option>';
    });

  // Load modules
  fetch('/api/modules')
    .then((r) => r.json())
    .then((modules) => {
      availableModules = modules;
      console.log('Loaded modules:', availableModules);
      updateModulesHelper();
    })
    .catch((err) => {
      console.warn('Failed to load modules:', err);
    });

  // Load spec files
  fetch('/api/spec-files')
    .then((r) => r.json())
    .then((specFiles) => {
      availableSpecFiles = specFiles;
      console.log('Loaded spec files:', availableSpecFiles);
      updateModulesHelper();
    })
    .catch((err) => {
      console.warn('Failed to load spec files:', err);
    });

  environmentSelect.addEventListener('change', () => {
    const selected = environmentSelect.options[environmentSelect.selectedIndex];
    const url = selected?.dataset?.url || '';
    const envKey = selected?.value || '';
    
    baseUrlInput.value = url;
    // Do not override ingestion URL automatically if user already typed one
    if (!ingestionUrlInput.value) {
      ingestionUrlInput.value = '';
    }

    // Auto-fill credentials based on selected environment
    updateCredentials(envKey);
  });

  let currentRunId = null;
  let eventSource = null;
  
  // Test counter state
  let testStats = {
    total: 0,
    passed: 0,
    failed: 0,
    currentTest: 'None'
  };

  function updateCredentials(envKey) {
    // Always clear fields first
    usernameInput.value = '';
    passwordInput.value = '';
    orgNameInput.value = 'default'; // Reset to default org name
    
    // Then populate if credentials exist for this environment
    if (credentialsData.environments && credentialsData.environments[envKey]) {
      const creds = credentialsData.environments[envKey];
      if (creds.username) usernameInput.value = creds.username;
      if (creds.password) passwordInput.value = creds.password;
      if (creds.orgName) orgNameInput.value = creds.orgName;
    }
  }

  // Update modules helper section with dynamic data
  function updateModulesHelper() {
    if (!availableModules.length || !availableSpecFiles.length) return;
    
    const moduleTreeContainer = document.querySelector('.module-tree');
    if (!moduleTreeContainer) return;
    
    // Group files by module
    const filesByModule = {};
    availableSpecFiles.forEach(file => {
      if (!filesByModule[file.module]) {
        filesByModule[file.module] = [];
      }
      filesByModule[file.module].push(file.name);
    });
    
    // Build the tree structure
    let treeHTML = '';
    
    // Add ALL option first
    const totalFiles = availableSpecFiles.length;
    treeHTML += `
      <div class="module-folder">
        ALL <span class="module-count">(${totalFiles} files)</span>
      </div>
    `;
    
    // Add each module with its files
    availableModules.forEach(module => {
      if (module.name === 'ALL') return; // Skip ALL as we already added it
      
      const files = filesByModule[module.name] || [];
      if (files.length === 0) return;
      
      treeHTML += `
        <div class="module-folder">
          ${module.name} <span class="module-count">(${files.length} files)</span>
        </div>
        <div class="module-files">
      `;
      
      files.forEach((file, index) => {
        const isLast = index === files.length - 1;
        treeHTML += `<div class="module-file ${isLast ? 'last-file' : ''}">${file}</div>`;
      });
      
      treeHTML += '</div>';
    });
    
    moduleTreeContainer.innerHTML = treeHTML;
  }

  // Toggle between tags and module selection
  function toggleSelectionMethod() {
    if (selectionTags.checked) {
      tagsSection.style.display = 'block';
      moduleSection.style.display = 'none';
      selectedModule = '';
      moduleInput.value = '';
    } else {
      tagsSection.style.display = 'none';
      moduleSection.style.display = 'block';
      tagsInput.value = '';
    }
  }

  // Toggle between local and GitHub project sources
  function toggleProjectSource() {
    if (sourceLocal.checked) {
      localPathSection.style.display = 'block';
      githubRepoSection.style.display = 'none';
      repoUrlInput.value = '';
      repoBranchInput.value = '';
      repoSubPathInput.value = '';
    } else {
      localPathSection.style.display = 'none';
      githubRepoSection.style.display = 'block';
      projectPathInput.value = '';
    }
  }

  // Module autocomplete functionality
  function filterModules(input) {
    if (!input.trim()) return availableModules;
    
    const inputLower = input.toLowerCase().trim();
    return availableModules.filter(module => 
      module.name.toLowerCase().includes(inputLower)
    ).slice(0, 8);
  }

  function showModuleSuggestions(suggestions) {
    if (suggestions.length === 0) {
      moduleSuggestions.style.display = 'none';
      return;
    }

    moduleSuggestions.innerHTML = suggestions.map((module, index) => `
      <div class="tag-suggestion ${index === selectedSuggestionIndex ? 'selected' : ''}" data-module="${module.name}">
        <div>
          <strong>${module.name}</strong>
          <div style="font-size: 12px; color: var(--text-secondary);">${module.description}</div>
        </div>
      </div>
    `).join('');
    
    moduleSuggestions.style.display = 'block';
    selectedSuggestionIndex = -1;

    // Add click handlers
    moduleSuggestions.querySelectorAll('.tag-suggestion').forEach((suggestion, index) => {
      suggestion.addEventListener('click', () => selectModule(suggestion.dataset.module));
    });
  }

  function selectModule(moduleName) {
    selectedModule = moduleName;
    moduleInput.value = moduleName;
    moduleSuggestions.style.display = 'none';
    moduleInput.blur();
  }

  // Skip files autocomplete functionality
  function filterSpecFiles(input) {
    if (!input.trim()) return availableSpecFiles;
    
    const inputLower = input.toLowerCase().trim();
    const currentFiles = input.split(',').map(f => f.trim());
    const lastFile = currentFiles[currentFiles.length - 1].toLowerCase();
    
    return availableSpecFiles
      .filter(file => 
        file.name.toLowerCase().includes(lastFile) && 
        !currentFiles.slice(0, -1).some(existing => existing.toLowerCase() === file.name.toLowerCase())
      )
      .slice(0, 8);
  }

  function showSkipSuggestions(suggestions) {
    if (suggestions.length === 0) {
      skipSuggestions.style.display = 'none';
      return;
    }

    skipSuggestions.innerHTML = suggestions.map((file, index) => `
      <div class="tag-suggestion ${index === selectedSuggestionIndex ? 'selected' : ''}" data-file="${file.name}">
        <div>
          <strong>${file.name}</strong>
          <div style="font-size: 12px; color: var(--text-secondary);">${file.module} module</div>
        </div>
      </div>
    `).join('');
    
    skipSuggestions.style.display = 'block';
    selectedSuggestionIndex = -1;

    // Add click handlers
    skipSuggestions.querySelectorAll('.tag-suggestion').forEach((suggestion, index) => {
      suggestion.addEventListener('click', () => selectSkipFile(suggestion.dataset.file));
    });
  }

  function selectSkipFile(fileName) {
    const currentValue = skipFilesInput.value;
    const files = currentValue.split(',').map(f => f.trim());
    files[files.length - 1] = fileName;
    skipFilesInput.value = files.join(', ') + ', ';
    skipSuggestions.style.display = 'none';
    skipFilesInput.focus();
  }

  function resetTestCounter() {
    testStats = { total: 0, passed: 0, failed: 0, currentTest: 'None' };
    updateTestCounterDisplay();
  }

  function updateTestCounterDisplay() {
    totalCount.textContent = testStats.total;
    passedCount.textContent = testStats.passed;
    failedCount.textContent = testStats.failed;
    runningTest.textContent = testStats.currentTest;
  }

  function parseTestProgress(logLine) {
    // Parse Playwright test output patterns
    if (logLine.includes('✘') || logLine.includes('failed')) {
      testStats.failed++;
      testStats.total = testStats.passed + testStats.failed;
      updateTestCounterDisplay();
      return 'failed';
    } else if (logLine.includes('✓') || logLine.includes('passed')) {
      testStats.passed++;
      testStats.total = testStats.passed + testStats.failed;
      updateTestCounterDisplay();
      return 'passed';
    } else if (logLine.includes('Running') && logLine.includes('test using')) {
      // Extract running test info
      const match = logLine.match(/Running (\d+) test/);
      if (match) {
        resetTestCounter();
        testCounter.style.display = 'flex';
      }
      return 'info';
    } else if (logLine.includes('[chromium] › ')) {
      // Extract current test name
      const testMatch = logLine.match(/\[chromium\] › (.+?)(?:\s|$)/);
      if (testMatch) {
        testStats.currentTest = testMatch[1].substring(0, 50) + (testMatch[1].length > 50 ? '...' : '');
        updateTestCounterDisplay();
      }
      return 'running';
    }
    return 'info';
  }

  // Tag autocomplete functionality
  function filterTags(input) {
    if (!input.trim()) return [];
    
    const inputLower = input.toLowerCase().trim();
    const currentTags = input.split(',').map(t => t.trim());
    const lastTag = currentTags[currentTags.length - 1].toLowerCase();
    
    return availableTags
      .filter(tagInfo => 
        tagInfo.tag.toLowerCase().includes(lastTag) && 
        !currentTags.slice(0, -1).some(existing => existing.toLowerCase() === tagInfo.tag.toLowerCase())
      )
      .slice(0, 8); // Limit to 8 suggestions
  }

  function showTagSuggestions(suggestions) {
    if (suggestions.length === 0) {
      tagSuggestions.style.display = 'none';
      return;
    }

    tagSuggestions.innerHTML = suggestions.map((tagInfo, index) => `
      <div class="tag-suggestion ${index === selectedSuggestionIndex ? 'selected' : ''}" data-tag="${tagInfo.tag}">
        <div>
          <strong>${tagInfo.tag}</strong>
          <div style="font-size: 12px; color: var(--text-secondary);">${tagInfo.description}</div>
        </div>
        <span class="tag-category">${tagInfo.category}</span>
      </div>
    `).join('');
    
    tagSuggestions.style.display = 'block';
    selectedSuggestionIndex = -1;

    // Add click handlers
    tagSuggestions.querySelectorAll('.tag-suggestion').forEach((suggestion, index) => {
      suggestion.addEventListener('click', () => selectTag(suggestion.dataset.tag));
    });
  }

  function selectTag(selectedTag) {
    const currentValue = tagsInput.value;
    const tags = currentValue.split(',').map(t => t.trim());
    tags[tags.length - 1] = selectedTag;
    tagsInput.value = tags.join(', ') + ', ';
    tagSuggestions.style.display = 'none';
    tagsInput.focus();
  }

  function highlightSuggestion(direction) {
    const suggestions = tagSuggestions.querySelectorAll('.tag-suggestion');
    if (suggestions.length === 0) return;

    // Remove current highlight
    suggestions.forEach(s => s.classList.remove('selected'));

    // Update index
    if (direction === 'down') {
      selectedSuggestionIndex = (selectedSuggestionIndex + 1) % suggestions.length;
    } else {
      selectedSuggestionIndex = selectedSuggestionIndex <= 0 ? suggestions.length - 1 : selectedSuggestionIndex - 1;
    }

    // Highlight new selection
    suggestions[selectedSuggestionIndex].classList.add('selected');
  }

  function setRunningUi(running) {
    runBtn.disabled = running;
    stopBtn.disabled = !running;
    environmentSelect.disabled = running;
    
    if (running) {
      setStatus('running', 'Running...');
      resetTestCounter();
    } else {
      setStatus('idle', 'Idle');
      if (testStats.total > 0) {
        testStats.currentTest = `Finished: ${testStats.passed}✅ ${testStats.failed}❌`;
        updateTestCounterDisplay();
      }
    }
  }

  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusEl.querySelector('.muted').textContent = text;
  }

  function appendLog(text) {
    // Use the new colored log function
    appendColoredLog(text);
  }

  function appendColoredLog(message) {
    const logType = parseTestProgress(message);
    const span = document.createElement('span');
    
    // Add color classes based on content
    if (logType === 'failed' || message.includes('Error:') || message.includes('timeout')) {
      span.className = 'log-line-failed';
    } else if (logType === 'passed' || message.includes('✓') || message.includes('Successfully')) {
      span.className = 'log-line-passed';
    } else if (logType === 'running' || message.includes('[chromium] ›')) {
      span.className = 'log-line-running';
    } else if (message.includes('Warning:')) {
      span.className = 'log-line-warning';
    }
    
    span.textContent = message;
    logsEl.appendChild(span);
    logsEl.scrollTop = logsEl.scrollHeight;
  }

  function startStream(runId) {
    console.log('Creating EventSource for runId:', runId);
    eventSource = new EventSource(`/api/run/${runId}/stream`);
    
    eventSource.onopen = function(event) {
      console.log('EventSource opened successfully');
    };
    
    eventSource.onerror = function(event) {
      console.error('EventSource error:', event);
      if (eventSource.readyState === EventSource.CLOSED) {
        console.log('EventSource connection was closed');
      }
    };
    
    eventSource.addEventListener('log', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        console.log('Received log:', data);
        appendLog(data.chunk);
      } catch (e) {
        console.error('Failed to parse log data:', e, ev.data);
      }
    });
    
    eventSource.addEventListener('done', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        console.log('Test run completed with exit code:', data.exitCode);
        setStatus('done', `Finished with exit code ${data.exitCode}`);
      } catch (e) {
        console.log('Test run completed (no exit code data)');
        setStatus('done', 'Finished');
      }
      setRunningUi(false);
      currentRunId = null;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    });
    
    eventSource.addEventListener('heartbeat', (ev) => {
      console.log('Received heartbeat:', ev.data);
    });
  }

  runBtn.addEventListener('click', async () => {
    console.log('Run button clicked');
    logsEl.textContent = '';
    setStatus('starting', 'Starting...');

    // Prepare skip files array
    const skipFilesValue = skipFilesInput.value.trim();
    const skipFilesArray = skipFilesValue ? 
      skipFilesValue.split(',').map(f => f.trim()).filter(f => f.length > 0) : 
      [];

    const isGitHubRepo = sourceGithub.checked;
    const payload = {
      // Project source fields
      isGitHubRepo: isGitHubRepo,
      projectPath: !isGitHubRepo ? (projectPathInput.value || DEFAULT_PROJECT_PATH) : undefined,
      repoUrl: isGitHubRepo ? repoUrlInput.value.trim() : undefined,
      repoBranch: isGitHubRepo ? (repoBranchInput.value.trim() || 'main') : undefined,
      repoSubPath: isGitHubRepo ? repoSubPathInput.value.trim() : undefined,
      
      // Test configuration
      baseUrl: baseUrlInput.value.trim(),
      ingestionUrl: ingestionUrlInput.value.trim() || undefined,
      username: usernameInput.value.trim(),
      password: passwordInput.value,
      orgName: orgNameInput.value.trim() || 'default',
      tags: selectionTags.checked ? (tagsInput.value.trim() || undefined) : undefined,
      module: selectionModule.checked ? selectedModule : undefined,
      skipFiles: skipFilesArray.length > 0 ? skipFilesArray : undefined,
      headless: !!headlessCheckbox.checked,
      workers: workersInput.value ? Number(workersInput.value) : undefined,
    };

    console.log('Payload:', payload);

    if (!payload.baseUrl || !payload.username || !payload.password) {
      console.error('Missing required fields:', { baseUrl: payload.baseUrl, username: payload.username, password: !!payload.password });
      setStatus('error', 'Please fill Base URL, Username and Password');
      return;
    }

    if (isGitHubRepo && !payload.repoUrl) {
      setStatus('error', 'Please provide GitHub repository URL');
      return;
    }

    if (!isGitHubRepo && !payload.projectPath) {
      setStatus('error', 'Please provide local project path');
      return;
    }

    setRunningUi(true);
    try {
      console.log('Sending request to /api/run');
      const resp = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      console.log('Response status:', resp.status);
      
      if (!resp.ok) {
        const tx = await resp.text();
        console.error('Response error:', tx);
        throw new Error(tx || 'Run failed to start');
      }
      
      const data = await resp.json();
      console.log('Response data:', data);
      
      currentRunId = data.runId;
      setStatus('running', `Running (id ${currentRunId})...`);
      console.log('Starting stream for runId:', currentRunId);
      startStream(currentRunId);
    } catch (err) {
      console.error('Run error:', err);
      setRunningUi(false);
      setStatus('error', `Error: ${err.message || err}`);
    }
  });

  stopBtn.addEventListener('click', async () => {
    if (!currentRunId) return;
    setStatus('stopping', 'Stopping...');
    
    try {
      const response = await fetch(`/api/run/${currentRunId}/stop`, { method: 'POST' });
      if (response.ok) {
        appendColoredLog('🛑 Test execution stopped by user\n');
      } else {
        appendColoredLog('❌ Failed to stop test execution\n');
      }
    } catch (error) {
      appendColoredLog(`❌ Error stopping test: ${error.message}\n`);
    } finally {
      setRunningUi(false);
      setStatus('stopped', 'Stopped');
      currentRunId = null;
      
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      
      // Update final counter
      if (testStats.total > 0) {
        testStats.currentTest = `Stopped: ${testStats.passed}✅ ${testStats.failed}❌`;
        updateTestCounterDisplay();
      }
    }
  });

  clearLogsBtn.addEventListener('click', () => {
    logsEl.textContent = '';
    testCounter.style.display = 'none';
    resetTestCounter();
  });

  copyLogsBtn.addEventListener('click', async () => {
    try {
      const logsText = logsEl.textContent || '';
      if (logsText.trim() === '') {
        alert('No logs to copy');
        return;
      }
      await navigator.clipboard.writeText(logsText);
      
      // Visual feedback
      const originalText = copyLogsBtn.textContent;
      copyLogsBtn.textContent = 'Copied!';
      copyLogsBtn.style.background = 'var(--success)';
      
      setTimeout(() => {
        copyLogsBtn.textContent = originalText;
        copyLogsBtn.style.background = '';
      }, 1500);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = logsEl.textContent || '';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        alert('Logs copied to clipboard!');
      } catch (fallbackErr) {
        alert('Failed to copy logs. Please select and copy manually.');
      }
      document.body.removeChild(textArea);
    }
  });

  // Tag autocomplete event listeners
  if (tagsInput && tagSuggestions) {
    tagsInput.addEventListener('input', (e) => {
      const suggestions = filterTags(e.target.value);
      showTagSuggestions(suggestions);
    });

    tagsInput.addEventListener('keydown', (e) => {
      const suggestions = tagSuggestions.querySelectorAll('.tag-suggestion');
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightSuggestion('down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightSuggestion('up');
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
          e.preventDefault();
          const selectedTag = suggestions[selectedSuggestionIndex].dataset.tag;
          selectTag(selectedTag);
        }
      } else if (e.key === 'Escape') {
        tagSuggestions.style.display = 'none';
        selectedSuggestionIndex = -1;
      }
    });

    tagsInput.addEventListener('blur', (e) => {
      // Delay hiding to allow clicking on suggestions
      setTimeout(() => {
        tagSuggestions.style.display = 'none';
        selectedSuggestionIndex = -1;
      }, 200);
    });

    // Show popular tags on focus if empty
    tagsInput.addEventListener('focus', (e) => {
      if (!e.target.value.trim()) {
        const popularTags = availableTags.filter(t => t.category === 'main');
        showTagSuggestions(popularTags);
      }
    });
  }

  // Selection method toggle event listeners
  if (selectionTags && selectionModule) {
    selectionTags.addEventListener('change', toggleSelectionMethod);
    selectionModule.addEventListener('change', toggleSelectionMethod);
  }

  // Project source toggle event listeners
  if (sourceLocal && sourceGithub) {
    sourceLocal.addEventListener('change', toggleProjectSource);
    sourceGithub.addEventListener('change', toggleProjectSource);
  }

  // Module autocomplete event listeners
  if (moduleInput && moduleSuggestions) {
    moduleInput.addEventListener('click', () => {
      const suggestions = filterModules(moduleInput.value);
      showModuleSuggestions(suggestions);
    });

    moduleInput.addEventListener('focus', () => {
      const suggestions = filterModules(moduleInput.value);
      showModuleSuggestions(suggestions);
    });

    moduleInput.addEventListener('blur', (e) => {
      // Delay hiding to allow clicking on suggestions
      setTimeout(() => {
        moduleSuggestions.style.display = 'none';
        selectedSuggestionIndex = -1;
      }, 200);
    });

    moduleInput.addEventListener('keydown', (e) => {
      const suggestions = moduleSuggestions.querySelectorAll('.tag-suggestion');
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightSuggestion('down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightSuggestion('up');
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
          e.preventDefault();
          const selectedModuleName = suggestions[selectedSuggestionIndex].dataset.module;
          selectModule(selectedModuleName);
        }
      } else if (e.key === 'Escape') {
        moduleSuggestions.style.display = 'none';
        selectedSuggestionIndex = -1;
      }
    });
  }

  // Skip files autocomplete event listeners
  if (skipFilesInput && skipSuggestions) {
    skipFilesInput.addEventListener('input', (e) => {
      const suggestions = filterSpecFiles(e.target.value);
      showSkipSuggestions(suggestions);
    });

    skipFilesInput.addEventListener('keydown', (e) => {
      const suggestions = skipSuggestions.querySelectorAll('.tag-suggestion');
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightSuggestion('down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightSuggestion('up');
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
          e.preventDefault();
          const selectedFileName = suggestions[selectedSuggestionIndex].dataset.file;
          selectSkipFile(selectedFileName);
        }
      } else if (e.key === 'Escape') {
        skipSuggestions.style.display = 'none';
        selectedSuggestionIndex = -1;
      }
    });

    skipFilesInput.addEventListener('blur', (e) => {
      // Delay hiding to allow clicking on suggestions
      setTimeout(() => {
        skipSuggestions.style.display = 'none';
        selectedSuggestionIndex = -1;
      }, 200);
    });

    // Show available files on focus if empty
    skipFilesInput.addEventListener('focus', (e) => {
      if (!e.target.value.trim()) {
        const suggestions = filterSpecFiles('');
        showSkipSuggestions(suggestions.slice(0, 5)); // Show just first 5
      }
    });
  }
});


