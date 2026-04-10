#!/usr/bin/env node
/**
 * Upload E2E Dashboard to OpenObserve
 *
 * Two modes:
 *   --create    Always create a new dashboard (for per-run dashboards)
 *   --upsert    Find existing by title and update, or create new (for trends dashboard)
 *
 * Usage:
 *   node o2-reporting/upload-dashboard.js --config=dashboard-config.json --create
 *   node o2-reporting/upload-dashboard.js --config=trends-dashboard-config.json --upsert
 *   node o2-reporting/upload-dashboard.js --dry-run --config=dashboard-config.json
 */

const fs = require('fs');
const path = require('path');

// Load env vars
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch (_) { /* dotenv not required */ }

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getConfig() {
  return {
    reportUrl: process.env.O2_REPORT_URL,
    reportOrg: process.env.O2_REPORT_ORG,
    reportEmail: process.env.O2_REPORT_EMAIL,
    reportPassword: process.env.O2_REPORT_PASSWORD,
  };
}

// ---------------------------------------------------------------------------
// Dashboard API operations
// ---------------------------------------------------------------------------

function authHeader(config) {
  return `Basic ${Buffer.from(`${config.reportEmail}:${config.reportPassword}`).toString('base64')}`;
}

async function listDashboards(config, folderId) {
  const folderParam = folderId ? `?folder=${folderId}` : '';
  const url = `${config.reportUrl}/api/${config.reportOrg}/dashboards${folderParam}`;
  const response = await fetch(url, {
    headers: { 'Authorization': authHeader(config), 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Failed to list dashboards: ${response.status} ${await response.text()}`);
  return response.json();
}

async function createDashboard(config, dashboardData, folderId) {
  const folderParam = folderId ? `?folder=${folderId}` : '';
  const url = `${config.reportUrl}/api/${config.reportOrg}/dashboards${folderParam}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': authHeader(config), 'Content-Type': 'application/json' },
    body: JSON.stringify(dashboardData),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create dashboard: ${response.status} ${body}`);
  }
  return response.json();
}

async function getDashboard(config, dashboardId, folderId) {
  const folderParam = folderId ? `?folder=${folderId}` : '';
  const url = `${config.reportUrl}/api/${config.reportOrg}/dashboards/${dashboardId}${folderParam}`;
  const response = await fetch(url, {
    headers: { 'Authorization': authHeader(config), 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Failed to get dashboard: ${response.status}`);
  return response.json();
}

async function updateDashboard(config, dashboardId, dashboardData, hash, folderId) {
  const folderParam = folderId ? `&folder=${folderId}` : '';
  const url = `${config.reportUrl}/api/${config.reportOrg}/dashboards/${dashboardId}?hash=${hash}${folderParam}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': authHeader(config), 'Content-Type': 'application/json' },
    body: JSON.stringify(dashboardData),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to update dashboard: ${response.status} ${body}`);
  }
  return response.json();
}

async function deleteDashboard(config, dashboardId, folderId) {
  const folderParam = folderId ? `?folder=${folderId}` : '';
  const url = `${config.reportUrl}/api/${config.reportOrg}/dashboards/${dashboardId}${folderParam}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': authHeader(config), 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to delete dashboard: ${response.status} ${body}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Folder API operations
// ---------------------------------------------------------------------------

async function getFolderByName(config, folderName) {
  const url = `${config.reportUrl}/api/v2/${config.reportOrg}/folders/dashboards/name/${encodeURIComponent(folderName)}`;
  const response = await fetch(url, {
    headers: { 'Authorization': authHeader(config), 'Content-Type': 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to get folder: ${response.status} ${await response.text()}`);
  return response.json();
}

async function createFolder(config, folderName) {
  const url = `${config.reportUrl}/api/v2/${config.reportOrg}/folders/dashboards`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': authHeader(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, description: 'E2E Playwright test report dashboards' }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create folder: ${response.status} ${body}`);
  }
  return response.json();
}

