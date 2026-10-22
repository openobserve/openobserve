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

import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import fleet, {
  type FleetCollector,
  type FleetCollectorDetail,
  type FleetConfigItem,
  type FleetPipelines,
  type FleetFlowWindow,
  type Fleet,
  type FleetRollout,
  type FleetToken,
} from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import { fleetKeys } from "@/services/fleet.querykeys";
import {
  envVariables,
  failingMembers,
  rolloutConfirmed,
  rolloutRejected,
  setPendingImport,
  takePendingImport,
  toConfigRow,
  toFleetRow,
  useFleetAudit,
  useFleetConfigs,
  useFleetFlow,
  useFleets,
  isForbidden,
  serverMessage,
  osLabel,
  toCollectorDetail,
  toCollectorRow,
  toRolloutRow,
  toTokenRow,
  tokenExpiresSoon,
  tokenState,
  useFleetRollouts,
  useFleetCollectors,
  useFleetSettings,
  useFleetSummary,
} from "./useFleetApi";
import { useRolloutText } from "./rolloutText";

vi.mock("@/services/fleet", () => ({
  default: {
    listConfigs: vi.fn(),
    listAudit: vi.fn(),
    listRollouts: vi.fn(),
    getPipelines: vi.fn(),
    getSettings: vi.fn(),
    summary: vi.fn(),
    listCollectors: vi.fn(),
    listFleets: vi.fn(),
  },
}));

function withRolloutText<T>(use: (text: ReturnType<typeof useRolloutText>) => T): T {
  let out!: T;
  mount(
    defineComponent({
      setup() {
        out = use(useRolloutText());
        return () => null;
      },
    }),
    { global: { plugins: [i18n] } },
  );
  return out;
}

const apiRollout = (over: Partial<FleetRollout> = {}): FleetRollout => ({
  id: "r1",
  fleet: { id: "f1", name: "edge" },
  config: "edge",
  from_version: 1,
  to_version: 2,
  start: { kind: "now" },
  batching: { kind: "canary", first: 1 },
  verify: true,
  auto_rollback: false,
  status: "in_progress",
  halt: null,
  total: 3,
  running: 1,
  phases: [
    {
      index: 0,
      size: 1,
      status: "done",
      targeted: 1,
      sent: 1,
      confirmed: 1,
      rejected: 0,
      gate: { passed: true, observed: "100% healthy" },
    },
    {
      index: 1,
      size: 2,
      status: "deploying",
      targeted: 2,
      sent: 1,
      confirmed: 0,
      rejected: 1,
      gate: null,
    },
  ],
  members: [
    { collector_id: "c1", phase: 0, state: "running", excluded: false },
    { collector_id: "c2", phase: 1, state: "rejected", excluded: false },
    { collector_id: "c3", phase: 1, state: "sent", excluded: true },
  ],
  events: [{ at: 1, key: "started", phase: null, detail: null }],
  started_by: "ana@acme.io",
  started_at: 1790000000000,
  ended_at: null,
  ...over,
});

const apiCollector = (over: Partial<FleetCollector> = {}): FleetCollector => ({
  id: "c1",
  name: "prod-web-01",
  hostname: "prod-web-01.acme.internal",
  status: "online",
  os: "linux",
  arch: "amd64",
  distribution: "Ubuntu 24.04",
  version: "0.124.0",
  outdated: false,
  last_connected_from: "10.0.0.10",
  config: null,
  config_version: null,
  delivery: null,
  delivery_error: null,
  fleet: { id: "f1", name: "edge" },
  token_id: null,
  last_seen: 1790000000000,
  enrolled_at: 1788000000000,
  ...over,
});

const apiDetail = (over: Partial<FleetCollectorDetail> = {}): FleetCollectorDetail => ({
  ...apiCollector(),
  capabilities: ["ReportsStatus"],
  health: null,
  effective_config: null,
  effective_reported_at: null,
  assignment: null,
  evidence: null,
  history: [],
  ...over,
});

