// Copyright 2026 OpenObserve Inc.

// No expect() here: assertions belong in the RegressionSet specs that use these fixtures.

const { api, baseUrl, ingestUrl, orgId } = require('./oncall-seed.js');
const { ingestBase } = require('./ingest-url.js');

const v1 = () => `${baseUrl()}/api/${orgId()}`;
const v2 = () => `${baseUrl()}/api/v2/${orgId()}`;

/** A disabled scheduled alert whose threshold is never reached. */
function quietAlert(name, stream) {
  return {
    name, stream_type: 'logs', stream_name: stream, is_real_time: false,
    query_condition: {
      type: 'custom',
      conditions: { version: 2, conditions: { filterType: 'group', logicalOperator: 'AND', conditions: [] } },
      sql: null, promql: null, promql_condition: null, aggregation: null,
      vrl_function: null, search_event_type: null, multi_time_range: [],
    },
    trigger_condition: {
      period: 10, operator: '>=', threshold: 1000000, frequency: 60, cron: '',
      frequency_type: 'minutes', silence: 10, timezone: 'UTC', align_time: true,
    },
    destinations: [], context_attributes: {}, row_template: '', enabled: false,
  };
}

/** A per-minute SQL alert on error rows that opens an incident when it fires. */
function incidentAlert(name, stream) {
  return {
    name, stream_type: 'logs', stream_name: stream, is_real_time: false,
    query_condition: {
      type: 'sql', conditions: null, promql: '', promql_condition: null,
      sql: `SELECT service_name, count(*) AS cnt FROM "${stream}" WHERE level = 'error' GROUP BY service_name`,
      search_event_type: 'ui', vrl_function: null, multi_time_range: [],
    },
    trigger_condition: {
      period: 30, operator: '>=', threshold: 1, frequency: 1, cron: '', silence: 0,
      frequency_type: 'minutes', timezone: 'UTC', tolerance_in_secs: 0,
    },
    destinations: [], enabled: true, description: 'ENT#3181 detail confirm',
    creates_incident: true, context_attributes: {}, row_template: '',
  };
}

async function readOrgConfig(page) {
  return (await api(page, 'get', `${v1()}/config`)).json();
}

async function ingestLogs(page, stream, rows) {
  return api(page, 'post', `${ingestBase(ingestUrl())}/api/${orgId()}/${stream}/_json`, rows);
}

async function deleteLogStream(page, stream) {
  return api(page, 'delete', `${v1()}/streams/${stream}?type=logs`);
}

async function createAlertInDefaultFolder(page, payload) {
  return api(page, 'post', `${v2()}/alerts?folder=default`, payload);
}

async function deleteAlertInDefaultFolder(page, id) {
  return api(page, 'delete', `${v2()}/alerts/${id}?folder=default`);
}

/** The id of the incident one of whose alert groups came from this alert, or null. */
async function findIncidentIdForAlert(page, alertId) {
  const list = await (await api(page, 'get', `${v2()}/alerts/incidents?limit=1000`)).json();
  const hit = (list.incidents || []).find((i) => (i.alert_groups || []).some((g) => g.alert_id === alertId));
  return hit ? hit.id : null;
}

async function incidentStatus(page, id) {
  const res = await api(page, 'get', `${v2()}/alerts/incidents/${id}`);
  const body = await res.json();
  return (body.incident || body).status;
}

async function resolveIncident(page, id) {
  return api(page, 'patch', `${v2()}/alerts/incidents/${id}/update`, { status: 'resolved' });
}

function isIncidentStatusUpdate(req, incidentId) {
  return req.method() === 'PATCH' && req.url().includes(`/alerts/incidents/${incidentId}/update`);
}

async function createHttpTemplate(page, name, body) {
  return api(page, 'post', `${v1()}/alerts/templates`, { name, type: 'http', title: '', body });
}

async function createHttpDestination(page, { name, url, template, headers }) {
  return api(page, 'post', `${v1()}/alerts/destinations`, {
    name, url, method: 'post', type: 'http', skip_tls_verify: false, template, headers,
  });
}

async function getDestination(page, name) {
  return (await api(page, 'get', `${v1()}/alerts/destinations/${name}`)).json();
}

async function deleteDestination(page, name) {
  return api(page, 'delete', `${v1()}/alerts/destinations/${name}`);
}

async function deleteTemplate(page, name) {
  return api(page, 'delete', `${v1()}/alerts/templates/${name}`);
}

function isDestinationUpdate(res, name) {
  return res.request().method() === 'PUT' && res.url().includes(`/alerts/destinations/${name}`);
}

async function resolveOnCallResponse(page, responseId) {
  return api(page, 'post', `${v1()}/oncall/responses/${responseId}/resolve`, {});
}

module.exports = {
  quietAlert,
  incidentAlert,
  readOrgConfig,
  ingestLogs,
  deleteLogStream,
  createAlertInDefaultFolder,
  deleteAlertInDefaultFolder,
  findIncidentIdForAlert,
  incidentStatus,
  resolveIncident,
  isIncidentStatusUpdate,
  createHttpTemplate,
  createHttpDestination,
  getDestination,
  deleteDestination,
  deleteTemplate,
  isDestinationUpdate,
  resolveOnCallResponse,
};
