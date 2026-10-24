// Copyright 2026 OpenObserve Inc.

// Every fixture records what it creates in the test's `reg`, which the spec's afterEach hands to cleanup.

const dt = require('./downtimes-api.js');
const { waitForStreamSearchable } = require('./oncall-seed.js');
const { createSloViaApi, countDefinition, waitForSloMeasured } = require('./slo-seed.js');

const NO_EVENTS = { started: false, ending_soon: false, ended: false, cancelled: false, extended: false };

// workerIndex is unique among live workers, so a sweep by this prefix never touches a concurrent worker's rows.
const workerPrefix = (prefix, testInfo) => `${prefix}_w${testInfo.workerIndex}`;

function minutesFromNow(minutes) {
  const d = new Date(Date.now() + minutes * 60_000);
  d.setSeconds(0, 0);
  return d;
}

async function newDowntimeFolder(page, reg, suffix = 'f') {
  const id = await dt.createDowntimeFolder(page, `${reg.prefix}_${suffix}`);
  reg.folders.push(id);
  return id;
}

async function newAlertFolder(page, reg, suffix = 'af') {
  const id = await dt.createAlertFolder(page, `${reg.prefix}_${suffix}`);
  reg.alertFolders.push(id);
  return id;
}

async function newSyntheticsFolder(page, reg, suffix) {
  const id = await dt.createSyntheticsFolder(page, `${reg.prefix}_${suffix}`);
  reg.synthFolders.push(id);
  return id;
}

async function alertsInFolder(page, reg, { stream, dest }, suffixes) {
  const folder = await newAlertFolder(page, reg);
  const alerts = {};
  for (const suffix of suffixes) {
    const alert = await dt.createSqlAlert(page, {
      name: `${reg.prefix}_${suffix}`,
      stream,
      sql: `SELECT count(*) AS c FROM "${stream}"`,
      destinations: [dest],
      folder,
      frequencyMinutes: 60,
      periodMinutes: 60,
    });
    reg.alerts.push(alert);
    alerts[suffix] = alert;
  }
  return { folder, alerts };
}

async function sinkAlert(page, reg, { stream, dest }, suffix, { folder = 'default', service = null, silence = 0, enabled = true } = {}) {
  const sql = service
    ? `SELECT service_name, count(*) AS c FROM "${stream}" WHERE service_name = '${service}' GROUP BY service_name`
    : `SELECT count(*) AS c FROM "${stream}"`;
  const alert = await dt.createSqlAlert(page, { name: `${reg.prefix}_${suffix}`, stream, sql, destinations: [dest], folder, silence, enabled });
  reg.alerts.push(alert);
  return alert;
}

// Disabled so the alert never fires: only the downtime row and its banner matter to the caller.
async function disabledAlertWithFolder(page, reg, { stream, dest }, suffix = 'alert') {
  const f = await newDowntimeFolder(page, reg, `${suffix}_f`);
  const alert = await dt.createSqlAlert(page, {
    name: `${reg.prefix}_${suffix}`,
    stream,
    sql: `SELECT count(*) AS c FROM "${stream}"`,
    destinations: [dest],
    frequencyMinutes: 60,
    periodMinutes: 60,
    enabled: false,
  });
  reg.alerts.push(alert);
  return { f, alert };
}

async function bannerDowntime(page, reg, { suffix, folderId, alertId, showBanner = true, schedule = dt.activeWindow() }) {
  return dt.createDowntime(page, folderId, {
    name: `${reg.prefix}_${suffix}`,
    targets: [dt.alertIdsTarget([alertId])],
    schedule,
    show_banner: showBanner,
  });
}

async function activeDowntime(page, reg, folderId, alertId, suffix = 'active', schedule = dt.activeWindow()) {
  return dt.createDowntime(page, folderId, { name: `${reg.prefix}_${suffix}`, targets: [dt.alertIdsTarget([alertId])], schedule });
}

async function scheduledDowntime(page, reg, folderId, alertId, suffix = 'scheduled', schedule = dt.futureWindow({ startInSec: 7200 })) {
  return dt.createDowntime(page, folderId, { name: `${reg.prefix}_${suffix}`, targets: [dt.alertIdsTarget([alertId])], schedule });
}

async function cancelledDowntime(page, reg, folderId, alertId, suffix = 'cancelled') {
  const row = await scheduledDowntime(page, reg, folderId, alertId, suffix);
  await dt.cancelDowntime(page, row.id, folderId);
  return row;
}

