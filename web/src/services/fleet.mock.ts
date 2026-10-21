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

import type {
  Fleet,
  FleetApi,
  FleetAuditEvent,
  FleetCollector,
  FleetCollectorDetail,
  FleetConfigDetail,
  FleetCreatedToken,
  FleetDefaults,
  FleetPipelines,
  FleetPipeline,
  FleetOrgSettings,
  FleetPlanPreview,
  FleetRollout,
  FleetSetDesiredRequest,
  FleetSettings,
  FleetToken,
} from "./fleet";

/** The one switch for the in-memory Fleet backend; delete this file once the server serves every endpoint. */
export const FLEET_MOCK = import.meta.env.VITE_FLEET_MOCK === "true";

const DAY = 86_400_000;
const NOW = Date.now();
const LATENCY_MS = 150;

const INHERIT: FleetSettings = {
  heartbeat_interval_secs: null,
  offline_heartbeats: null,
  retention_days: null,
  offline_ratio_percent: null,
  phase_timeout_secs: null,
  gate: null,
};

const DEFAULTS: FleetDefaults = {
  heartbeat_interval_secs: 30,
  offline_heartbeats: 3,
  retention_days: 30,
  offline_ratio_percent: 20,
  phase_timeout_secs: 1800,
  gate: { observe_secs: 600, window_secs: 300, pass_percent: 95 },
};

const BASE_YAML = `receivers:
  hostmetrics:
    collection_interval: 30s
  filelog:
    include: /var/log/*.log
exporters:
  otlphttp/openobserve:
    endpoint: \${env:O2_ENDPOINT}
    headers:
      Authorization: "Basic \${env:O2_TOKEN}"
service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      exporters: [otlphttp/openobserve]
    logs:
      receivers: [filelog]
      exporters: [otlphttp/openobserve]
`;

const SYSTEM_YAML = `extensions:
  opamp:
    server:
      ws:
        endpoint: wss://o2.example.com/api/default/v1/opamp
service:
  telemetry:
    resource:
      attributes:
        - name: openobserve.fleet.config_id
          value: base-linux
`;

interface Store {
  fleets: Fleet[];
  collectors: FleetCollector[];
  configs: FleetConfigDetail[];
  tokens: FleetToken[];
  rollouts: FleetRollout[];
  audit: FleetAuditEvent[];
  settings: FleetOrgSettings;
  seq: number;
}

const store: Store = seed();

/** The engine's batching rule, mirrored so the mock preview and the mock rollouts agree. */
export function planPhases(
  batching: FleetSetDesiredRequest["batching"],
  eligible: number,
): { phases: number[]; collapsed: boolean } {
  if (eligible <= 0) return { phases: [], collapsed: false };
  if (batching.kind === "one") return { phases: [eligible], collapsed: false };
  const first = batching.kind === "canary" ? batching.first : batching.initial;
  if (first >= eligible) return { phases: [eligible], collapsed: true };
  const phases: number[] = [];
  let left = eligible;
  let size = first;
  while (left > 0 && phases.length < 99) {
    const take = Math.min(size, left);
    phases.push(take);
    left -= take;
    size =
      batching.kind === "canary"
        ? left
        : Math.min(size * Math.max(batching.multiplier, 1), batching.max);
  }
  if (left > 0) phases.push(left);
  const last = phases.length - 1;
  if (last > 0 && phases[last] < phases[last - 1] * 0.25) {
    phases[last - 1] += phases[last];
    phases.pop();
  }
  return { phases, collapsed: false };
}