describe("toCollectorRow", () => {
  it("maps the API fields to the row", () => {
    expect(
      toCollectorRow(
        apiCollector({
          config: "edge",
          config_version: 2,
          delivery: "rejected",
          delivery_error: "bad field",
          token_id: "t1",
        }),
      ),
    ).toEqual({
      id: "c1",
      name: "prod-web-01",
      hostname: "prod-web-01.acme.internal",
      status: "online",
      os: "linux",
      arch: "amd64",
      distribution: "Ubuntu 24.04",
      version: "0.124.0",
      outdated: false,
      lastConnectedFrom: "10.0.0.10",
      config: "edge",
      configVersion: 2,
      delivery: "rejected",
      deliveryError: "bad field",
      fleetId: "f1",
      fleetName: "edge",
      tokenId: "t1",
      lastSeen: 1790000000000,
      enrolledAt: 1788000000000,
    });
  });

  it("names a collector by its nickname, then its host name, then its id", () => {
    expect(toCollectorRow(apiCollector({ name: "nick" })).name).toBe("nick");
    expect(toCollectorRow(apiCollector({ name: null })).name).toBe("prod-web-01.acme.internal");
    expect(toCollectorRow(apiCollector({ name: null, hostname: null })).name).toBe("c1");
  });

  it("turns missing optional fields into null, never undefined", () => {
    const row = toCollectorRow({ id: "c1", status: "unknown" } as unknown as FleetCollector);
    for (const key of [
      "hostname",
      "os",
      "arch",
      "version",
      "lastConnectedFrom",
      "config",
      "configVersion",
      "delivery",
      "deliveryError",
      "tokenId",
    ] as const) {
      expect(row[key], key).toBeNull();
    }
    expect(row.fleetId).toBe("default");
  });
});

describe("toCollectorDetail", () => {
  it("defaults null detail fields to empty values", () => {
    const d = toCollectorDetail(apiDetail());
    expect(d.healthReported).toBe(false);
    expect(d.components).toEqual([]);
    expect(d.effectiveConfig).toBeNull();
    expect(d.assignment).toBeNull();
    expect(d.evidence).toBeNull();
    expect(d.history).toEqual([]);
  });

  it("maps the effective config, assignment, evidence and newest-first history", () => {
    const evidence = {
      remote_status: "APPLIED",
      remote_hash: "ab",
      remote_at: 5,
      marker: { config: "edge", version: 2 },
      last_heartbeat_at: 6,
    };
    const d = toCollectorDetail(
      apiDetail({
        effective_config: "receivers: {}",
        effective_reported_at: 7,
        assignment: { fleet: "f1", config: "edge", version: 2, revision: 3 },
        evidence,
        history: [
          { at: 1, event: "enrolled", detail: null },
          { at: 9, event: "running", detail: null },
        ],
      }),
    );
    expect(d.effectiveConfig).toEqual({ yaml: "receivers: {}", reportedAt: 7 });
    expect(d.assignment).toEqual({ fleet: "f1", config: "edge", version: 2, revision: 3 });
    expect(d.evidence).toEqual(evidence);
    expect(d.history.map((h) => h.event)).toEqual(["running", "enrolled"]);
  });

  it("reports an offline collector's component health as unknown", () => {
    const health = {
      healthy: true,
      status: "ok",
      last_error: "",
      components: [{ id: "r", healthy: true, status: "ok", last_error: "" }],
    };
    expect(toCollectorDetail(apiDetail({ health })).components[0].status).toBe("healthy");
    expect(
      toCollectorDetail(apiDetail({ ...apiCollector({ status: "offline" }), health })).components[0]
        .status,
    ).toBe("unknown");
  });
});

describe("osLabel", () => {
  it("labels known operating systems and passes others through", () => {
    expect(osLabel("macos")).toBe("macOS");
    expect(osLabel("freebsd")).toBe("freebsd");
    expect(osLabel(null)).toBeNull();
  });
});

describe("isForbidden", () => {
  it("detects a 403 from either error shape", () => {
    expect(isForbidden({ response: { status: 403 } })).toBe(true);
    expect(isForbidden({ status: 403 })).toBe(true);
    expect(isForbidden({ response: { status: 500 } })).toBe(false);
    expect(isForbidden(null)).toBe(false);
  });
});

