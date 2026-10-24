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

import { computed } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  collectorsInFlight,
  fleetAuditQuery,
  fleetCollectorMetricsQuery,
  fleetCollectorQuery,
  fleetCollectorsQuery,
  fleetConfigQuery,
  fleetConfigsQuery,
  fleetConfigVersionQuery,
  fleetFlowQuery,
  fleetPlanPreviewQuery,
  fleetsQuery,
  fleetRolloutQuery,
  fleetRolloutsQuery,
  fleetSettingsOfQuery,
  fleetSettingsQuery,
  fleetSummaryQuery,
  fleetTokensQuery,
} from "@/services/fleet.queries";
import type {
  FleetCollector,
  FleetCollectorDetail,
  FleetCollectorEvent,
  FleetCollectorStatus,
  FleetConfigItem,
  FleetDeliveryEvidence,
  FleetDeliveryState,
  FleetFlowWindow,
  Fleet,
  FleetHaltExit,
  FleetRollout,
  FleetRolloutBatching,
  FleetRolloutHalt,
  FleetRolloutPhase,
  FleetRolloutStart,
  FleetRolloutStatus,
  FleetSetDesiredRequest,
  FleetSettings,
  FleetToken,
} from "@/services/fleet";
import { OS_LABEL, type FleetOs } from "./fleetFormat";

export interface CollectorRow {
  id: string;
  name: string;
  hostname: string | null;
  status: FleetCollectorStatus;
  os: string | null;
  arch: string | null;
  distribution: string | null;
  version: string | null;
  outdated: boolean;
  lastConnectedFrom: string | null;
  config: string | null;
  configVersion: number | null;
  delivery: FleetDeliveryState | null;
  deliveryError: string | null;
  fleetId: string;
  fleetName: string;
  tokenId: string | null;
  lastSeen: number;
  enrolledAt: number;
}

export interface ComponentHealthRow {
  id: string;
  status: "healthy" | "degraded" | "unknown";
  lastError: string;
}

export interface CollectorDetailView extends CollectorRow {
  capabilities: string[];
  /** False when the collector has never sent a health report. */
  healthReported: boolean;
  healthError: string;
  components: ComponentHealthRow[];
  effectiveConfig: { yaml: string; reportedAt: number | null } | null;
  assignment: { fleet: string; config: string; version: number; revision: number } | null;
  evidence: FleetDeliveryEvidence | null;
  history: FleetCollectorEvent[];
}

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  expiresAt: number | null;
  uses: number;
  maxUses: number | null;
  fleetId: string;
  /** Null once the fleet was deleted. */
  fleetName: string | null;
  revoked: boolean;
  token: string | null;
}

export type TokenState = "active" | "expired" | "exhausted" | "revoked";

export interface ConfigRow {
  id: string;
  /** The id; the list sorts and searches on `name`. */
  name: string;
  description: string;
  /** The latest published version, 0 before the first publish. */
  version: number;
  liveVersion: number | null;
  collectors: number;
  /** The readable fleets whose desired or stable version is this configuration; a null name is a deleted fleet. */
  fleets: { id: string; name: string | null }[];
  /** Referencing fleets the caller cannot read. */
  fleetsHidden: number;
  updatedAt: number;
  updatedBy: string;
}

export interface RolloutRow {
  id: string;
  config: string;
  fromVersion: number | null;
  toVersion: number;
  fleetId: string;
  /** Null once the fleet was deleted. */
  fleetName: string | null;
  start: FleetRolloutStart;
  batching: FleetRolloutBatching;
  verify: boolean;
  autoRollback: boolean;
  status: FleetRolloutStatus;
  halt: FleetRolloutHalt | null;
  total: number;
  running: number;
  phases: FleetRolloutPhase[];
  members: {
    collectorId: string;
    phase: number;
    state: string;
    excluded: boolean;
    evidence: FleetDeliveryEvidence | null;
  }[];
  events: { at: number; key: string; phase: number | null; detail: string | null }[];
  startedBy: string;
  startedAt: number;
  endedAt: number | null;
}

export interface FleetRow {
  id: string;
  name: string;
  /** False when the caller may list the fleet but not read its state. */
  readable: boolean;
  desired: { config: string; version: number } | null;
  stable: { config: string; version: number } | null;
  rollout: { id: string; status: FleetRolloutStatus } | null;
  collectors: number;
  online: number;
  atDesired: number;
  settings: FleetSettings;
}