function seed(): Store {
  const fleets: Fleet[] = [
    fleetOf("default", { config: "base-linux", version: 3 }, null),
    fleetOf("prod-linux", { config: "base-linux", version: 4 }, "r-halted"),
    fleetOf("edge-k8s", { config: "k8s-node", version: 2 }, "r-progress"),
    fleetOf("staging", null, null),
  ];
  const collectors: FleetCollector[] = [];
  const plan: [string, number, string, number][] = [
    ["default", 6, "base-linux", 3],
    ["prod-linux", 24, "base-linux", 3],
    ["edge-k8s", 12, "k8s-node", 1],
    ["staging", 2, "", 0],
  ];
  for (const [fleet, count, config, version] of plan) {
    for (let i = 0; i < count; i++) collectors.push(collectorOf(fleet, i, config, version));
  }
  const configs: FleetConfigDetail[] = [
    configOf("base-linux", "Host metrics and system logs", 4),
    configOf("k8s-node", "Kubelet stats and pod logs", 2),
    configOf("debug-tail", "Prints everything to the collector log", 1),
  ];
  configs[0].fleets_hidden = 1;
  const tokens: FleetToken[] = fleets.map((f, i) => ({
    id: `tok-${f.id}`,
    name: `${f.name}-install`,
    prefix: `o2ft_${f.id.slice(0, 4)}`,
    created_at: NOW - (i + 3) * DAY,
    expires_at: i === 3 ? NOW - DAY : NOW + 60 * DAY,
    uses: collectors.filter((c) => c.fleet.id === f.id).length,
    max_uses: i === 0 ? null : 100,
    fleet: { id: f.id, name: f.name },
    revoked: false,
  }));
  const s: Store = {
    fleets,
    collectors,
    configs,
    tokens,
    rollouts: [],
    audit: [],
    settings: {
      target_collector_version: "0.163.1",
      restricted_components: ["debug"],
      fleet_defaults: DEFAULTS,
    },
    seq: 1,
  };
  s.rollouts.push(haltedRollout(s), progressRollout(s));
  s.audit.push({
    id: "a0",
    at: NOW - DAY,
    actor: "root@example.com",
    action: "fleet.audit.setDesired",
    target: "prod-linux",
    outcome: "success",
  });
  return s;
}

function fleetOf(
  id: string,
  desired: { config: string; version: number } | null,
  rollout: string | null,
): Fleet {
  const stable = desired && rollout ? { ...desired, version: desired.version - 1 } : desired;
  return {
    id,
    name: id,
    state: {
      desired,
      stable,
      rollout: rollout
        ? { id: rollout, status: rollout === "r-halted" ? "halted" : "in_progress" }
        : null,
      collectors: 0,
      online: 0,
      at_desired: 0,
    },
    settings: id === "prod-linux" ? { ...INHERIT, phase_timeout_secs: 900 } : { ...INHERIT },
  };
}

function collectorOf(fleet: string, i: number, config: string, version: number): FleetCollector {
  const k8s = fleet === "edge-k8s";
  const host = k8s ? `node-${fleet}-${i}` : `${fleet}-host-${String(i + 1).padStart(2, "0")}`;
  const status = i === 3 ? "offline" : i === 5 ? "degraded" : i === 7 ? "unknown" : "online";
  const delivery = i === 9 ? "rejected" : i === 8 ? "accepted" : "running";
  return {
    id: `0192${String(fleet.length).padStart(2, "0")}${String(i).padStart(2, "0")}-7c1e-4b9a-9d2f-${fleet.padEnd(12, "0").slice(0, 12)}`,
    name: i === 0 ? `${fleet}-primary` : host,
    hostname: host,
    os: k8s ? "kubernetes" : i % 9 === 4 ? "macos" : "linux",
    arch: i % 4 === 2 ? "arm64" : "amd64",
    distribution: k8s ? null : "Ubuntu 24.04",
    version: i % 6 === 1 ? "0.150.0" : "0.163.1",
    outdated: i % 6 === 1,
    status,
    last_connected_from: `10.0.${fleet.length}.${10 + i}`,
    fleet: { id: fleet, name: fleet },
    token_id: `tok-${fleet}`,
    last_seen: status === "offline" ? NOW - 2 * DAY : NOW - 20_000,
    enrolled_at: NOW - 10 * DAY + i * 3_600_000,
    config: config || null,
    config_version: config ? version : null,
    delivery: config ? delivery : null,
    delivery_error: config && i === 9 ? "exporters::otlphttp: unknown field 'endpiont'" : null,
  };
}

function configOf(id: string, description: string, versions: number): FleetConfigDetail {
  return {
    id,
    description,
    latest_version: versions,
    live_version: versions > 1 ? versions - 1 : null,
    collectors: 0,
    fleets: [],
    updated_at: NOW - DAY,
    updated_by: "root@example.com",
    draft: { yaml: BASE_YAML, by: "root@example.com", at: NOW - DAY },
    versions: Array.from({ length: versions }, (_, i) => ({
      version: versions - i,
      author: "root@example.com",
      at: NOW - (i + 1) * DAY,
      message: `Version ${versions - i}`,
      live: i === 1,
      state: i === 1 ? null : "published",
    })),
  };
}