async function notifyingDowntime(page, reg, { stream, dest }, events, { schedule = dt.activeWindow(), leadSecs = 600, suffix = 'n' } = {}) {
  const { f, alert } = await disabledAlertWithFolder(page, reg, { stream, dest }, `${suffix}_alert`);
  const down = await dt.createDowntime(page, f, {
    name: `${reg.prefix}_${suffix}_dt`,
    targets: [dt.alertIdsTarget([alert.id])],
    schedule,
    notifications: { destinations: [dest], events: { ...NO_EVENTS, ...events }, ending_soon_lead_secs: leadSecs },
  });
  return { f, down };
}

// Ten minutes of rows now, and the spec's background ingest keeps the service fresh afterwards.
async function incidentService(page, reg, shared, label) {
  const svc = `svc-${label}-${reg.prefix.slice(-8)}`;
  reg.services.push(svc);
  shared.services.push(svc);
  await dt.ingestRows(page, shared.stream, dt.incidentRows([svc], 10));
  return svc;
}

async function incidentAlert(page, reg, { stream, dest }, suffix, svc, { enabled = true } = {}) {
  const alert = await dt.createSqlAlert(page, {
    name: `${reg.prefix}_${suffix}`,
    stream,
    sql: `SELECT k8s_cluster, k8s_deployment_name, service_name, count(*) AS c FROM "${stream}" WHERE service_name = '${svc}' GROUP BY k8s_cluster, k8s_deployment_name, service_name`,
    destinations: [dest],
    createsIncident: true,
    enabled,
  });
  reg.alerts.push(alert);
  return alert;
}

// The manual trigger sends no incident notification, so every notification a spec asserts comes from the scheduler.
async function mutedAlert(page, reg, shared, svc, { targetExtra = {} } = {}) {
  const f = await newDowntimeFolder(page, reg);
  const a = await incidentAlert(page, reg, shared, 'a', svc, { enabled: false });
  const down = await dt.createDowntime(page, f, {
    name: `${reg.prefix}_dt`,
    targets: [dt.alertIdsTarget([a.id], targetExtra)],
    schedule: dt.activeWindow(),
  });
  await dt.enableAlert(page, a.id);
  return { f, a, down, trigger: await dt.triggerMessage(page, a.id) };
}

async function trainedDetector(page, reg, { stream, dest }, suffix, service, { folder = 'default', tags = [], filterField = 'service_name' } = {}) {
  const d = await dt.createAnomalyDetector(page, {
    name: `${reg.prefix}_${suffix}`, stream, service, destinations: [dest], folder, tags, filterField,
  });
  reg.detectors.push(d.id);
  await dt.trainDetector(page, d.id);
  return { ...d, ready: await dt.waitForDetectorReady(page, d.id) };
}

// A downtime saved before the first live pass plans no re-measure (slo/corrections.rs remeasure_slo needs watermark_end).
async function measuredSlo(page, reg, { suffix = 'slo', measure = true, service = null } = {}) {
  const svc = service ?? `slo-${reg.prefix.slice(-8)}`;
  const stream = `${reg.prefix}_stream`;
  const rows = dt.sloRows(svc);
  await dt.ingestRows(page, stream, rows);
  await waitForStreamSearchable(page, stream, rows.length);
  const slo = await createSloViaApi(page, countDefinition({
    name: `${reg.prefix}_${suffix}`,
    stream,
    scope: `service_name = '${svc}'`,
    goodExpr: 'status_code != 500',
    windowSecs: 604800,
    sliceIntervalSecs: 60,
  }));
  let live = null;
  if (measure) {
    await waitForSloMeasured(page, slo.id);
    live = await dt.waitForSloLive(page, slo.id);
  }
  return { ...slo, stream, svc, live };
}

async function syntheticCheck(page, reg, { location, dest }, suffix, { tags = [], folder = 'default' } = {}) {
  const check = await dt.createSyntheticCheck(page, { name: `${reg.prefix}_${suffix}`, tags, location, destinations: [dest], folder });
  reg.checks.push(check);
  return check;
}

module.exports = {
  workerPrefix,
  minutesFromNow,
  newDowntimeFolder,
  newAlertFolder,
  newSyntheticsFolder,
  alertsInFolder,
  sinkAlert,
  disabledAlertWithFolder,
  bannerDowntime,
  activeDowntime,
  scheduledDowntime,
  cancelledDowntime,
  notifyingDowntime,
  incidentService,
  incidentAlert,
  mutedAlert,
  trainedDetector,
  measuredSlo,
  syntheticCheck,
};