describe("toCollectorRow token", () => {
  it("carries the enrolling token id", () => {
    expect(toCollectorRow(apiCollector({ token_id: "t1" })).tokenId).toBe("t1");
  });
});

const apiToken = (over: Partial<FleetToken> = {}): FleetToken => ({
  id: "t1",
  name: "k8s-helm",
  prefix: "o2ft_Qm7x",
  created_at: 1788000000000,
  expires_at: null,
  uses: 5,
  max_uses: 20,
  fleet: { id: "f1", name: "edge" },
  revoked: false,
  ...over,
});

describe("toTokenRow", () => {
  it("maps the API fields to the row", () => {
    expect(toTokenRow(apiToken())).toEqual({
      id: "t1",
      name: "k8s-helm",
      prefix: "o2ft_Qm7x",
      createdAt: 1788000000000,
      expiresAt: null,
      uses: 5,
      maxUses: 20,
      fleetId: "f1",
      fleetName: "edge",
      revoked: false,
      token: null,
    });
  });

  it("keeps a deleted fleet's id with no name, and turns missing limits into null", () => {
    const row = toTokenRow({
      ...apiToken({ fleet: { id: "gone", name: null } }),
      max_uses: undefined,
    } as any);
    expect(row.fleetId).toBe("gone");
    expect(row.fleetName).toBeNull();
    expect(row.maxUses).toBeNull();
  });
});

describe("tokenExpiresSoon", () => {
  const now = 1790000000000;
  const DAY = 86_400_000;

  it("is true only for a live token expiring within 7 days", () => {
    const base = { revoked: false, expiresAt: now + 3 * DAY };
    expect(tokenExpiresSoon(base, now)).toBe(true);
    expect(tokenExpiresSoon({ ...base, expiresAt: now + 8 * DAY }, now)).toBe(false);
    expect(tokenExpiresSoon({ ...base, expiresAt: now - DAY }, now)).toBe(false);
    expect(tokenExpiresSoon({ ...base, expiresAt: null }, now)).toBe(false);
    expect(tokenExpiresSoon({ ...base, revoked: true }, now)).toBe(false);
  });
});

describe("tokenState", () => {
  const now = 1790000000000;

  it("is revoked when revoked, whatever the expiry", () => {
    expect(tokenState({ revoked: true, expiresAt: now + 1, uses: 0, maxUses: null }, now)).toBe(
      "revoked",
    );
    expect(tokenState({ revoked: true, expiresAt: now - 1, uses: 0, maxUses: null }, now)).toBe(
      "revoked",
    );
  });

  it("is expired once the expiry has passed", () => {
    expect(tokenState({ revoked: false, expiresAt: now - 1, uses: 0, maxUses: null }, now)).toBe(
      "expired",
    );
  });

  it("is exhausted once uses reach the limit", () => {
    expect(tokenState({ revoked: false, expiresAt: null, uses: 20, maxUses: 20 }, now)).toBe(
      "exhausted",
    );
    expect(tokenState({ revoked: false, expiresAt: null, uses: 19, maxUses: 20 }, now)).toBe(
      "active",
    );
    expect(tokenState({ revoked: false, expiresAt: null, uses: 99, maxUses: null }, now)).toBe(
      "active",
    );
  });

  it("ranks revoked over expired over exhausted", () => {
    const full = { uses: 1, maxUses: 1 };
    expect(tokenState({ revoked: true, expiresAt: now - 1, ...full }, now)).toBe("revoked");
    expect(tokenState({ revoked: false, expiresAt: now - 1, ...full }, now)).toBe("expired");
  });

  it("is active with no expiry or a future one", () => {
    expect(tokenState({ revoked: false, expiresAt: null, uses: 0, maxUses: null }, now)).toBe(
      "active",
    );
    expect(tokenState({ revoked: false, expiresAt: now + 1, uses: 0, maxUses: null }, now)).toBe(
      "active",
    );
  });
});

describe("serverMessage", () => {
  it("returns the server's message from the error body", () => {
    const err = { response: { status: 403, data: { code: 403, message: "Only admins" } } };
    expect(serverMessage(err)).toBe("Only admins");
  });

  it("is null when the server sent no message", () => {
    expect(serverMessage({ response: { status: 500 } })).toBeNull();
    expect(serverMessage(new Error("network"))).toBeNull();
    expect(serverMessage(null)).toBeNull();
  });
});