function membersOf(s: Store, fleet: string, phases: number[]) {
  const ids = s.collectors.filter((c) => c.fleet.id === fleet).map((c) => c.id);
  let at = 0;
  return phases.flatMap((size, phase) => {
    const slice = ids.slice(at, at + size);
    at += size;
    return slice.map((collector_id) => ({
      collector_id,
      phase,
      state: "pending",
      excluded: false,
      evidence: {
        remote_status: phase === 0 ? "APPLIED" : null,
        remote_hash: phase === 0 ? "9f2c1a7e" : null,
        remote_at: phase === 0 ? NOW - 600_000 : null,
        marker: null,
        last_heartbeat_at: NOW - 20_000,
      },
    }));
  });
}

function haltedRollout(s: Store): FleetRollout {
  const phases = [3, 9, 12];
  const members = membersOf(s, "prod-linux", phases).map((m, i) => ({
    ...m,
    state: m.phase === 0 ? (i === 1 ? "rejected" : "running") : "pending",
  }));
  return {
    id: "r-halted",
    fleet: { id: "prod-linux", name: "prod-linux" },
    config: "base-linux",
    from_version: 3,
    to_version: 4,
    start: { kind: "now" },
    batching: { kind: "progressive", initial: 3, multiplier: 3, max: 50 },
    verify: true,
    auto_rollback: false,
    status: "halted",
    halt: {
      class: "proven_bad",
      reason: "1 collector rejected the configuration: unknown field 'endpiont'",
      at: NOW - 3_600_000,
      exits: ["rollback", "fix_forward", "skip"],
    },
    total: 24,
    running: 2,
    phases: phases.map((size, index) => ({
      index,
      size,
      status: index === 0 ? "failed" : "pending",
      targeted: index === 0 ? size : 0,
      sent: index === 0 ? size : 0,
      confirmed: index === 0 ? 2 : 0,
      rejected: index === 0 ? 1 : 0,
      gate: null,
    })),
    members,
    events: [
      { at: NOW - 4_000_000, key: "started", phase: null, detail: null },
      { at: NOW - 3_900_000, key: "deploying", phase: 0, detail: null },
      { at: NOW - 3_600_000, key: "rejected", phase: 0, detail: "unknown field 'endpiont'" },
      { at: NOW - 3_600_000, key: "halted", phase: 0, detail: null },
    ],
    started_by: "root@example.com",
    started_at: NOW - 4_000_000,
    ended_at: null,
  };
}

function progressRollout(s: Store): FleetRollout {
  const phases = [2, 4, 6];
  const members = membersOf(s, "edge-k8s", phases).map((m) => ({
    ...m,
    state: m.phase === 0 ? "running" : m.phase === 1 ? "sent" : "pending",
  }));
  return {
    id: "r-progress",
    fleet: { id: "edge-k8s", name: "edge-k8s" },
    config: "k8s-node",
    from_version: 1,
    to_version: 2,
    start: { kind: "now" },
    batching: { kind: "progressive", initial: 2, multiplier: 2, max: 10 },
    verify: true,
    auto_rollback: true,
    status: "in_progress",
    halt: null,
    total: 12,
    running: 2,
    phases: phases.map((size, index) => ({
      index,
      size,
      status: index === 0 ? "done" : index === 1 ? "converging" : "pending",
      targeted: index < 2 ? size : 0,
      sent: index < 2 ? size : 0,
      confirmed: index === 0 ? size : 0,
      rejected: 0,
      gate: index === 0 ? { passed: true, observed: "100% healthy" } : null,
    })),
    members,
    events: [
      { at: NOW - 1_500_000, key: "started", phase: null, detail: null },
      { at: NOW - 1_400_000, key: "deploying", phase: 0, detail: null },
      { at: NOW - 900_000, key: "gatePassed", phase: 0, detail: "100% healthy" },
      { at: NOW - 300_000, key: "deploying", phase: 1, detail: null },
    ],
    started_by: "root@example.com",
    started_at: NOW - 1_500_000,
    ended_at: null,
  };
}

