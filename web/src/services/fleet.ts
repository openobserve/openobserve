// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import http from "./http";

export type FleetCollectorStatus = "online" | "degraded" | "offline";

export type FleetDeliveryState = "assigned" | "sent" | "accepted" | "running" | "rejected";

export interface CollectorFleet {
  id: string;
  name: string | null;
}

export interface FleetCollector {
  id: string;
  name: string | null;
  hostname: string | null;
  ip: string | null;
  status: FleetCollectorStatus;
  os: string | null;
  arch: string | null;
  distribution: string | null;
  version: string | null;
  outdated: boolean;
  config: string | null;
  config_version: number | null;
  delivery: FleetDeliveryState | null;
  drifted: boolean | null;
  fleet: CollectorFleet;
  token_id: string | null;
  last_seen: number;
  enrolled_at: number;
}

export interface FleetCollectorList {
  total: number;
  items: FleetCollector[];
}

export interface FleetComponentHealth {
  id: string;
  healthy: boolean;
  status: string;
  last_error: string;
}

export interface FleetCollectorHealth {
  healthy: boolean;
  status: string;
  last_error: string;
  components: FleetComponentHealth[];
}

export interface FleetEffectiveConfig {
  yaml: string;
  reported_at: number;
}

export interface FleetCollectorDetail extends FleetCollector {
  capabilities: string[];
  health: FleetCollectorHealth | null;
  errors: string[];
  delivery_error: string | null;
  effective_config: FleetEffectiveConfig | null;
  assigned_at: number | null;
  applied_at: number | null;
  drift_since: number | null;
  /** The redacted effective config at apply time, which drift is measured against. */
  baseline_config: string | null;
}

export interface FleetStatusCounts {
  total: number;
  online: number;
  degraded: number;
  offline: number;
  drifted: number;
  outdated: number;
}

export interface FleetVersionCount {
  version: string;
  count: number;
}

export interface FleetSummary {
  collectors: FleetStatusCounts;
  versions: FleetVersionCount[];
  target_version: string;
  rollouts_active: number;
}

/** `PUT` replaces both fields; a null target means the built-in default. */
export interface FleetSettings {
  restricted_components: string[];
  target_version: string | null;
}

/** Mirrors `config::meta::fleet::EnrollmentToken`; it never carries the secret. */
export interface FleetToken {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  expires_at: number | null;
  uses: number;
  max_uses: number | null;
  fleet: CollectorFleet;
  revoked: boolean;
}

export interface FleetTokenList {
  items: FleetToken[];
}

export interface FleetCreateTokenRequest {
  name: string;
  expires_in_days: number | null;
  max_uses: number | null;
  fleet: string;
}

/** The only response that carries the plaintext token. */
export interface FleetCreatedToken extends FleetToken {
  token: string;
}

export interface FleetConfigItem {
  id: string;
  description: string;
  template: boolean;
  latest_version: number;
  live_version: number | null;
  collectors: number;
  fleets: CollectorFleet[];
  updated_at: number;
  updated_by: string;
}

export interface FleetConfigDraft {
  yaml: string;
  by: string;
  at: number;
}

export interface FleetConfigVersionSummary {
  version: number;
  author: string;
  at: number;
  message: string;
  live: boolean;
  /** Null for the live version. */
  state: "published" | "rolling_out" | null;
}

export interface FleetConfigDetail extends FleetConfigItem {
  draft: FleetConfigDraft | null;
  versions: FleetConfigVersionSummary[];
}

export interface FleetConfigVersion {
  version: number;
  yaml: string;
  hash: string;
}

export interface FleetConfigIssue {
  severity: "error" | "warning";
  text: string;
}

/** Keyed by pipeline id; `""` holds the issues of the whole document. */
export type FleetConfigIssues = Record<string, FleetConfigIssue[]>;

export interface FleetPublished {
  version: number;
  warnings: FleetConfigIssues;
}

