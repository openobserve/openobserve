const { expect } = require('@playwright/test');
const { getAuthHeaders } = require('./cloud-auth.js');
const { ingestBase } = require('./ingest-url.js');
const { waitForSearch } = require('./traces-api.js');

const baseUrl = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

/** One Warning event; body_object is a JSON string, which every flatten level stores as a single column. */
function k8sEventRow({ id, note, cluster }) {
  const object = {
    kind: 'Event',
    type: 'Warning',
    reason: 'BackOff',
    note,
    metadata: { name: `checkout-7f9c.${id}`, namespace: 'shop', uid: `uid-${id}` },
    regarding: { kind: 'Pod', name: 'checkout-7f9c', namespace: 'shop', uid: `pod-${id}` },
    reportingController: 'kubelet',
  };
  return {
    _timestamp: (Date.now() - 60 * 1000) * 1000,
    event_name: `checkout-7f9c.${id}`,
    k8s_namespace_name: 'shop',
    ...(cluster ? { k8s_cluster: cluster } : {}),
    body_object: JSON.stringify(object),
  };
}

async function ingestK8sEvents(request, org, rows) {
  const res = await request.post(`${ingestBase(baseUrl())}/api/${org}/k8s_events/_json`, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    data: rows,
  });
  expect(res.ok(), `Precondition: k8s events must ingest (HTTP ${res.status()})`).toBe(true);
  const names = rows.map((r) => `'${r.event_name}'`).join(', ');
  await waitForSearch(request, `SELECT event_name FROM "k8s_events" WHERE event_name IN (${names})`, {
    org,
    type: 'logs',
    expected: rows.length,
    message: 'Precondition: k8s events must become searchable',
  });
}

module.exports = { k8sEventRow, ingestK8sEvents };