function refreshDerived() {
  for (const f of store.fleets) {
    const state = f.state;
    if (!state) continue;
    const members = store.collectors.filter((c) => c.fleet.id === f.id);
    const desired = state.desired;
    state.collectors = members.length;
    state.online = members.filter((c) => c.status === "online" || c.status === "degraded").length;
    state.at_desired = members.filter(
      (c) => !!desired && c.config === desired.config && c.config_version === desired.version,
    ).length;
  }
  for (const c of store.configs) {
    const using = store.fleets.filter(
      (f) => f.state?.desired?.config === c.id || f.state?.stable?.config === c.id,
    );
    c.fleets = using.map((f) => ({ id: f.id, name: f.name }));
    c.collectors = store.collectors.filter((x) => x.config === c.id).length;
  }
}

function reply<T>(data: T): Promise<{ data: T }> {
  refreshDerived();
  const copy = data === undefined ? data : (JSON.parse(JSON.stringify(data)) as T);
  return new Promise((resolve) => setTimeout(() => resolve({ data: copy }), LATENCY_MS));
}

function fail(status: number, message: string, extra: Record<string, unknown> = {}) {
  const err = Object.assign(new Error(message), {
    status,
    response: { status, data: { code: status, message, ...extra } },
  });
  return new Promise<never>((_, reject) => setTimeout(() => reject(err), LATENCY_MS));
}

function audit(action: string, target: string) {
  store.audit.unshift({
    id: `a${store.seq++}`,
    at: Date.now(),
    actor: "root@example.com",
    action,
    target,
    outcome: "success",
  });
}

function findCollector(id: string) {
  return store.collectors.find((c) => c.id === id);
}

function detailOf(c: FleetCollector): FleetCollectorDetail {
  const unhealthy = c.status === "degraded";
  return {
    ...c,
    capabilities: [
      "AcceptsRemoteConfig",
      "ReportsEffectiveConfig",
      "ReportsHealth",
      "ReportsOwnMetrics",
      "AcceptsRestartCommand",
    ],
    health: {
      healthy: !unhealthy,
      status: unhealthy ? "StatusRecoverableError" : "StatusOK",
      last_error: unhealthy ? "exporter otlphttp/openobserve: connection refused" : "",
      components: [
        { id: "receiver:hostmetrics", healthy: true, status: "StatusOK", last_error: "" },
        {
          id: "exporter:otlphttp/openobserve",
          healthy: !unhealthy,
          status: unhealthy ? "StatusRecoverableError" : "StatusOK",
          last_error: unhealthy ? "connection refused" : "",
        },
      ],
    },
    effective_config: c.config ? `${BASE_YAML}${SYSTEM_YAML}` : null,
    effective_reported_at: c.config ? c.last_seen : null,
    assignment: c.config
      ? { fleet: c.fleet.id, config: c.config, version: c.config_version ?? 0, revision: 3 }
      : null,
    evidence: {
      remote_status: c.delivery === "rejected" ? "FAILED" : c.config ? "APPLIED" : null,
      remote_hash: c.config ? "9f2c1a7e" : null,
      remote_at: c.config ? c.last_seen - 60_000 : null,
      marker:
        c.delivery === "running" && c.config
          ? { config: c.config, version: c.config_version ?? 0 }
          : null,
      last_heartbeat_at: c.last_seen,
    },
    history: [
      { at: c.enrolled_at, event: "enrolled", detail: null },
      { at: c.enrolled_at + 1000, event: "assigned", detail: c.config },
      { at: c.last_seen - 60_000, event: c.delivery ?? "assigned", detail: c.delivery_error },
    ],
  };
}

function startRollout(fleetId: string, body: FleetSetDesiredRequest): FleetRollout {
  const fleet = store.fleets.find((f) => f.id === fleetId);
  const state = fleet?.state;
  for (const r of store.rollouts) {
    if (r.fleet.id === fleetId && ["scheduled", "in_progress", "halted"].includes(r.status))
      r.status = "superseded";
  }
  const eligible = store.collectors.filter((c) => c.fleet.id === fleetId).length;
  const { phases } = planPhases(body.batching, eligible);
  const scheduled = body.start.kind === "at";
  const rollout: FleetRollout = {
    id: `r-${store.seq++}`,
    fleet: { id: fleetId, name: fleet?.name ?? fleetId },
    config: body.config,
    from_version: state?.stable?.version ?? null,
    to_version: body.version,
    start: body.start,
    batching: body.batching,
    verify: body.verify,
    auto_rollback: body.auto_rollback,
    status: scheduled ? "scheduled" : eligible ? "in_progress" : "completed",
    halt: null,
    total: eligible,
    running: 0,
    phases: phases.map((size, index) => ({
      index,
      size,
      status: index === 0 && !scheduled ? "deploying" : "pending",
      targeted: index === 0 && !scheduled ? size : 0,
      sent: 0,
      confirmed: 0,
      rejected: 0,
      gate: null,
    })),
    members: membersOf(store, fleetId, phases),
    events: [
      { at: Date.now(), key: scheduled ? "scheduled" : "started", phase: null, detail: null },
    ],
    started_by: "root@example.com",
    started_at: body.start.kind === "at" ? body.start.at : Date.now(),
    ended_at: null,
  };
  store.rollouts.unshift(rollout);
  if (state) {
    state.desired = { config: body.config, version: body.version };
    if (!eligible) state.stable = state.desired;
    state.rollout = { id: rollout.id, status: rollout.status };
  }
  audit("fleet.audit.setDesired", fleetId);
  return rollout;
}