export interface FleetAuditEvent {
  id: string;
  at: number;
  actor: string;
  /** The i18n key of the action, as the server stores it. */
  action: string;
  target: string;
  outcome: string;
}

export interface FleetAuditList {
  items: FleetAuditEvent[];
  /** The trail is the server's audit stream, which `O2_AUDIT_ENABLED=false` turns off. */
  audit_disabled?: boolean;
}

export type FleetRolloutStrategy = "immediate" | "canary" | "progressive" | "scheduled";

export type FleetRolloutStatus =
  "scheduled" | "in_progress" | "completed" | "halted" | "superseded";

/** Mirrors `config::meta::fleet::SetDesiredRequest`; the server refuses any other field. */
export interface FleetSetDesiredRequest {
  config: string;
  version: number;
  strategy: FleetRolloutStrategy;
  batch?: FleetRolloutBatch;
  /** Epoch milliseconds; only with `scheduled`. */
  scheduled_for?: number | null;
  gates?: boolean;
  auto_rollback?: boolean;
}

/** `initial` alone for canary; all three for progressive. */
export interface FleetRolloutBatch {
  initial: number;
  multiplier?: number;
  max?: number;
}

export interface FleetRolloutPhase {
  id: string;
  label: string;
  size: number;
  /** Members this rollout actually assigned. */
  assigned: number;
  attempted: number;
  accepted: number;
  failed: number;
  status: string;
}

export interface FleetRolloutGate {
  id: string;
  threshold: string;
  observed: string;
  status: string;
}

export type FleetHaltKind = "rejection" | "gate_failed" | "no_data";

export interface FleetRolloutFailure {
  kind: FleetHaltKind;
  gate: string;
  observed: string;
  threshold: string;
  message?: string | null;
}

export interface FleetRolloutEvent {
  key: string;
  at: number;
  /** The phase index; set on `deploying` only. */
  phase?: number | null;
}

export interface FleetRollout {
  id: string;
  kind: string;
  config: string;
  /** Null when the members came from mixed versions or had none. */
  from_version: number | null;
  to_version: number;
  fleet: CollectorFleet;
  strategy: FleetRolloutStrategy;
  status: FleetRolloutStatus;
  total: number;
  attempted: number;
  accepted: number;
  failed: number;
  /** Members this rollout actually assigned. */
  assigned: number;
  started_at: number;
  scheduled_for: number | null;
  started_by: string;
  auto_rollback: boolean;
  phases: FleetRolloutPhase[];
  gates: FleetRolloutGate[];
  failure: FleetRolloutFailure | null;
  events: FleetRolloutEvent[];
}

export interface FleetRolloutDetail extends FleetRollout {
  members: string[];
  still_on_previous: number;
}

export type FleetFlowWindow = "5m" | "1h" | "24h";

export type FleetFlowSignal = "logs" | "metrics" | "traces";

export interface FleetFlowIssue {
  kind: "export_errors" | "dropped" | "backpressure";
  signal: FleetFlowSignal;
  value: number;
}

/** A null rate means no telemetry, 0 a measured zero. */
export interface FleetFlowLink {
  config: string;
  destination: string;
  exporters: string[];
  rate: Record<FleetFlowSignal, number | null>;
  issues: FleetFlowIssue[];
}

/** `exporter` is set only when `target` is null. */
export interface FleetFlowDestination {
  id: string;
  type: string;
  target: string | null;
  exporter: string | null;
}

export interface FleetFlow {
  window: FleetFlowWindow;
  generated_at: number;
  destinations: FleetFlowDestination[];
  links: FleetFlowLink[];
  /** True when the caller may not read some of the metric streams behind the rates. */
  metrics_restricted: boolean;
}

export interface FleetRevision {
  id: string;
  status: FleetRolloutStatus;
}

export interface FleetVersion {
  config: string;
  version: number;
}

export interface FleetState {
  desired: FleetVersion | null;
  /** The last desired version the fleet converged to. */
  stable: FleetVersion | null;
  revision: FleetRevision | null;
  collectors: number;
  online: number;
  at_desired: number;
}

