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
  type FleetFlow,
  type FleetFlowWindow,
  type Fleet,
  type FleetRollout,
  type FleetToken,
} from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import { fleetKeys } from "@/services/fleet.querykeys";
import {
  envVariables,
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
    getFlow: vi.fn(),
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
  kind: "config",
  config: "edge",
  from_version: 1,
  to_version: 2,
  fleet: { id: "f1", name: "edge" },
  strategy: "immediate",
  status: "in_progress",
  total: 3,
  attempted: 2,
  accepted: 1,
  failed: 0,
  assigned: 3,
  started_at: 1790000000000,
  scheduled_for: null,
  started_by: "ana@acme.io",
  auto_rollback: false,
  phases: [
    {
      id: "p1",
      label: "all",
      size: 3,
      assigned: 3,
      attempted: 2,
      accepted: 1,
      failed: 0,
      status: "running",
    },
  ],
  gates: [],
  failure: null,
  events: [{ key: "deploying", at: 1790000000000 }],
  ...over,
});

const apiCollector = (over: Partial<FleetCollector> = {}): FleetCollector => ({
  id: "c1",
  name: "prod-web-01",
  hostname: "prod-web-01.acme.internal",
  ip: "10.0.0.10",
  status: "online",
  os: "linux",
  arch: "amd64",
  distribution: "Ubuntu 24.04",
  version: "0.124.0",
  outdated: false,
  config: null,
  config_version: null,
  delivery: null,
  drifted: null,
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
  errors: [],
  delivery_error: null,
  effective_config: null,
  assigned_at: null,
  applied_at: null,
  drift_since: null,
  baseline_config: null,
  ...over,
});

describe("toCollectorRow", () => {
  it("maps the API fields to the row", () => {
    expect(toCollectorRow(apiCollector())).toEqual({
      id: "c1",
      name: "prod-web-01",
      hostname: "prod-web-01.acme.internal",
      ip: "10.0.0.10",
      status: "online",
      os: "linux",
      arch: "amd64",
      distribution: "Ubuntu 24.04",
      version: "0.124.0",
      outdated: false,
      config: null,
      configVersion: null,
      delivery: null,
      drifted: null,
      fleetId: "f1",
      fleetName: "edge",
      tokenId: null,
      lastSeen: 1790000000000,
      enrolledAt: 1788000000000,
    });
  });

  it.each(["online", "degraded", "offline"] as const)("keeps status %s", (status) => {
    expect(toCollectorRow(apiCollector({ status })).status).toBe(status);
  });

  it("takes outdated from the server instead of comparing versions", () => {
    expect(toCollectorRow(apiCollector({ version: "0.1.0", outdated: false })).outdated).toBe(
      false,
    );
    expect(toCollectorRow(apiCollector({ version: "9.9.9", outdated: true })).outdated).toBe(true);
  });

  it("names the row by hostname, then id, when the name is null", () => {
    expect(toCollectorRow(apiCollector({ name: null })).name).toBe("prod-web-01.acme.internal");
    expect(toCollectorRow(apiCollector({ name: null, hostname: null })).name).toBe("c1");
  });

  it("keeps unknown drift as null so it is never shown as in sync", () => {
    expect(toCollectorRow(apiCollector({ drifted: null })).drifted).toBeNull();
    expect(toCollectorRow(apiCollector({ drifted: false })).drifted).toBe(false);
  });

  it("places a collector the server sent without a fleet in the default fleet", () => {
    const row = toCollectorRow({
      ...apiCollector(),
      fleet: undefined,
    } as unknown as FleetCollector);
    expect(row.fleetId).toBe("default");
    expect(row.fleetName).toBe("default");
  });

  it("carries no label or group field", () => {
    const row = toCollectorRow(apiCollector()) as unknown as Record<string, unknown>;
    expect(row).not.toHaveProperty("labels");
    expect(row).not.toHaveProperty("groups");
  });

  it("turns missing optional fields into null, never undefined", () => {
    const row = toCollectorRow({
      id: "c2",
      status: "offline",
      last_seen: 1,
      enrolled_at: 1,
    } as any);
    for (const field of [
      "hostname",
      "ip",
      "os",
      "arch",
      "distribution",
      "version",
      "config",
      "configVersion",
      "delivery",
      "drifted",
    ] as const) {
      expect(row[field]).toBeNull();
    }
    expect(row.outdated).toBe(false);
  });
});