async function ensureFolder(config, folderName) {
  let folder = await getFolderByName(config, folderName);
  if (folder) {
    console.log(`  Folder "${folderName}" exists (ID: ${folder.folderId})`);
    return folder.folderId;
  }
  console.log(`  Folder "${folderName}" not found, creating...`);
  folder = await createFolder(config, folderName);
  console.log(`  Created folder "${folderName}" (ID: ${folder.folderId})`);
  return folder.folderId;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = getConfig();
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isCreate = args.includes('--create');
  const isUpsert = args.includes('--upsert');

  // Parse --config= and --folder= args
  const configArg = args.find(a => a.startsWith('--config='));
  const configFile = configArg
    ? configArg.split('=').slice(1).join('=')
    : 'dashboard-config.json';

  const folderArg = args.find(a => a.startsWith('--folder='));
  const folderName = folderArg
    ? folderArg.split('=').slice(1).join('=')
    : null;

  if (!isCreate && !isUpsert) {
    console.error('Error: specify --create (new dashboard) or --upsert (find-and-update)');
    process.exit(1);
  }

  if (!config.reportUrl || !config.reportOrg || !config.reportEmail || !config.reportPassword) {
    console.error('Missing O2 config. Required env vars:');
    console.error('  O2_REPORT_URL, O2_REPORT_ORG, O2_REPORT_EMAIL, O2_REPORT_PASSWORD');
    process.exit(1);
  }

  // Read dashboard config
  const configPath = path.resolve(__dirname, configFile);
  if (!fs.existsSync(configPath)) {
    console.error(`Dashboard config not found: ${configPath}`);
    console.error('Run generate-dashboard.js or generate-trends-dashboard.js first.');
    process.exit(1);
  }
  const dashboardData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const totalPanels = dashboardData.tabs.reduce((sum, t) => sum + t.panels.length, 0);
  console.log('\nOpenObserve Dashboard Upload');
  console.log('='.repeat(50));
  console.log(`  Target: ${config.reportUrl}`);
  console.log(`  Org:    ${config.reportOrg}`);
  console.log(`  Title:  ${dashboardData.title}`);
  console.log(`  Mode:   ${isCreate ? 'CREATE NEW' : 'UPSERT'}`);
  console.log(`  Config: ${configFile}`);
  console.log(`  Tabs:   ${dashboardData.tabs.map(t => t.name).join(', ')}`);
  console.log(`  Panels: ${totalPanels}`);
  console.log(`  Dry Run: ${isDryRun}`);
  console.log('='.repeat(50));

  if (isDryRun) {
    console.log('\nDRY RUN — would upload dashboard with the following panels:\n');
    for (const tab of dashboardData.tabs) {
      console.log(`  Tab: ${tab.name}`);
      for (const p of tab.panels) {
        console.log(`    - ${p.title} (${p.type})`);
      }
    }
    console.log('\nDone (dry run).\n');
    return;
  }

  // Resolve folder if specified
  let folderId = null;
  if (folderName) {
    console.log(`\nResolving folder: "${folderName}"`);
    folderId = await ensureFolder(config, folderName);
  }

  if (isCreate) {
    // Always create a new dashboard
    console.log('\nCreating new dashboard...');
    const result = await createDashboard(config, dashboardData, folderId);
    const inner = result.v8 || result;
    const dashboardId = inner.dashboardId || 'unknown';
    console.log(`  Created successfully!`);
    console.log(`  Dashboard ID: ${dashboardId}`);
    console.log(`  URL: ${config.reportUrl}/web/dashboards`);
  } else {
    // Upsert: find by title, update if exists, create if not
    // Also delete any duplicates with the same title
    console.log('\nChecking for existing dashboard...');
    const existing = await listDashboards(config, folderId);
    const dashboards = existing.dashboards || existing.list || [];

    const matches = dashboards.filter(d => {
      const inner = d.v8 || d;
      return inner.title === dashboardData.title;
    });

    if (matches.length > 0) {
      // Update the first match
      const first = matches[0];
      const inner = first.v8 || first;
      const dashboardId = inner.dashboardId || inner.dashboard_id;
      console.log(`  Found ${matches.length} existing dashboard(s) with title "${dashboardData.title}"`);
      console.log(`  Updating: ${dashboardId}`);

      const current = await getDashboard(config, dashboardId, folderId);
      const hash = current.hash;
      console.log(`  Updating (hash: ${hash})...`);

      const result = await updateDashboard(config, dashboardId, dashboardData, hash, folderId);
      const resultInner = result.v8 || result;
      console.log(`  Updated successfully!`);
      console.log(`  Dashboard ID: ${resultInner.dashboardId || dashboardId}`);

      // Delete duplicates (all except the first)
      if (matches.length > 1) {
        console.log(`  Cleaning up ${matches.length - 1} duplicate(s)...`);
        for (let i = 1; i < matches.length; i++) {
          const dup = matches[i];
          const dupInner = dup.v8 || dup;
          const dupId = dupInner.dashboardId || dupInner.dashboard_id;
          try {
            await deleteDashboard(config, dupId, folderId);
            console.log(`    Deleted duplicate: ${dupId}`);
          } catch (err) {
            console.warn(`    Failed to delete duplicate ${dupId}: ${err.message}`);
          }
        }
      }
    } else {
      console.log('  No existing dashboard found. Creating new...');
      const result = await createDashboard(config, dashboardData, folderId);
      const resultInner = result.v8 || result;
      console.log(`  Created successfully!`);
      console.log(`  Dashboard ID: ${resultInner.dashboardId || 'unknown'}`);
    }
  }

  console.log(`\nDashboard URL: ${config.reportUrl}/web/dashboards`);
  console.log('Done!\n');
}

// Allow programmatic use
async function uploadDashboard(configFile, mode) {
  const originalArgv = process.argv;
  process.argv = ['node', 'upload-dashboard.js', `--config=${configFile}`, `--${mode}`];
  try {
    await main();
  } finally {
    process.argv = originalArgv;
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { uploadDashboard };