const apiConfig = (over: Partial<FleetConfigItem> = {}): FleetConfigItem => ({
  id: "edge-minimal",
  description: "Edge",
  latest_version: 3,
  live_version: null,
  collectors: 0,
  fleets: [],
  updated_at: 1790000000000,
  updated_by: "ana@acme.io",
  ...over,
});

describe("toConfigRow", () => {
  it("maps the API fields to the row, naming it by its id", () => {
    expect(
      toConfigRow(apiConfig({ fleets: [{ id: "f1", name: "edge" }], fleets_hidden: 2 })),
    ).toEqual({
      id: "edge-minimal",
      name: "edge-minimal",
      description: "Edge",
      version: 3,
      liveVersion: null,
      collectors: 0,
      fleets: [{ id: "f1", name: "edge" }],
      fleetsHidden: 2,
      updatedAt: 1790000000000,
      updatedBy: "ana@acme.io",
    });
    expect(toConfigRow(apiConfig()).fleetsHidden).toBe(0);
  });
});

describe("envVariables", () => {
  it("lists the distinct env variable names, sorted", () => {
    const yaml = [
      "endpoint: ${env:O2_ENDPOINT}",
      "auth: Basic ${env:O2_TOKEN}",
      "again: ${env:O2_ENDPOINT}",
      "node: ${env:K8S_NODE_NAME}:10250",
    ].join("\n");
    expect(envVariables(yaml)).toEqual(["K8S_NODE_NAME", "O2_ENDPOINT", "O2_TOKEN"]);
  });

  it("ignores placeholders without the env: prefix", () => {
    expect(envVariables("a: ${O2_X}\nb: $O2_Y")).toEqual([]);
  });
});

describe("pending import", () => {
  it("hands the text over once", () => {
    setPendingImport("receivers: {}\r\n# kept\r\n");
    expect(takePendingImport()).toBe("receivers: {}\r\n# kept\r\n");
    expect(takePendingImport()).toBeNull();
  });
});

describe("toRolloutRow", () => {
  it("maps the API fields to the row", () => {
    const row = toRolloutRow(apiRollout());
    expect(row).toMatchObject({
      id: "r1",
      config: "edge",
      fromVersion: 1,
      toVersion: 2,
      fleetId: "f1",
      fleetName: "edge",
      start: { kind: "now" },
      batching: { kind: "canary", first: 1 },
      verify: true,
      autoRollback: false,
      status: "in_progress",
      halt: null,
      total: 3,
      running: 1,
      startedBy: "ana@acme.io",
      startedAt: 1790000000000,
      endedAt: null,
    });
    expect(row.phases).toHaveLength(2);
    expect(row.members[2]).toEqual({
      collectorId: "c3",
      phase: 1,
      state: "sent",
      excluded: true,
      evidence: null,
    });
  });

  it("keeps the halt with the exits the server offers", () => {
    const halt = {
      class: "proven_bad" as const,
      reason: "1 collector rejected",
      at: 5,
      exits: ["rollback" as const, "skip" as const],
    };
    expect(toRolloutRow(apiRollout({ status: "halted", halt })).halt).toEqual(halt);
  });

  it("defaults missing lists and batching", () => {
    const row = toRolloutRow({ id: "r", status: "completed" } as unknown as FleetRollout);
    expect(row.phases).toEqual([]);
    expect(row.members).toEqual([]);
    expect(row.events).toEqual([]);
    expect(row.batching).toEqual({ kind: "one" });
    expect(row.fleetName).toBeNull();
  });

  it("sums confirmed and rejected over the phases and finds the failing members", () => {
    const row = toRolloutRow(apiRollout());
    expect(rolloutConfirmed(row)).toBe(1);
    expect(rolloutRejected(row)).toBe(1);
    expect(failingMembers(row)).toEqual(["c2"]);
  });

  it("words progress in collectors, and an empty fleet as none targeted", () => {
    const text = withRolloutText((r) => r);
    expect(text.progressText(toRolloutRow(apiRollout()))).toBe("1 of 3 running the new version");
    expect(text.progressText({ running: 0, total: 0 })).toBe("No collectors targeted");
  });

  it("words a plan as phases and a remaining tail", () => {
    const text = withRolloutText((r) => r);
    expect(text.planText([3, 9, 27, 61])).toBe("3 → 9 → 27 → remaining 61, 4 phases");
    expect(text.planText([3, 37])).toBe("3 → remaining 37, 2 phases");
    expect(text.planText([40])).toBe("40 collectors in one batch");
    expect(text.planText([])).toBe("No collectors to update");
  });
});