describe("toCollectorDetail", () => {
  it("defaults null detail fields to empty values", () => {
    const d = toCollectorDetail(apiDetail());
    expect(d.capabilities).toEqual(["ReportsStatus"]);
    expect(d.healthReported).toBe(false);
    expect(d.components).toEqual([]);
    expect(d.errors).toEqual([]);
    expect(d).not.toHaveProperty("assignedVia");
    expect(d.effectiveConfig).toBeNull();
    expect(d.assignedAt).toBeNull();
    expect(d.appliedAt).toBeNull();
    expect(d.driftSince).toBeNull();
    expect(d.baselineConfig).toBeNull();
  });

  it("maps the delivery timestamps and the baseline config", () => {
    const d = toCollectorDetail(
      apiDetail({ assigned_at: 1, applied_at: 2, drift_since: 3, baseline_config: "a: 1\n" }),
    );
    expect([d.assignedAt, d.appliedAt, d.driftSince, d.baselineConfig]).toEqual([
      1,
      2,
      3,
      "a: 1\n",
    ]);
  });

  it("maps component health to a status per component", () => {
    const d = toCollectorDetail(
      apiDetail({
        health: {
          healthy: false,
          status: "StatusRecoverableError",
          last_error: "",
          components: [
            { id: "receiver:otlp", healthy: true, status: "StatusOK", last_error: "" },
            {
              id: "exporter:otlphttp",
              healthy: false,
              status: "StatusPermanentError",
              last_error: "401",
            },
          ],
        },
      }),
    );
    expect(d.healthReported).toBe(true);
    expect(d.components).toEqual([
      { id: "receiver:otlp", status: "healthy", lastError: "" },
      { id: "exporter:otlphttp", status: "degraded", lastError: "401" },
    ]);
  });

  it("reports every component as unknown while the collector is offline", () => {
    const d = toCollectorDetail(
      apiDetail({
        status: "offline",
        health: {
          healthy: true,
          status: "StatusOK",
          last_error: "",
          components: [{ id: "receiver:otlp", healthy: true, status: "StatusOK", last_error: "" }],
        },
      }),
    );
    expect(d.components[0].status).toBe("unknown");
  });

  it("maps the effective config report", () => {
    const d = toCollectorDetail(
      apiDetail({ effective_config: { yaml: "receivers: {}", reported_at: 5 } }),
    );
    expect(d.effectiveConfig).toEqual({ yaml: "receivers: {}", reportedAt: 5 });
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
  template: false,
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
    const fleets = [{ id: "f1", name: "edge" }];
    expect(toConfigRow(apiConfig({ fleets, live_version: 2, collectors: 4 }))).toEqual({
      id: "edge-minimal",
      name: "edge-minimal",
      description: "Edge",
      template: false,
      version: 3,
      liveVersion: 2,
      collectors: 4,
      fleets: [{ id: "f1", name: "edge" }],
      updatedAt: 1790000000000,
      updatedBy: "ana@acme.io",
    });
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
    expect(toRolloutRow(apiRollout())).toEqual({
      id: "r1",
      kind: "config",
      config: "edge",
      fromVersion: 1,
      toVersion: 2,
      fleetId: "f1",
      fleetName: "edge",
      strategy: "immediate",
      status: "in_progress",
      total: 3,
      attempted: 2,
      accepted: 1,
      failed: 0,
      assigned: 3,
      startedAt: 1790000000000,
      startedBy: "ana@acme.io",
      autoRollback: false,
      scheduledFor: null,
      gates: [],
      phases: [
        {
          id: "p1",
          labelKey: "fleet.rollouts.phaseAll",
          size: 3,
          attempted: 2,
          accepted: 1,
          failed: 0,
          status: "running",
        },
      ],
      failure: null,
      events: [{ key: "deploying", at: 1790000000000 }],
      members: [],
      stillOnPrevious: 0,
    });
  });

  it("keeps the rollout kind, so upgrade rollouts can be told apart", () => {
    expect(toRolloutRow(apiRollout({ kind: "upgrade" })).kind).toBe("upgrade");
  });

  it("keeps a null from version and a deleted target fleet's id with no name", () => {
    const row = toRolloutRow(apiRollout({ from_version: null, fleet: { id: "g1", name: null } }));
    expect(row.fromVersion).toBeNull();
    expect(row.fleetId).toBe("g1");
    expect(row.fleetName).toBeNull();
  });

  it("maps a rejection failure to the rejected label with the collector's message", () => {
    const row = toRolloutRow(
      apiRollout({
        status: "halted",
        failed: 1,
        failure: {
          kind: "rejection",
          gate: "rejected",
          observed: "1",
          threshold: "0",
          message: "unknown receiver",
        },
      }),
    );
    expect(row.failure).toEqual({
      kind: "rejection",
      labelKey: "fleet.rollouts.gateRejected",
      observed: "1",
      threshold: "0",
      message: "unknown receiver",
    });
  });

  it("maps each phase label to its own key", () => {
    const phase = apiRollout().phases[0];
    const row = toRolloutRow(
      apiRollout({
        strategy: "progressive",
        phases: ["canary", "batch", "remaining", "all"].map((label, i) => ({
          ...phase,
          id: `p${i}`,
          label,
        })),
      }),
    );
    expect(row.phases.map((p) => p.labelKey)).toEqual([
      "fleet.rollouts.phaseCanary",
      "fleet.rollouts.phaseBatch",
      "fleet.rollouts.phaseRemaining",
      "fleet.rollouts.phaseAll",
    ]);
  });

  it("maps a heartbeat failure to the heartbeat gate and words it with the observed share", () => {
    const row = toRolloutRow(
      apiRollout({
        status: "halted",
        failure: { kind: "gate_failed", gate: "heartbeat", observed: "93.3%", threshold: "≥ 99%" },
      }),
    );
    expect(row.failure?.labelKey).toBe("fleet.rollouts.gateHeartbeat");
    expect(withRolloutText(({ failureText }) => failureText(row))).toBe(
      "Health gate failed: Heartbeat success 93.3% (limit ≥ 99%)",
    );
  });

  it("words a no-data halt as its own reason, not a failed gate", () => {
    const row = toRolloutRow(
      apiRollout({
        status: "halted",
        failure: { kind: "no_data", gate: "heartbeat", observed: "no data", threshold: "≥ 99%" },
      }),
    );
    expect(row.failure?.labelKey).toBe("fleet.rollouts.failureNoData");
    expect(withRolloutText(({ failureText }) => failureText(row))).toBe(
      "Halted: no collector reported a heartbeat to check",
    );
  });

  it("words an unknown gate neutrally with the server's reason", () => {
    const row = toRolloutRow(
      apiRollout({
        status: "halted",
        failure: { kind: "gate_failed", gate: "queue", observed: "82%", threshold: "≥ 99%" },
      }),
    );
    expect(row.failure?.labelKey).toBe("fleet.rollouts.failureOther");
    const text = withRolloutText(({ failureText }) => failureText(row));
    expect(text).toBe("Halted: 82%");
    expect(text).not.toContain("rejected");
  });

  it("maps the gates, the schedule and the automatic rollback setting", () => {
    const row = toRolloutRow(
      apiRollout({
        status: "scheduled",
        scheduled_for: 1790003600000,
        auto_rollback: true,
        gates: [{ id: "heartbeat", threshold: "≥ 99%", observed: "—", status: "pending" }],
      }),
    );
    expect(row.autoRollback).toBe(true);
    expect(row.scheduledFor).toBe(1790003600000);
    expect(row.gates).toEqual([
      {
        id: "heartbeat",
        labelKey: "fleet.rollouts.gateHeartbeat",
        threshold: "≥ 99%",
        observed: "—",
        status: "pending",
      },
    ]);
  });

  it("counts a pending phase as none of its collectors attempted", () => {
    const row = toRolloutRow(
      apiRollout({
        phases: [
          {
            ...apiRollout().phases[0],
            status: "pending",
            size: 2,
            assigned: 0,
            attempted: 0,
            accepted: 0,
          },
        ],
      }),
    );
    const text = withRolloutText(({ countsText }) => countsText(row.phases[0], row.phases[0].size));
    expect(text).toContain("0 of 2 attempted");
  });

  it("takes members and still_on_previous from a detail", () => {
    const row = toRolloutRow({ ...apiRollout(), members: ["c1", "c2"], still_on_previous: 4 });
    expect(row.members).toEqual(["c1", "c2"]);
    expect(row.stillOnPrevious).toBe(4);
  });
});