export const NO_OVERRIDES: FleetSettings = {
  heartbeat_interval_secs: null,
  offline_heartbeats: null,
  retention_days: null,
  offline_ratio_percent: null,
  phase_timeout_secs: null,
  gate: null,
};

export const HALT_EXITS: FleetHaltExit[] = ["rollback", "resume", "fix_forward", "skip"];

const ACTIVE_ROLLOUT: FleetRolloutStatus[] = ["halted", "in_progress", "scheduled"];

const ENV_REF = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

// A route query cannot carry a whole file, so the list hands an imported YAML to the editor here.
let pendingImport: string | null = null;

export function toCollectorRow(c: FleetCollector): CollectorRow {
  return {
    id: c.id,
    name: c.name || c.hostname || c.id,
    hostname: c.hostname ?? null,
    status: c.status ?? "unknown",
    os: c.os ?? null,
    arch: c.arch ?? null,
    distribution: c.distribution ?? null,
    version: c.version ?? null,
    outdated: !!c.outdated,
    lastConnectedFrom: c.last_connected_from ?? null,
    config: c.config ?? null,
    configVersion: c.config_version ?? null,
    delivery: c.delivery ?? null,
    deliveryError: c.delivery_error ?? null,
    fleetId: c.fleet?.id ?? "default",
    fleetName: c.fleet?.name ?? c.fleet?.id ?? "default",
    tokenId: c.token_id ?? null,
    lastSeen: c.last_seen,
    enrolledAt: c.enrolled_at,
  };
}

export function toCollectorDetail(d: FleetCollectorDetail): CollectorDetailView {
  const row = toCollectorRow(d);
  return {
    ...row,
    capabilities: d.capabilities ?? [],
    healthReported: !!d.health,
    healthError: d.health?.last_error ?? "",
    components: (d.health?.components ?? []).map((c) => ({
      id: c.id,
      // An offline collector's last health report is stale, so it says nothing about now.
      status: row.status === "offline" ? "unknown" : c.healthy ? "healthy" : "degraded",
      lastError: c.last_error ?? "",
    })),
    effectiveConfig: d.effective_config
      ? { yaml: d.effective_config, reportedAt: d.effective_reported_at ?? null }
      : null,
    assignment: d.assignment ?? null,
    evidence: d.evidence ?? null,
    history: [...(d.history ?? [])].sort((a, b) => b.at - a.at),
  };
}

export function toRolloutRow(r: FleetRollout): RolloutRow {
  return {
    id: r.id,
    config: r.config,
    fromVersion: r.from_version ?? null,
    toVersion: r.to_version,
    fleetId: r.fleet?.id ?? "",
    fleetName: r.fleet?.name ?? null,
    start: r.start ?? { kind: "now" },
    batching: r.batching ?? { kind: "one" },
    verify: !!r.verify,
    autoRollback: !!r.auto_rollback,
    status: r.status,
    halt: r.halt ?? null,
    total: r.total ?? 0,
    running: r.running ?? 0,
    phases: r.phases ?? [],
    members: (r.members ?? []).map((m) => ({
      collectorId: m.collector_id,
      phase: m.phase,
      state: m.state,
      excluded: !!m.excluded,
      evidence: m.evidence ?? null,
    })),
    events: (r.events ?? []).map((e) => ({
      at: e.at,
      key: e.key,
      phase: e.phase ?? null,
      detail: e.detail ?? null,
    })),
    startedBy: r.started_by,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? null,
  };
}

export function toTokenRow(t: FleetToken): TokenRow {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    createdAt: t.created_at,
    expiresAt: t.expires_at ?? null,
    uses: t.uses ?? 0,
    maxUses: t.max_uses ?? null,
    fleetId: t.fleet?.id ?? "default",
    fleetName: t.fleet ? t.fleet.name : "default",
    revoked: !!t.revoked,
    token: t.token ?? null,
  };
}

export function toConfigRow(c: FleetConfigItem): ConfigRow {
  return {
    id: c.id,
    name: c.id,
    description: c.description ?? "",
    version: c.latest_version ?? 0,
    liveVersion: c.live_version ?? null,
    collectors: c.collectors ?? 0,
    fleets: c.fleets ?? [],
    fleetsHidden: c.fleets_hidden ?? 0,
    updatedAt: c.updated_at,
    updatedBy: c.updated_by ?? "",
  };
}