const apiFleet = (over: Partial<Fleet> = {}): Fleet => ({
  id: "f1",
  name: "edge",
  state: {
    desired: { config: "edge-config", version: 3 },
    stable: { config: "edge-config", version: 2 },
    rollout: { id: "r1", status: "in_progress" },
    collectors: 4,
    online: 3,
    at_desired: 1,
  },
  settings: {
    heartbeat_interval_secs: 15,
    offline_heartbeats: null,
    retention_days: null,
    offline_ratio_percent: null,
    phase_timeout_secs: null,
    gate: null,
  },
  ...over,
});

describe("toFleetRow", () => {
  it("maps desired, stable, the active rollout, the counts and the settings", () => {
    expect(toFleetRow(apiFleet())).toEqual({
      id: "f1",
      name: "edge",
      readable: true,
      desired: { config: "edge-config", version: 3 },
      stable: { config: "edge-config", version: 2 },
      rollout: { id: "r1", status: "in_progress" },
      collectors: 4,
      online: 3,
      atDesired: 1,
      settings: {
        heartbeat_interval_secs: 15,
        offline_heartbeats: null,
        retention_days: null,
        offline_ratio_percent: null,
        phase_timeout_secs: null,
        gate: null,
      },
    });
  });

  it("marks a fleet without state as unreadable and inherits every setting", () => {
    const row = toFleetRow({ id: "f2", name: "x", state: null } as unknown as Fleet);
    expect(row.readable).toBe(false);
    expect(row.desired).toBeNull();
    expect(row.settings.phase_timeout_secs).toBeNull();
  });
});

describe("useFleets", () => {
  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  function mountFleets() {
    let api!: ReturnType<typeof useFleets>;
    const w = mount(
      defineComponent({
        setup() {
          api = useFleets();
          return () => null;
        },
      }),
      { global: { plugins: [store, i18n] } },
    );
    return { w, api: () => api };
  }

  it("returns the fleet rows", async () => {
    vi.mocked(fleet.listFleets).mockResolvedValue({
      data: { items: [apiFleet()] },
    } as any);
    const { w, api } = mountFleets();
    await flushPromises();
    expect(api().rows.value.map((f) => f.id)).toEqual(["f1"]);
    w.unmount();
  });

  it("drops cached fleet rows when a refetch returns 403", async () => {
    vi.mocked(fleet.listFleets).mockResolvedValueOnce({
      data: { items: [apiFleet()] },
    } as any);
    const { w, api } = mountFleets();
    await flushPromises();
    expect(api().rows.value.map((f) => f.id)).toEqual(["f1"]);
    vi.mocked(fleet.listFleets).mockRejectedValueOnce({ response: { status: 403 } });
    await api().refetch();
    await flushPromises();
    expect(api().rows.value).toEqual([]);
    w.unmount();
  });
});