export interface Fleet {
  id: string;
  name: string;
  state: FleetState | null;
}

const collectorPath = (orgId: string, id: string) =>
  `/api/${orgId}/fleet/collectors/${encodeURIComponent(id)}`;

const configPath = (orgId: string, id: string) =>
  `/api/${orgId}/fleet/configs/${encodeURIComponent(id)}`;

const rolloutPath = (orgId: string, id: string) =>
  `/api/${orgId}/fleet/rollouts/${encodeURIComponent(id)}`;

const fleet = {
  listCollectors: (orgId: string) =>
    http().get<FleetCollectorList>(`/api/${orgId}/fleet/collectors`),
  getCollector: (orgId: string, id: string) =>
    http().get<FleetCollectorDetail>(collectorPath(orgId, id)),
  unenrollCollector: (orgId: string, id: string) => http().delete(collectorPath(orgId, id)),
  summary: (orgId: string) => http().get<FleetSummary>(`/api/${orgId}/fleet/summary`),
  listTokens: (orgId: string) => http().get<FleetTokenList>(`/api/${orgId}/fleet/tokens`),
  createToken: (orgId: string, body: FleetCreateTokenRequest) =>
    http().post<FleetCreatedToken>(`/api/${orgId}/fleet/tokens`, body),
  revokeToken: (orgId: string, id: string) =>
    http().post<FleetToken>(`/api/${orgId}/fleet/tokens/${encodeURIComponent(id)}/revoke`),
  listConfigs: (orgId: string) =>
    http().get<{ items: FleetConfigItem[] }>(`/api/${orgId}/fleet/configs`),
  getConfig: (orgId: string, id: string) => http().get<FleetConfigDetail>(configPath(orgId, id)),
  createConfig: (orgId: string, body: { id: string; description: string; yaml: string }) =>
    http().post<FleetConfigDetail>(`/api/${orgId}/fleet/configs`, body),
  saveConfigDraft: (orgId: string, id: string, body: { yaml: string }) =>
    http().put<{ at: number }>(`${configPath(orgId, id)}/draft`, body),
  publishConfigVersion: (orgId: string, id: string, body: { yaml: string; message: string }) =>
    http().post<FleetPublished>(`${configPath(orgId, id)}/versions`, body),
  getConfigVersion: (orgId: string, id: string, version: number) =>
    http().get<FleetConfigVersion>(
      `${configPath(orgId, id)}/versions/${encodeURIComponent(String(version))}`,
    ),
  validateConfig: (orgId: string, body: { yaml: string }) =>
    http().post<{ issues: FleetConfigIssues }>(`/api/${orgId}/fleet/configs/validate`, body),
  deleteConfig: (orgId: string, id: string) => http().delete(configPath(orgId, id)),
  listAudit: (orgId: string) => http().get<FleetAuditList>(`/api/${orgId}/fleet/audit`),
  listRollouts: (orgId: string) =>
    http().get<{ items: FleetRollout[] }>(`/api/${orgId}/fleet/rollouts`),
  getRollout: (orgId: string, id: string) => http().get<FleetRolloutDetail>(rolloutPath(orgId, id)),
  listFleets: (orgId: string) => http().get<{ items: Fleet[] }>(`/api/${orgId}/fleet/fleets`),
  setDesired: (orgId: string, fleetId: string, body: FleetSetDesiredRequest) =>
    http().put<FleetRollout>(
      `/api/${orgId}/fleet/fleets/${encodeURIComponent(fleetId)}/desired`,
      body,
    ),
  getFlow: (orgId: string, window: FleetFlowWindow) =>
    http().get<FleetFlow>(`/api/${orgId}/fleet/flow`, { params: { window } }),
  getSettings: (orgId: string) => http().get<FleetSettings>(`/api/${orgId}/fleet/settings`),
  updateSettings: (orgId: string, body: FleetSettings) =>
    http().put<FleetSettings>(`/api/${orgId}/fleet/settings`, body),
};

export default fleet;