export function toFleetRow(f: Fleet): FleetRow {
  const s = f.state ?? null;
  return {
    id: f.id,
    name: f.name,
    readable: s !== null,
    desired: s?.desired ?? null,
    stable: s?.stable ?? null,
    rollout: s?.rollout ?? null,
    collectors: s?.collectors ?? 0,
    online: s?.online ?? 0,
    atDesired: s?.at_desired ?? 0,
    settings: { ...NO_OVERRIDES, ...(f.settings ?? {}) },
  };
}

export function envVariables(yaml: string): string[] {
  return [...new Set(Array.from(yaml.matchAll(ENV_REF), (m) => m[1]))].sort();
}

export function setPendingImport(text: string) {
  pendingImport = text;
}

export function takePendingImport(): string | null {
  const text = pendingImport;
  pendingImport = null;
  return text;
}

export function tokenState(
  t: Pick<TokenRow, "revoked" | "expiresAt" | "uses" | "maxUses">,
  now: number,
): TokenState {
  if (t.revoked) return "revoked";
  if (t.expiresAt !== null && t.expiresAt <= now) return "expired";
  return t.maxUses !== null && t.uses >= t.maxUses ? "exhausted" : "active";
}

export const TOKEN_EXPIRY_WARN_DAYS = 7;
const DAY_MS = 86_400_000;

/** A live token whose expiry is within the warning window; an expired one is not "soon". */
export function tokenExpiresSoon(t: Pick<TokenRow, "revoked" | "expiresAt">, now: number): boolean {
  return (
    !t.revoked &&
    t.expiresAt !== null &&
    t.expiresAt > now &&
    t.expiresAt <= now + TOKEN_EXPIRY_WARN_DAYS * DAY_MS
  );
}

export function osLabel(os: string | null): string | null {
  if (!os) return null;
  return OS_LABEL[os as FleetOs] ?? os;
}

/** The `message` of the server's `{code, message}` error body, when it sent one. */
export function serverMessage(err: unknown): string | null {
  const msg = (err as { response?: { data?: { message?: unknown } } } | null)?.response?.data
    ?.message;
  return typeof msg === "string" && msg ? msg : null;
}

export function isForbidden(err: unknown): boolean {
  const e = err as { status?: number; response?: { status?: number } } | null;
  return e?.status === 403 || e?.response?.status === 403;
}

export function isNotFound(err: unknown): boolean {
  const e = err as { status?: number; response?: { status?: number } } | null;
  return e?.status === 404 || e?.response?.status === 404;
}

export function rolloutTagValue(r: { status: string; total: number }): string {
  return r.status === "completed" && r.total === 0 ? "empty" : r.status;
}

/** Members this rollout moved to the new version, excluded ones left out. */
export function rolloutConfirmed(r: Pick<RolloutRow, "phases">): number {
  return r.phases.reduce((sum, p) => sum + p.confirmed, 0);
}

export function rolloutRejected(r: Pick<RolloutRow, "phases">): number {
  return r.phases.reduce((sum, p) => sum + p.rejected, 0);
}

/** The collectors the halt can be skipped past: members that rejected or failed, not yet excluded. */
export function failingMembers(r: Pick<RolloutRow, "members">): string[] {
  return r.members
    .filter((m) => !m.excluded && (m.state === "rejected" || m.state === "failed"))
    .map((m) => m.collectorId);
}

export function isActiveRollout(r: RolloutRow): boolean {
  return ACTIVE_ROLLOUT.includes(r.status);
}

export function byActiveThenNewest(a: RolloutRow, b: RolloutRow): number {
  return Number(isActiveRollout(b)) - Number(isActiveRollout(a)) || b.startedAt - a.startedAt;
}

// The query's own fast poll still wins while something moves; the floor applies only when it is idle.
function orPoll<Q>(
  own: number | false | ((query: Q) => number | false | undefined) | undefined,
  pollMs?: number,
) {
  if (!pollMs) return own;
  return (query: Q) => (typeof own === "function" ? own(query) : own) || pollMs;
}

export function useFleetCollectors(active: () => boolean = () => true, pollMs?: number) {
  const orgId = useOrgId();
  const query = useQuery(() => {
    const options = fleetCollectorsQuery(orgId.value);
    return Object.assign(options, {
      enabled: !!orgId.value && active(),
      refetchInterval: orPoll(options.refetchInterval, pollMs),
    });
  });
  // A 403 means access was revoked, so cached rows must not stay on screen.
  return {
    rows: computed(() =>
      isForbidden(query.error.value) ? [] : (query.data.value ?? []).map(toCollectorRow),
    ),
    loading: query.isPending,
    fetching: query.isFetching,
    error: query.error,
    lastUpdatedAt: query.dataUpdatedAt,
    refetch: () => query.refetch(),
  };
}