describe("config and audit reads", () => {
  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  function mountRead<T>(use: () => T): T {
    let out!: T;
    mount(
      defineComponent({
        setup() {
          out = use();
          return () => null;
        },
      }),
      { global: { plugins: [store, i18n] } },
    );
    return out;
  }

  it("drops cached config rows when a refetch returns 403", async () => {
    vi.mocked(fleet.listConfigs).mockResolvedValueOnce({ data: { items: [apiConfig()] } } as any);
    const read = mountRead(useFleetConfigs);
    await flushPromises();
    expect(read.rows.value.map((r) => r.id)).toEqual(["edge-minimal"]);
    vi.mocked(fleet.listConfigs).mockRejectedValueOnce({ response: { status: 403 } });
    await read.refetch();
    await flushPromises();
    expect(read.rows.value).toEqual([]);
  });

  it("drops cached rollout rows when a refetch returns 403", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValueOnce({ data: { items: [apiRollout()] } } as any);
    const read = mountRead(useFleetRollouts);
    await flushPromises();
    expect(read.rows.value.map((r) => r.id)).toEqual(["r1"]);
    vi.mocked(fleet.listRollouts).mockRejectedValueOnce({ response: { status: 403 } });
    await read.refetch();
    await flushPromises();
    expect(read.rows.value).toEqual([]);
  });

  it("drops cached audit rows when a refetch returns 403", async () => {
    const event = { id: "a1", at: 1, actor: "x", action: "a", target: "t", outcome: "success" };
    vi.mocked(fleet.listAudit).mockResolvedValueOnce({ data: { items: [event] } } as any);
    const read = mountRead(useFleetAudit);
    await flushPromises();
    expect(read.rows.value).toEqual([event]);
    vi.mocked(fleet.listAudit).mockRejectedValueOnce({ response: { status: 403 } });
    await read.refetch();
    await flushPromises();
    expect(read.rows.value).toEqual([]);
  });

  it("flags a server whose audit stream is off", async () => {
    vi.mocked(fleet.listAudit).mockResolvedValueOnce({
      data: { items: [], audit_disabled: true },
    } as any);
    const read = mountRead(useFleetAudit);
    await flushPromises();
    expect(read.disabled.value).toBe(true);
    expect(read.rows.value).toEqual([]);
  });
});

describe("useFleetSettings", () => {
  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  function mountRead<T>(use: () => T): T {
    let out!: T;
    mount(
      defineComponent({
        setup() {
          out = use();
          return () => null;
        },
      }),
      { global: { plugins: [store, i18n] } },
    );
    return out;
  }

  it("returns the settings payload", async () => {
    const body = { restricted_components: ["debug"], target_collector_version: "0.170.0" };
    vi.mocked(fleet.getSettings).mockResolvedValue({ data: body } as any);
    const read = mountRead(useFleetSettings);
    await flushPromises();
    expect(read.settings.value).toEqual(body);
    expect(read.forbidden.value).toBe(false);
    expect(read.loading.value).toBe(false);
    expect(fleet.getSettings).toHaveBeenCalledWith("default");
  });

  it("turns a 403 into no settings and forbidden", async () => {
    vi.mocked(fleet.getSettings).mockRejectedValue({ response: { status: 403 } });
    const read = mountRead(useFleetSettings);
    await flushPromises();
    expect(read.settings.value).toBeNull();
    expect(read.forbidden.value).toBe(true);
  });
});

