// Copyright 2026 OpenObserve Inc.

/**
 * API helpers for alert leases (temporary alerts and timed incident-creation changes).
 * There is no UI to create a lease, so specs set one here and assert on the chips.
 */

const { api, urls, simpleAlert, createAlertForId } = require('./alerts-api-helpers.js');

const MINUTE_MS = 60 * 1000;

/** Unix microseconds `ms` from now, the unit every lease field uses. */
const usFromNow = (ms) => (Date.now() + ms) * 1000;

async function jsonOrThrow(response, what) {
  const body = await response.text();
  if (response.status() !== 200) throw new Error(`${what} -> ${response.status()}: ${body}`);
  return body ? JSON.parse(body) : null;
}

/** Creates a scheduled alert that is disabled at `endsAtUs`; returns its id. */
async function createTemporaryAlert(page, name, { endsAtUs, reason }) {
  return createAlertForId(page, { ...simpleAlert(name), lease: { ends_at_us: endsAtUs, reason } });
}

/** PATCH creates_incident; with `untilUs` the prior value returns then. Returns the response body. */
async function setCreatesIncident(page, alertId, { value, untilUs, reason }) {
  const body = { value };
  if (untilUs !== undefined) body.until_us = untilUs;
  if (reason !== undefined) body.reason = reason;
  const response = await api(page, 'patch', `${urls().v2}/alerts/${alertId}/creates_incident`, body);
  return jsonOrThrow(response, `setCreatesIncident ${alertId}`);
}

async function listLeases(page, alertId, state) {
  const query = state ? `?state=${state}` : '';
  return jsonOrThrow(await api(page, 'get', `${urls().v2}/alerts/${alertId}/leases${query}`), `listLeases ${alertId}`);
}

/** The alert's one active lease of `kind`; throws when there is none. */
async function activeLease(page, alertId, kind) {
  const lease = (await listLeases(page, alertId, 'active')).find((l) => l.kind === kind);
  if (!lease) throw new Error(`activeLease: alert ${alertId} has no active ${kind} lease`);
  return lease;
}

async function endLease(page, alertId, leaseId) {
  const response = await api(page, 'post', `${urls().v2}/alerts/${alertId}/leases/${leaseId}/end`);
  return jsonOrThrow(response, `endLease ${leaseId}`);
}

async function keepLease(page, alertId, leaseId) {
  const response = await api(page, 'post', `${urls().v2}/alerts/${alertId}/leases/${leaseId}/keep`);
  return jsonOrThrow(response, `keepLease ${leaseId}`);
}

module.exports = {
  MINUTE_MS, usFromNow,
  createTemporaryAlert, setCreatesIncident, listLeases, activeLease, endLease, keepLease,
};