export function useFleetSummary(pollMs?: number) {
  const orgId = useOrgId();
  // A disabled observer fetches nothing; it only makes the list cache reactive for the summary's poll.
  const collectors = useQuery(() =>
    Object.assign(fleetCollectorsQuery(orgId.value), { enabled: false }),
  );
  const query = useQuery(() => {
    const options = fleetSummaryQuery(orgId.value, collectorsInFlight(collectors.data.value));
    const poll = orPoll(options.refetchInterval, pollMs);
    return Object.assign(options, {
      enabled: !!orgId.value,
      // A 403 will not change on its own, so only a manual retry reads again.
      refetchInterval: (
        q: Parameters<Extract<typeof options.refetchInterval, (...args: never[]) => unknown>>[0],
      ) => (isForbidden(q.state.error) ? false : typeof poll === "function" ? poll(q) : poll),
    });
  });
  return {
    summary: computed(() => (isForbidden(query.error.value) ? null : (query.data.value ?? null))),
    loading: query.isPending,
    fetching: query.isFetching,
    error: query.error,
    lastUpdatedAt: query.dataUpdatedAt,
    refetch: () => query.refetch(),
  };
}

export function useFleetCollector(id: () => string | null, active: () => boolean) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetCollectorQuery(orgId.value, id() ?? ""), {
      enabled: !!orgId.value && !!id() && active(),
    }),
  );
  return {
    detail: computed(() =>
      query.data.value && !isForbidden(query.error.value)
        ? toCollectorDetail(query.data.value)
        : null,
    ),
    loading: query.isPending,
    error: query.error,
    refetch: () => query.refetch(),
  };
}

export function useFleetTokens(active: () => boolean = () => true) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetTokensQuery(orgId.value), { enabled: !!orgId.value && active() }),
  );
  return {
    rows: computed(() =>
      isForbidden(query.error.value) ? [] : (query.data.value ?? []).map(toTokenRow),
    ),
    loading: query.isPending,
    fetching: query.isFetching,
    error: query.error,
    lastUpdatedAt: query.dataUpdatedAt,
    refetch: () => query.refetch(),
  };
}

export function useFleetConfigs(active: () => boolean = () => true, pollMs?: number) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetConfigsQuery(orgId.value), {
      enabled: !!orgId.value && active(),
      refetchInterval: pollMs ?? false,
    }),
  );
  return {
    rows: computed(() =>
      isForbidden(query.error.value) ? [] : (query.data.value ?? []).map(toConfigRow),
    ),
    forbidden: computed(() => isForbidden(query.error.value)),
    loading: query.isPending,
    error: query.error,
    refetch: () => query.refetch(),
  };
}

export function useFleetConfig(id: () => string, active: () => boolean) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetConfigQuery(orgId.value, id()), {
      enabled: !!orgId.value && !!id() && active(),
    }),
  );
  return {
    detail: computed(() => (isForbidden(query.error.value) ? null : (query.data.value ?? null))),
    error: query.error,
    refetch: () => query.refetch(),
  };
}

export function useFleetConfigVersion(
  id: () => string,
  version: () => number | null,
  active: () => boolean,
) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetConfigVersionQuery(orgId.value, id(), version() ?? 0), {
      enabled: !!orgId.value && !!id() && (version() ?? 0) > 0 && active(),
    }),
  );
  return {
    version: computed(() => (isForbidden(query.error.value) ? null : (query.data.value ?? null))),
    error: query.error,
    refetch: () => query.refetch(),
  };
}

export function useFleetAudit() {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetAuditQuery(orgId.value), { enabled: !!orgId.value }),
  );
  return {
    rows: computed(() => (isForbidden(query.error.value) ? [] : (query.data.value?.items ?? []))),
    disabled: computed(() => !!query.data.value?.audit_disabled),
    loading: query.isPending,
    fetching: query.isFetching,
    lastUpdatedAt: query.dataUpdatedAt,
    error: query.error,
    refetch: () => query.refetch(),
  };
}

