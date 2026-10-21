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
import { FLEET_MOCK, fleetMock } from "./fleet.mock";

export type FleetCollectorStatus = "unknown" | "online" | "degraded" | "offline";

export type FleetDeliveryState = "assigned" | "sent" | "accepted" | "running" | "rejected";

export interface CollectorFleet {
  id: string;
  name: string | null;
}

export interface FleetCollector {
  id: string;
  /** The nickname, which defaults to the host name. */
  name: string | null;
  hostname: string | null;
  os: string | null;
  arch: string | null;
  distribution: string | null;
  version: string | null;
  outdated: boolean;
  status: FleetCollectorStatus;
  /** The connection's peer address, which the agent does not report itself. */
  last_connected_from: string | null;
  fleet: CollectorFleet;
  token_id: string | null;
  last_seen: number;
  enrolled_at: number;
  config: string | null;
  config_version: number | null;
  delivery: FleetDeliveryState | null;
  delivery_error: string | null;
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

export interface FleetAssignment {
  fleet: string;
  config: string;
  version: number;
  revision: number;
}

/** What the server last saw from the collector, which each delivery state is traced to. */
export interface FleetDeliveryEvidence {
  remote_status: string | null;
  remote_hash: string | null;
  remote_at: number | null;
  marker: { config: string; version: number } | null;
  last_heartbeat_at: number | null;
}

export interface FleetCollectorEvent {
  at: number;
  event: string;
  detail: string | null;
}

export interface FleetCollectorDetail extends FleetCollector {
  capabilities: string[];
  health: FleetCollectorHealth | null;
  effective_config: string | null;
  effective_reported_at: number | null;
  assignment: FleetAssignment | null;
  evidence: FleetDeliveryEvidence | null;
  history: FleetCollectorEvent[];
}

export interface FleetStatusCounts {
  total: number;
  unknown: number;
  online: number;
  degraded: number;
  offline: number;
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

export interface FleetGateSettings {
  observe_secs: number;
  window_secs: number;
  pass_percent: number;
}

/** A null field inherits the organization default. */
export interface FleetSettings {
  heartbeat_interval_secs: number | null;
  offline_heartbeats: number | null;
  retention_days: number | null;
  offline_ratio_percent: number | null;
  phase_timeout_secs: number | null;
  gate: FleetGateSettings | null;
}

export type FleetDefaults = { [K in keyof FleetSettings]: NonNullable<FleetSettings[K]> };

/** `PUT` replaces every field; a null target means the latest supported version. */
export interface FleetOrgSettings {
  target_collector_version: string | null;
  restricted_components: string[];
  fleet_defaults: FleetDefaults;
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
  /** The stored value; absent on tokens created before values were kept. */
  token?: string | null;
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
  latest_version: number;
  live_version: number | null;
  collectors: number;
  /** The fleets the caller can read whose desired or stable version is this configuration. */
  fleets: CollectorFleet[];
  /** Referencing fleets the caller cannot read. */
  fleets_hidden?: number;
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

/** The 409 body of a reference-protected delete. */
export interface FleetConfigReferences {
  fleets: number;
  collectors: number;
  rollouts: number;
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

export type FleetRolloutStatus =
  "scheduled" | "in_progress" | "halted" | "completed" | "superseded" | "rolled_back";

export type FleetRolloutStart = { kind: "now" } | { kind: "at"; at: number };

export type FleetRolloutBatching =
  | { kind: "one" }
  | { kind: "canary"; first: number }
  | { kind: "progressive"; initial: number; multiplier: number; max: number };

/** Mirrors `config::meta::fleet::SetDesiredRequest`. */
export interface FleetSetDesiredRequest {
  config: string;
  version: number;
  start: FleetRolloutStart;
  batching: FleetRolloutBatching;
  /** The health gate runs after every phase, the last one included. */
  verify: boolean;
  auto_rollback: boolean;
}

export interface FleetPlanPreview {
  phases: number[];
  /** The first batch covers the whole fleet, so the plan is one batch. */
  collapsed: boolean;
  eligible: number;
}

export type FleetHaltClass = "proven_bad" | "looks_worse" | "cannot_see";

export type FleetHaltExit = "rollback" | "resume" | "fix_forward" | "skip";

export interface FleetRolloutHalt {
  class: FleetHaltClass;
  reason: string;
  at: number;
  /** The exits the server accepts for this halt. */
  exits: FleetHaltExit[];
}

export type FleetPhaseStatus =
  | "pending"
  | "deploying"
  | "converging"
  | "observing"
  | "verifying"
  | "done"
  | "failed"
  | "stopped"
  | "timed_out";

export interface FleetRolloutPhase {
  index: number;
  size: number;
  status: FleetPhaseStatus;
  targeted: number;
  sent: number;
  confirmed: number;
  rejected: number;
  gate: { passed: boolean; observed: string } | null;
}

export interface FleetRolloutMember {
  collector_id: string;
  phase: number;
  state: string;
  excluded: boolean;
  /** Not in the M1 contract yet; the members table falls back to the collector list without it. */
  evidence?: FleetDeliveryEvidence | null;
}

export interface FleetRolloutEvent {
  at: number;
  key: string;
  phase: number | null;
  detail: string | null;
}

export interface FleetRollout {
  id: string;
  fleet: CollectorFleet;
  config: string;
  /** Null when the members came from mixed versions or had none. */
  from_version: number | null;
  to_version: number;
  start: FleetRolloutStart;
  batching: FleetRolloutBatching;
  verify: boolean;
  auto_rollback: boolean;
  status: FleetRolloutStatus;
  halt: FleetRolloutHalt | null;
  total: number;
  running: number;
  phases: FleetRolloutPhase[];
  members: FleetRolloutMember[];
  events: FleetRolloutEvent[];
  started_by: string;
  started_at: number;
  ended_at: number | null;
}

export type FleetFlowWindow = "5m" | "1h" | "24h";

export type FleetFlowSignal = "logs" | "metrics" | "traces";

export interface FleetFlowIssue {
  kind: "export_errors" | "dropped" | "backpressure" | "receiver_refused";
  signal: FleetFlowSignal;
  value: number;
}

/** `exporter` is set only when `target` is null. */
export interface FleetFlowDestination {
  id: string;
  type: string;
  target: string | null;
  exporter: string | null;
}

/** A readable fleet; one without own-metrics telemetry still lists its stable version's pipelines. */
export interface FleetPipelineFleet {
  id: string;
  name: string;
  config: string | null;
  version: number | null;
  collectors: number;
}

export interface FleetPipelineReceiver {
  name: string;
  rate: number | null;
  /** Refused items per second over the last 5 minutes. */
  refused: number;
}

export interface FleetPipelineExporter {
  name: string;
  /** Id into `destinations`. */
  destination: string;
  rate: number | null;
  failed: number;
  dropped: number;
  queue: number | null;
}

/** One `service.pipelines` entry of one fleet; a null rate means no telemetry, 0 a measured zero. */
export interface FleetPipeline {
  id: string;
  fleet: string;
  name: string;
  signal: FleetFlowSignal;
  receivers: FleetPipelineReceiver[];
  exporters: FleetPipelineExporter[];
  in_rate: number | null;
  out_rate: number | null;
  failed_ratio: number | null;
  dropped_ratio: number | null;
  queue_ratio: number | null;
  issues: FleetFlowIssue[];
}

export interface FleetPipelines {
  window: FleetFlowWindow;
  generated_at: number;
  fleets: FleetPipelineFleet[];
  pipelines: FleetPipeline[];
  destinations: FleetFlowDestination[];
  /** True when the caller may not read some of the metric streams behind the rates. */
  metrics_restricted: boolean;
}

export interface FleetVersion {
  config: string;
  version: number;
}

export interface FleetState {
  desired: FleetVersion | null;
  /** The last version a rollout finished on, which newcomers receive. */
  stable: FleetVersion | null;
  rollout: { id: string; status: FleetRolloutStatus } | null;
  collectors: number;
  online: number;
  at_desired: number;
}

export interface Fleet {
  id: string;
  name: string;
  /** Null when the caller may list the fleet but not read it. */
  state: FleetState | null;
  settings: FleetSettings;
}

const collectorPath = (orgId: string, id: string) =>
  `/api/${orgId}/fleet/collectors/${encodeURIComponent(id)}`;

const configPath = (orgId: string, id: string) =>
  `/api/${orgId}/fleet/configs/${encodeURIComponent(id)}`;

const rolloutPath = (orgId: string, id: string) =>
  `/api/${orgId}/fleet/rollouts/${encodeURIComponent(id)}`;

const fleetPath = (orgId: string, id: string) =>
  `/api/${orgId}/fleet/fleets/${encodeURIComponent(id)}`;

const api = {
  listCollectors: (orgId: string) =>
    http().get<FleetCollectorList>(`/api/${orgId}/fleet/collectors`),
  getCollector: (orgId: string, id: string) =>
    http().get<FleetCollectorDetail>(collectorPath(orgId, id)),
  renameCollector: (orgId: string, id: string, name: string) =>
    http().patch<FleetCollector>(collectorPath(orgId, id), { name }),
  deleteCollector: (orgId: string, id: string) => http().delete(collectorPath(orgId, id)),
  restartCollector: (orgId: string, id: string) =>
    http().post<{ queued: boolean }>(`${collectorPath(orgId, id)}/restart`),
  redeliverCollector: (orgId: string, id: string) =>
    http().post<{ revision: number }>(`${collectorPath(orgId, id)}/redeliver`),
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
    http().get<{ items: FleetRollout[]; total?: number }>(`/api/${orgId}/fleet/rollouts`),
  getRollout: (orgId: string, id: string) => http().get<FleetRollout>(rolloutPath(orgId, id)),
  resumeRollout: (orgId: string, id: string) =>
    http().post<FleetRollout>(`${rolloutPath(orgId, id)}/resume`),
  skipRollout: (orgId: string, id: string, collectorIds: string[]) =>
    http().post<FleetRollout>(`${rolloutPath(orgId, id)}/skip`, { collector_ids: collectorIds }),
  rollbackRollout: (orgId: string, id: string) =>
    http().post<FleetRollout>(`${rolloutPath(orgId, id)}/rollback`),
  listFleets: (orgId: string) =>
    http().get<{ items: Fleet[]; total?: number }>(`/api/${orgId}/fleet/fleets`),
  createFleet: (orgId: string, name: string) =>
    http().post<Fleet>(`/api/${orgId}/fleet/fleets`, { name }),
  renameFleet: (orgId: string, id: string, name: string) =>
    http().patch<Fleet>(fleetPath(orgId, id), { name }),
  deleteFleet: (orgId: string, id: string) => http().delete(fleetPath(orgId, id)),
  moveCollectors: (orgId: string, collectorIds: string[], toFleet: string) =>
    http().post<{ moved: number }>(`/api/${orgId}/fleet/fleets/move`, {
      collector_ids: collectorIds,
      to_fleet: toFleet,
    }),
  getFleetSettings: (orgId: string, id: string) =>
    http().get<FleetSettings>(`${fleetPath(orgId, id)}/settings`),
  updateFleetSettings: (orgId: string, id: string, body: FleetSettings) =>
    http().put<FleetSettings>(`${fleetPath(orgId, id)}/settings`, body),
  setDesired: (orgId: string, fleetId: string, body: FleetSetDesiredRequest) =>
    http().put<FleetRollout>(`${fleetPath(orgId, fleetId)}/desired`, body),
  previewDesired: (orgId: string, fleetId: string, body: FleetSetDesiredRequest) =>
    http().post<FleetPlanPreview>(`${fleetPath(orgId, fleetId)}/desired/preview`, body),
  getPipelines: (orgId: string, window: FleetFlowWindow) =>
    http().get<FleetPipelines>(`/api/${orgId}/fleet/pipelines`, { params: { window } }),
  getSettings: (orgId: string) => http().get<FleetOrgSettings>(`/api/${orgId}/fleet/settings`),
  updateSettings: (orgId: string, body: FleetOrgSettings) =>
    http().put<FleetOrgSettings>(`/api/${orgId}/fleet/settings`, body),
};

/** Every call resolves to `{ data }`, which is all the query layer reads. */
export type FleetApi = {
  [K in keyof typeof api]: (
    ...args: Parameters<(typeof api)[K]>
  ) => Promise<{ data: Awaited<ReturnType<(typeof api)[K]>>["data"] }>;
};

const fleet: FleetApi = FLEET_MOCK ? fleetMock : api;

export default fleet;
