// REST seeding and cleanup for dashboard regression specs: log rows, dashboards, folders and the Home pin.
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const HOME_PIN_KEY = 'home_dashboard';

const orgIdentifier = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const jsonHeaders = () => ({ ...getAuthHeaders(), 'Content-Type': 'application/json' });

async function dashboardApi(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: jsonHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function ingestLogRows(stream, rows) {
  const res = await fetch(`${BASE}/api/${orgIdentifier()}/${stream}/_json`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(rows) });
  if (!res.ok) throw new Error(`ingest ${res.status}`);
}

async function createDashboard(payload, folder = 'default') {
  const { status, body } = await dashboardApi('POST', `/api/${orgIdentifier()}/dashboards?folder=${folder}`, payload);
  if (status >= 400) throw new Error(`create dashboard ${status}: ${JSON.stringify(body)}`);
  const inner = body[`v${body.version}`] || body;
  return inner.dashboardId || inner.dashboard_id;
}

const deleteDashboard = (dashboardId, folder = 'default') => dashboardApi('DELETE', `/api/${orgIdentifier()}/dashboards/${dashboardId}?folder=${folder}`);

async function deleteSeededTablePanel({ stream, dashboardId }) {
  if (dashboardId) await deleteDashboard(dashboardId).catch(() => {});
  await fetch(`${BASE}/api/${orgIdentifier()}/streams/${stream}?type=logs`, { method: 'DELETE', headers: getAuthHeaders() }).catch(() => {});
}

function formatInZone(ms, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function timezoneTableDashboard(stamp, stream) {
  return {
    version: 8,
    title: `ovn_c_tz_${stamp}`,
    description: 'ENT#1491 OSS#9855',
    variables: { list: [], showDynamicFilters: false },
    tabs: [{
      tabId: 'default',
      name: 'Default',
      panels: [{
        id: 'Panel_tz',
        type: 'table',
        title: 'tz table',
        description: '',
        queryType: 'sql',
        config: { show_legends: true },
        queries: [{
          query: `SELECT histogram(_timestamp, '1 minute') as "x_axis_1", count(*) as "y_axis_1" FROM "${stream}" GROUP BY x_axis_1`,
          vrlFunctionQuery: '',
          customQuery: true,
          fields: {
            stream,
            stream_type: 'logs',
            x: [{ label: 'Time', alias: 'x_axis_1', column: '_timestamp', type: 'build', functionName: 'histogram', args: [], color: null }],
            y: [{ label: 'Count', alias: 'y_axis_1', column: 'y_axis_1', type: 'custom', functionName: null, args: [], color: null }],
            z: [],
            filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
          },
          config: { promql_legend: '' },
        }],
        layout: { x: 0, y: 0, w: 48, h: 12, i: 1 },
      }],
    }],
  };
}

async function seedTimezoneTablePanel(stamp) {
  const stream = `ovn_c_tz_${stamp}`;
  // a whole minute 10 minutes ago, so the 1-minute histogram bucket equals the row time
  const rowMs = Math.floor((Date.now() - 10 * 60 * 1000) / 60000) * 60000;
  try {
    await ingestLogRows(stream, [{ _timestamp: rowMs * 1000, msg: 'tz' }]);
    return { stream, rowMs, dashboardId: await createDashboard(timezoneTableDashboard(stamp, stream)) };
  } catch (e) {
    // the caller's finally never sees a seed that threw, so drop the ingested stream here
    await deleteSeededTablePanel({ stream });
    throw e;
  }
}

function statusRows(statuses) {
  const now = Date.now() * 1000;
  return statuses.map((status, i) => ({ _timestamp: now - i * 1000, svc: `svc${i}`, status }));
}

function uniqueValueColorDashboard(stamp, stream) {
  const axis = (alias) => ({ label: '', alias, column: alias, type: 'custom', color: null, functionName: null, args: [] });
  return {
    version: 8,
    title: `ovn_c702_${stamp}`,
    description: 'ENT#702',
    variables: { list: [], showDynamicFilters: false },
    tabs: [{
      tabId: 'default',
      name: 'Default',
      panels: [{
        id: 'Panel_ent702',
        type: 'table',
        title: 'status colors',
        description: '',
        queryType: 'sql',
        config: {
          show_legends: true,
          override_config: [{ field: { matchBy: 'name', value: 'status' }, config: [{ type: 'unique_value_color', autoColor: true }] }],
        },
        queries: [{
          query: `SELECT svc as "svc", status as "status" FROM "${stream}"`,
          vrlFunctionQuery: '',
          customQuery: true,
          fields: { stream, stream_type: 'logs', x: [axis('svc')], y: [axis('status')], z: [], filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] } },
          config: { promql_legend: '' },
        }],
        layout: { x: 0, y: 0, w: 96, h: 18, i: 1 },
      }],
    }],
  };
}