function exitRollout(id: string, exit: "resume" | "skip" | "rollback", skip: string[] = []) {
  const r = store.rollouts.find((x) => x.id === id);
  if (!r) return fail(404, "rollout not found");
  if (r.status !== "halted" || !r.halt?.exits.includes(exit))
    return fail(409, `rollout cannot ${exit} from ${r.status}`);
  const state = store.fleets.find((f) => f.id === r.fleet.id)?.state;
  if (exit === "rollback") {
    r.status = "rolled_back";
    r.ended_at = Date.now();
    const stable = state?.stable;
    if (stable) {
      startRollout(r.fleet.id, {
        config: stable.config,
        version: stable.version,
        start: { kind: "now" },
        batching: { kind: "one" },
        verify: false,
        auto_rollback: false,
      });
    }
    return reply(r);
  }
  for (const m of r.members) if (skip.includes(m.collector_id)) m.excluded = true;
  r.status = "in_progress";
  r.halt = null;
  r.events.push({
    at: Date.now(),
    key: exit === "skip" ? "skipped" : "resumed",
    phase: null,
    detail: null,
  });
  if (state) state.rollout = { id: r.id, status: "in_progress" };
  return reply(r);
}

const pipeline = (
  fleet: string,
  name: string,
  receivers: FleetPipeline["receivers"],
  exporters: FleetPipeline["exporters"],
  over: Partial<FleetPipeline> = {},
): FleetPipeline => {
  const inRate = receivers.reduce((sum, r) => sum + (r.rate ?? 0), 0);
  const outRate = exporters.reduce((sum, e) => sum + (e.rate ?? 0), 0);
  return {
    id: `${fleet}/${name}`,
    fleet,
    name,
    signal: name.split("/")[0] as FleetPipeline["signal"],
    receivers,
    exporters,
    in_rate: inRate,
    out_rate: outRate,
    failed_ratio: 0,
    dropped_ratio: 0,
    queue_ratio: Math.max(0, ...exporters.map((e) => e.queue ?? 0)),
    issues: [],
    ...over,
  };
};

const exporter = (
  name: string,
  destination: string,
  rate: number,
  over: Partial<FleetPipeline["exporters"][number]> = {},
) => ({ name, destination, rate, failed: 0, dropped: 0, queue: 0.1, ...over });

function flowOf(window: FleetPipelines["window"]): FleetPipelines {
  return {
    window,
    generated_at: Date.now(),
    fleets: [
      { id: "prod-linux", name: "prod-linux", config: "base-linux", version: 3, collectors: 24 },
      { id: "edge-k8s", name: "edge-k8s", config: "k8s-node", version: 1, collectors: 12 },
    ],
    destinations: [
      { id: "o2", type: "otlphttp", target: "o2.example.com", exporter: null },
      { id: "s3", type: "awss3", target: "s3://archive-logs", exporter: null },
    ],
    pipelines: [
      pipeline(
        "prod-linux",
        "metrics",
        [{ name: "hostmetrics", rate: 5400, refused: 0 }],
        [exporter("otlphttp/openobserve", "o2", 5400)],
      ),
      pipeline(
        "prod-linux",
        "logs",
        [{ name: "filelog", rate: 1200, refused: 0 }],
        [
          exporter("otlphttp/openobserve", "o2", 1200),
          exporter("awss3/archive", "s3", 1200, { queue: 0.86 }),
        ],
        { issues: [{ kind: "backpressure", signal: "logs", value: 0.86 }] },
      ),
      pipeline(
        "edge-k8s",
        "logs",
        [
          { name: "filelog", rate: 300, refused: 0 },
          { name: "otlp", rate: 120, refused: 0 },
        ],
        [exporter("otlphttp/o2", "o2", 340, { failed: 75 })],
        { failed_ratio: 0.18, issues: [{ kind: "export_errors", signal: "logs", value: 0.18 }] },
      ),
      pipeline(
        "edge-k8s",
        "traces",
        [{ name: "otlp", rate: 800, refused: 12 }],
        [exporter("otlphttp/o2", "o2", 800)],
        { issues: [{ kind: "receiver_refused", signal: "traces", value: 0.015 }] },
      ),
    ],
    metrics_restricted: false,
  };
}