describe("useFleetFlow", () => {
  const flow = (window: FleetFlowWindow): FleetPipelines => ({
    window,
    generated_at: 1791122400000,
    metrics_restricted: false,
    fleets: [{ id: "edge", name: "edge", config: "base", version: 2, collectors: 3 }],
    destinations: [{ id: "d_1", type: "otlphttp", target: "https://o2.acme.io", exporter: null }],
    pipelines: [
      {
        id: "edge/logs",
        fleet: "edge",
        name: "logs",
        signal: "logs",
        receivers: [{ name: "filelog", rate: 10, refused: 0 }],
        exporters: [
          { name: "otlphttp/o2", destination: "d_1", rate: 10, failed: 0, dropped: 0, queue: 0 },
        ],
        in_rate: 10,
        out_rate: 10,
        failed_ratio: 0,
        dropped_ratio: 0,
        queue_ratio: 0,
        issues: [],
      },
    ],
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  function mountRead<T>(use: () => T): T {
    let out!: T;
    mount(
      defineComponent({
        setup() {
          out = use();
          return () => null;
        },
      }),
      { global: { plugins: [store, i18n] } },
    );
    return out;
  }

  it("returns the flow payload", async () => {
    vi.mocked(fleet.getPipelines).mockResolvedValue({ data: flow("1h") } as any);
    const read = mountRead(() => useFleetFlow(() => "1h"));
    await flushPromises();
    expect(read.flow.value).toEqual(flow("1h"));
    expect(read.forbidden.value).toBe(false);
    expect(fleet.getPipelines).toHaveBeenCalledWith("default", "1h");
  });

  it("turns a 403 into no flow and forbidden", async () => {
    vi.mocked(fleet.getPipelines).mockRejectedValue({ response: { status: 403 } });
    const read = mountRead(() => useFleetFlow(() => "1h"));
    await flushPromises();
    expect(read.flow.value).toBeNull();
    expect(read.forbidden.value).toBe(true);
  });

  it("refetches under a new key when the window changes", async () => {
    vi.mocked(fleet.getPipelines).mockImplementation(
      async (_org, window) => ({ data: flow(window) }) as any,
    );
    const window = ref<FleetFlowWindow>("1h");
    const read = mountRead(() => useFleetFlow(() => window.value));
    await flushPromises();
    window.value = "5m";
    await flushPromises();
    expect(fleet.getPipelines).toHaveBeenLastCalledWith("default", "5m");
    expect(read.flow.value?.window).toBe("5m");
    expect(queryClient.getQueryData(fleetKeys.flow("default", "1h"))).toEqual(flow("1h"));
    expect(queryClient.getQueryData(fleetKeys.flow("default", "5m"))).toEqual(flow("5m"));
  });
});

describe("useFleetConfigs polling", () => {
  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("refetches on the given interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fleet.listConfigs).mockResolvedValue({ data: { items: [apiConfig()] } } as any);
    const wrapper = mount(
      defineComponent({
        setup() {
          useFleetConfigs(() => true, 15_000);
          return () => null;
        },
      }),
      { global: { plugins: [store, i18n] } },
    );
    await flushPromises();
    expect(fleet.listConfigs).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(fleet.listConfigs).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("exposes forbidden on a 403", async () => {
    vi.mocked(fleet.listConfigs).mockRejectedValue({ response: { status: 403 } });
    let read!: ReturnType<typeof useFleetConfigs>;
    mount(
      defineComponent({
        setup() {
          read = useFleetConfigs();
          return () => null;
        },
      }),
      { global: { plugins: [store, i18n] } },
    );
    await flushPromises();
    expect(read.forbidden.value).toBe(true);
  });
});

describe("useFleetSummary polling", () => {
  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
    vi.clearAllMocks();
  });

  function mountSummary(withList: boolean) {
    return mount(
      defineComponent({
        setup() {
          useFleetSummary();
          if (withList) useFleetCollectors();
          return () => null;
        },
      }),
      { global: { plugins: [store, i18n] } },
    );
  }

  it("starts polling when the collectors list starts moving after the summary resolved", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fleet.summary).mockResolvedValue({ data: { rollouts_active: 0 } } as any);
    vi.mocked(fleet.listCollectors).mockResolvedValueOnce({
      data: { items: [apiCollector({ delivery: "running" })] },
    } as any);
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: { items: [apiCollector({ delivery: "sent" })] },
    } as any);
    const wrapper = mountSummary(true);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fleet.summary).toHaveBeenCalledTimes(1);
    queryClient.setQueryData(fleetKeys.collectors("default"), [apiCollector({ delivery: "sent" })]);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(fleet.summary).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("stops polling once the summary reports no active rollout, whatever the rollout cache says", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queryClient.setQueryData(fleetKeys.rollouts("default"), [apiRollout()]);
    vi.mocked(fleet.summary).mockResolvedValueOnce({ data: { rollouts_active: 1 } } as any);
    vi.mocked(fleet.summary).mockResolvedValue({ data: { rollouts_active: 0 } } as any);
    const wrapper = mountSummary(false);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(fleet.summary).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(fleet.summary).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("ignores an in-flight delivery in a collectors cache nothing keeps fresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queryClient.setQueryData(fleetKeys.collectors("default"), [apiCollector({ delivery: "sent" })]);
    vi.mocked(fleet.summary).mockResolvedValue({ data: { rollouts_active: 0 } } as any);
    const wrapper = mountSummary(false);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(fleet.summary).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