function pinnedCountDashboard(title) {
  return {
    version: 8,
    title,
    description: 'ent2140',
    variables: { list: [], showDynamicFilters: false },
    tabs: [{
      tabId: 'default',
      name: 'Default',
      panels: [{
        id: 'Panel_ent2140',
        type: 'table',
        title: 'ent2140 panel',
        description: '',
        queryType: 'sql',
        config: { show_legends: true },
        queries: [{
          query: 'SELECT count(*) as "cnt" FROM "e2e_automate"',
          vrlFunctionQuery: '',
          customQuery: true,
          fields: {
            stream: 'e2e_automate',
            stream_type: 'logs',
            x: [],
            y: [{ label: '', alias: 'cnt', column: 'cnt', type: 'custom', color: null, functionName: null, args: [] }],
            z: [],
            filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
          },
          config: { promql_legend: '' },
        }],
        layout: { x: 0, y: 0, w: 48, h: 10, i: 1 },
      }],
    }],
  };
}

async function createDashboardFolder(name, description) {
  const { status, body } = await dashboardApi('POST', `/api/v2/${orgIdentifier()}/folders/dashboards`, { name, description });
  if (status >= 400) throw new Error(`create folder ${name} -> ${status}`);
  return body.folderId || body.folder_id;
}

const deleteDashboardFolder = (folderId) => dashboardApi('DELETE', `/api/v2/${orgIdentifier()}/folders/dashboards/${folderId}`);

async function dashboardsInFolder(folderId) {
  const { body } = await dashboardApi('GET', `/api/${orgIdentifier()}/dashboards?folder=${folderId}`);
  return (body.dashboards || body.list || []).map((d) => {
    const inner = d[`v${d.version}`] || d;
    return { id: inner.dashboardId || d.dashboard_id, title: inner.title || d.title };
  });
}

async function deleteDashboardsTitled(folderId, title) {
  for (const d of await dashboardsInFolder(folderId)) {
    if (d.title === title) await deleteDashboard(d.id, folderId);
  }
}

const readHomePin = () => dashboardApi('GET', `/api/${orgIdentifier()}/settings/v2/${HOME_PIN_KEY}`);

async function pinnedHomeDashboardId() {
  const { body } = await readHomePin();
  return body?.setting_value?.dashboardId ?? body?.dashboardId;
}

async function restoreHomePin(before) {
  const priorValue = (before.status < 400 ? before.body : null)?.setting_value ?? null;
  if (priorValue) {
    await dashboardApi('POST', `/api/${orgIdentifier()}/settings/v2`, { setting_key: HOME_PIN_KEY, setting_value: priorValue, setting_category: 'ui' });
  } else {
    await dashboardApi('DELETE', `/api/${orgIdentifier()}/settings/v2/${HOME_PIN_KEY}`);
  }
}

module.exports = {
  orgIdentifier,
  ingestLogRows,
  createDashboard,
  deleteDashboard,
  deleteSeededTablePanel,
  formatInZone,
  seedTimezoneTablePanel,
  statusRows,
  uniqueValueColorDashboard,
  pinnedCountDashboard,
  createDashboardFolder,
  deleteDashboardFolder,
  dashboardsInFolder,
  deleteDashboardsTitled,
  readHomePin,
  pinnedHomeDashboardId,
  restoreHomePin,
};