const apiFleet = (over: Partial<Fleet> = {}): Fleet => ({
  id: "f1",
  name: "edge",
  state: {
    desired: { config: "edge-config", version: 3 },
    stable: { config: "edge-config", version: 2 },
    revision: { id: "r1", status: "in_progress" },
    collectors: 4,
    online: 3,
    at_desired: 1,
  },
  ...over,
});

describe("toFleetRow", () => {
  it("maps desired, stable, the latest revision and the counts", () => {
    expect(toFleetRow(apiFleet())).toEqual({
      id: "f1",
      name: "edge",
      readable: true,
      desired: { config: "edge-config", version: 3 },
      stable: { config: "edge-config", version: 2 },
      revision: { id: "r1", status: "in_progress" },
      collectors: 4,
      online: 3,
      atDesired: 1,
    });
  });

  it("has no desired or stable version before one is set", () => {
    const row = toFleetRow(
      apiFleet({
        state: {
          desired: null,
          stable: null,
          revision: null,
          collectors: 0,
          online: 0,
          at_desired: 0,
        },
      }),
    );
    expect(row.desired).toBeNull();
    expect(row.stable).toBeNull();
    expect(row.revision).toBeNull();
    expect(row.readable).toBe(true);
  });

  it("is unreadable when the server withheld the fleet's state", () => {
    const row = toFleetRow(apiFleet({ state: null }));
    expect(row.readable).toBe(false);
    expect(row.collectors).toBe(0);
    expect(row.desired).toBeNull();
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
    const body = { restricted_components: ["debug"], target_version: "0.170.0" };
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
  const flow = (window: FleetFlowWindow): FleetFlow => ({
    window,
    generated_at: 1791122400000,
    metrics_restricted: false,
    destinations: [{ id: "d_1", type: "otlphttp", target: "https://o2.acme.io", exporter: null }],
    links: [
      {
        config: "edge",
        destination: "d_1",
        exporters: ["otlphttp/o2"],
        rate: { logs: 10, metrics: null, traces: null },
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
    vi.mocked(fleet.getFlow).mockResolvedValue({ data: flow("1h") } as any);
    const read = mountRead(() => useFleetFlow(() => "1h"));
    await flushPromises();
    expect(read.flow.value).toEqual(flow("1h"));
    expect(read.forbidden.value).toBe(false);
    expect(fleet.getFlow).toHaveBeenCalledWith("default", "1h");
  });

  it("turns a 403 into no flow and forbidden", async () => {
    vi.mocked(fleet.getFlow).mockRejectedValue({ response: { status: 403 } });
    const read = mountRead(() => useFleetFlow(() => "1h"));
    await flushPromises();
    expect(read.flow.value).toBeNull();
    expect(read.forbidden.value).toBe(true);
  });

  it("refetches under a new key when the window changes", async () => {
    vi.mocked(fleet.getFlow).mockImplementation(
      async (_org, window) => ({ data: flow(window) }) as any,
    );
    const window = ref<FleetFlowWindow>("1h");
    const read = mountRead(() => useFleetFlow(() => window.value));
    await flushPromises();
    window.value = "5m";
    await flushPromises();
    expect(fleet.getFlow).toHaveBeenLastCalledWith("default", "5m");
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