/** A 403 gives null settings and `forbidden`, so a revoked user never keeps the cached values. */
export function useFleetSettings() {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetSettingsQuery(orgId.value), { enabled: !!orgId.value }),
  );
  return {
    settings: computed(() => (isForbidden(query.error.value) ? null : (query.data.value ?? null))),
    forbidden: computed(() => isForbidden(query.error.value)),
    loading: query.isPending,
    error: query.error,
    refetch: () => query.refetch(),
  };
}

export function useFleetRollouts(pollMs?: number, active: () => boolean = () => true) {
  const orgId = useOrgId();
  const query = useQuery(() => {
    const options = fleetRolloutsQuery(orgId.value);
    return Object.assign(options, {
      enabled: !!orgId.value && active(),
      refetchInterval: orPoll(options.refetchInterval, pollMs),
    });
  });
  return {
    rows: computed(() =>
      isForbidden(query.error.value) ? [] : (query.data.value ?? []).map(toRolloutRow),
    ),
    loading: query.isPending,
    error: query.error,
    refetch: () => query.refetch(),
  };
}

/** A 403 gives a null flow and `forbidden`, so a revoked user never keeps the cached map. */
export function useFleetFlow(window: () => FleetFlowWindow) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetFlowQuery(orgId.value, window()), { enabled: !!orgId.value }),
  );
  return {
    flow: computed(() => (isForbidden(query.error.value) ? null : (query.data.value ?? null))),
    forbidden: computed(() => isForbidden(query.error.value)),
    loading: query.isPending,
    fetching: query.isFetching,
    lastUpdatedAt: query.dataUpdatedAt,
    error: query.error,
    refetch: () => query.refetch(),
  };
}

export function useFleetCollectorMetrics(id: () => string, window: () => FleetFlowWindow) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetCollectorMetricsQuery(orgId.value, id(), window()), {
      enabled: !!orgId.value && !!id(),
      placeholderData: keepPreviousData,
    }),
  );
  return {
    values: computed(() => (query.error.value ? null : (query.data.value ?? null))),
    forbidden: computed(() => isForbidden(query.error.value)),
    loading: query.isPending,
    error: query.error,
    refetch: () => query.refetch(),
  };
}

export function useFleetRollout(id: () => string | null, active: () => boolean) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetRolloutQuery(orgId.value, id() ?? ""), {
      enabled: !!orgId.value && !!id() && active(),
    }),
  );
  // A 403 or 404 means the rollout is gone for this caller, so the cached detail must not stay on screen.
  const gone = computed(() => isForbidden(query.error.value) || isNotFound(query.error.value));
  return {
    detail: computed(() =>
      query.data.value && !gone.value ? toRolloutRow(query.data.value) : null,
    ),
    error: query.error,
    refetch: () => query.refetch(),
  };
}

export function useFleets(active: () => boolean = () => true) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetsQuery(orgId.value), { enabled: !!orgId.value && active() }),
  );
  return {
    rows: computed(() =>
      isForbidden(query.error.value) ? [] : (query.data.value ?? []).map(toFleetRow),
    ),
    loading: query.isPending,
    error: query.error,
    refetch: () => query.refetch(),
  };
}

export function useFleetSettingsOf(id: () => string | null, active: () => boolean = () => true) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(fleetSettingsOfQuery(orgId.value, id() ?? ""), {
      enabled: !!orgId.value && !!id() && active(),
    }),
  );
  return {
    settings: computed(() => (isForbidden(query.error.value) ? null : (query.data.value ?? null))),
    forbidden: computed(() => isForbidden(query.error.value)),
    loading: query.isPending,
    error: query.error,
    refetch: () => query.refetch(),
  };
}

/** The server's plan for a desired change; null body means nothing valid to preview yet. */
export function usePlanPreview(
  fleetId: () => string | null,
  body: () => FleetSetDesiredRequest | null,
  active: () => boolean,
) {
  const orgId = useOrgId();
  const placeholder: FleetSetDesiredRequest = {
    config: "",
    version: 0,
    start: { kind: "now" },
    batching: { kind: "one" },
    verify: false,
    auto_rollback: false,
  };
  const query = useQuery(() =>
    Object.assign(fleetPlanPreviewQuery(orgId.value, fleetId() ?? "", body() ?? placeholder), {
      enabled: !!orgId.value && !!fleetId() && !!body() && active(),
      placeholderData: keepPreviousData,
    }),
  );
  return {
    preview: computed(() => (body() ? (query.data.value ?? null) : null)),
    fetching: query.isFetching,
    error: query.error,
  };
}