export const fleetMock: FleetApi = {
  listCollectors: () => reply({ total: store.collectors.length, items: store.collectors }),
  getCollector: (_org, id) => {
    const c = findCollector(id);
    return c ? reply(detailOf(c)) : fail(404, "collector not found");
  },
  renameCollector: (_org, id, name) => {
    const c = findCollector(id);
    if (!c) return fail(404, "collector not found");
    c.name = name || c.hostname;
    return reply(c);
  },
  deleteCollector: (_org, id) => {
    store.collectors = store.collectors.filter((c) => c.id !== id);
    return reply(undefined as unknown);
  },
  restartCollector: () => reply({ queued: true }),
  redeliverCollector: (_org, id) => {
    const c = findCollector(id);
    if (c?.config) c.delivery = "assigned";
    return reply({ revision: store.seq++ });
  },
  summary: () =>
    reply({
      collectors: {
        total: store.collectors.length,
        unknown: store.collectors.filter((c) => c.status === "unknown").length,
        online: store.collectors.filter((c) => c.status === "online").length,
        degraded: store.collectors.filter((c) => c.status === "degraded").length,
        offline: store.collectors.filter((c) => c.status === "offline").length,
        outdated: store.collectors.filter((c) => c.outdated).length,
      },
      versions: [
        { version: "0.163.1", count: store.collectors.filter((c) => !c.outdated).length },
        { version: "0.150.0", count: store.collectors.filter((c) => c.outdated).length },
      ],
      target_version: store.settings.target_collector_version ?? "0.163.1",
      rollouts_active: store.rollouts.filter((r) => r.status === "in_progress").length,
    }),
  listTokens: () => reply({ items: store.tokens }),
  createToken: (_org, body) => {
    const fleet = store.fleets.find((f) => f.id === body.fleet);
    const id = `tok-${store.seq++}`;
    const stored: FleetToken = {
      id,
      name: body.name,
      prefix: `o2ft_${id.slice(-4)}`,
      created_at: Date.now(),
      expires_at: body.expires_in_days ? Date.now() + body.expires_in_days * DAY : null,
      uses: 0,
      max_uses: body.max_uses,
      fleet: { id: body.fleet, name: fleet?.name ?? null },
      revoked: false,
    };
    store.tokens.unshift(stored);
    const created: FleetCreatedToken = {
      ...stored,
      token: `o2ft_${id}_${Math.random().toString(36).slice(2, 14)}`,
    };
    return reply(created);
  },
  revokeToken: (_org, id) => {
    const tok = store.tokens.find((x) => x.id === id);
    if (!tok) return fail(404, "token not found");
    tok.revoked = true;
    return reply(tok);
  },
  listConfigs: () =>
    reply({
      items: store.configs.map((c) => {
        const { draft: _draft, versions: _versions, ...item } = c;
        return item;
      }),
    }),
  getConfig: (_org, id) => {
    const c = store.configs.find((x) => x.id === id);
    return c ? reply(c) : fail(404, "configuration not found");
  },
  createConfig: (_org, body) => {
    const c = configOf(body.id, body.description, 0);
    c.draft = { yaml: body.yaml, by: "root@example.com", at: Date.now() };
    store.configs.push(c);
    return reply(c);
  },
  saveConfigDraft: (_org, id, body) => {
    const c = store.configs.find((x) => x.id === id);
    if (c) c.draft = { yaml: body.yaml, by: "root@example.com", at: Date.now() };
    return reply({ at: Date.now() });
  },
  publishConfigVersion: (_org, id, body) => {
    const c = store.configs.find((x) => x.id === id);
    if (!c) return fail(404, "configuration not found");
    c.latest_version += 1;
    c.versions.unshift({
      version: c.latest_version,
      author: "root@example.com",
      at: Date.now(),
      message: body.message,
      live: false,
      state: "published",
    });
    return reply({ version: c.latest_version, warnings: {} });
  },
  getConfigVersion: (_org, _id, version) => reply({ version, yaml: BASE_YAML, hash: "9f2c1a7e" }),
  validateConfig: () => reply({ issues: {} }),
  deleteConfig: (_org, id) => {
    refreshDerived();
    const c = store.configs.find((x) => x.id === id);
    if (!c) return fail(404, "configuration not found");
    const fleets = c.fleets.length + (c.fleets_hidden ?? 0);
    if (fleets || c.collectors) {
      return fail(409, `configuration ${id} is in use`, {
        references: { fleets, collectors: c.collectors, rollouts: 0 },
      });
    }
    store.configs = store.configs.filter((x) => x.id !== id);
    return reply(undefined as unknown);
  },
  listAudit: () => reply({ items: store.audit }),
  listRollouts: () => reply({ items: store.rollouts, total: store.rollouts.length }),
  getRollout: (_org, id) => {
    const r = store.rollouts.find((x) => x.id === id);
    return r ? reply(r) : fail(404, "rollout not found");
  },
  resumeRollout: (_org, id) => exitRollout(id, "resume"),
  skipRollout: (_org, id, ids) => exitRollout(id, "skip", ids),
  rollbackRollout: (_org, id) => exitRollout(id, "rollback"),
  listFleets: () => reply({ items: store.fleets, total: store.fleets.length }),
  createFleet: (_org, name) => {
    if (store.fleets.some((f) => f.name === name)) return fail(409, `fleet ${name} exists`);
    const fleet = fleetOf(`f-${store.seq++}`, null, null);
    fleet.name = name;
    store.fleets.push(fleet);
    audit("fleet.audit.createdFleet", name);
    return reply(fleet);
  },
  renameFleet: (_org, id, name) => {
    const f = store.fleets.find((x) => x.id === id);
    if (!f) return fail(404, "fleet not found");
    f.name = name;
    return reply(f);
  },
  deleteFleet: (_org, id) => {
    if (id === "default") return fail(400, "the default fleet cannot be deleted");
    if (store.collectors.some((c) => c.fleet.id === id))
      return fail(409, "move or remove the fleet's collectors first");
    store.fleets = store.fleets.filter((f) => f.id !== id);
    return reply(undefined as unknown);
  },
  moveCollectors: (_org, ids, to) => {
    const fleet = store.fleets.find((f) => f.id === to);
    if (!fleet) return fail(404, "fleet not found");
    const stable = fleet.state?.stable;
    for (const c of store.collectors) {
      if (!ids.includes(c.id)) continue;
      c.fleet = { id: fleet.id, name: fleet.name };
      c.config = stable?.config ?? null;
      c.config_version = stable?.version ?? null;
      c.delivery = stable ? "assigned" : null;
    }
    return reply({ moved: ids.length });
  },
  getFleetSettings: (_org, id) => {
    const f = store.fleets.find((x) => x.id === id);
    return f ? reply(f.settings) : fail(404, "fleet not found");
  },
  updateFleetSettings: (_org, id, body) => {
    const f = store.fleets.find((x) => x.id === id);
    if (!f) return fail(404, "fleet not found");
    f.settings = body;
    return reply(body);
  },
  setDesired: (_org, fleetId, body) => {
    const active = store.rollouts.find(
      (r) =>
        r.fleet.id === fleetId &&
        r.config === body.config &&
        r.to_version === body.version &&
        ["scheduled", "in_progress"].includes(r.status),
    );
    return reply(active ?? startRollout(fleetId, body));
  },
  previewDesired: (_org, fleetId, body) => {
    const eligible = store.collectors.filter((c) => c.fleet.id === fleetId).length;
    const preview: FleetPlanPreview = { ...planPhases(body.batching, eligible), eligible };
    return reply(preview);
  },
  getPipelines: (_org, window) => reply(flowOf(window)),
  getSettings: () => reply(store.settings),
  updateSettings: (_org, body) => {
    store.settings = body;
    return reply(body);
  },
};
