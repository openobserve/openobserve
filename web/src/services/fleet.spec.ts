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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "./http";
import fleet from "./fleet";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useMutation } from "@tanstack/vue-query";
import { purgeAllQueries, queryClient } from "@/composables/query/queryClient";
import {
  collectorsInFlight,
  createFleetConfigMutation,
  createFleetTokenMutation,
  deleteFleetConfigMutation,
  createFleetMutation,
  deleteFleetMutation,
  fleetPlanPreviewQuery,
  moveCollectorsMutation,
  redeliverCollectorMutation,
  renameCollectorMutation,
  renameFleetMutation,
  restartCollectorsMutation,
  rolloutExitMutation,
  updateFleetSettingsOfMutation,
  fleetAuditQuery,
  fleetCollectorQuery,
  fleetCollectorsQuery,
  fleetConfigQuery,
  fleetConfigVersionQuery,
  fleetConfigsQuery,
  fleetFlowQuery,
  fleetsQuery,
  FLOW_POLL_MS,
  fleetRolloutQuery,
  fleetRolloutsQuery,
  fleetSettingsQuery,
  fleetSummaryQuery,
  fleetTokensQuery,
  publishFleetConfigVersionMutation,
  revokeFleetTokenMutation,
  saveFleetConfigDraftMutation,
  setFleetDesiredMutation,
  deleteCollectorsMutation,
  updateFleetSettingsMutation,
  validateFleetConfigMutation,
} from "./fleet.queries";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import { fleetKeys } from "./fleet.querykeys";

vi.mock("./http", () => {
  const mockClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return { default: vi.fn(() => mockClient) };
});

describe("fleet service", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listCollectors() calls GET /api/{org}/fleet/collectors", () => {
    fleet.listCollectors("acme");
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/collectors");
  });

  it("getCollector() calls GET /api/{org}/fleet/collectors/{id} with the id encoded", () => {
    fleet.getCollector("acme", "a/b c");
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/collectors/a%2Fb%20c");
  });

  it("summary() calls GET /api/{org}/fleet/summary", () => {
    fleet.summary("acme");
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/summary");
  });

  it("listTokens() calls GET /api/{org}/fleet/tokens", () => {
    fleet.listTokens("acme");
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/tokens");
  });

  it("createToken() posts the body to /api/{org}/fleet/tokens", () => {
    const body = { name: "k8s", expires_in_days: null, max_uses: 5, fleet: "edge" };
    fleet.createToken("acme", body);
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/tokens", body);
  });

  it("revokeToken() posts to /api/{org}/fleet/tokens/{id}/revoke with the id encoded", () => {
    fleet.revokeToken("acme", "t/1");
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/tokens/t%2F1/revoke");
  });

  it("deleteCollector() deletes /api/{org}/fleet/collectors/{id}", () => {
    fleet.deleteCollector("acme", "a/b");
    expect(mockClient.delete).toHaveBeenCalledWith("/api/acme/fleet/collectors/a%2Fb");
  });

  it("renameCollector() PATCHes the nickname", () => {
    fleet.renameCollector("acme", "a/b", "edge-1");
    expect(mockClient.patch).toHaveBeenCalledWith("/api/acme/fleet/collectors/a%2Fb", {
      name: "edge-1",
    });
  });

  it("restartCollector() and redeliverCollector() post to their action paths", () => {
    fleet.restartCollector("acme", "c1");
    fleet.redeliverCollector("acme", "c1");
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/collectors/c1/restart");
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/collectors/c1/redeliver");
  });

  it("fleet CRUD goes through fleet/fleets, not the folders API", () => {
    fleet.createFleet("acme", "edge");
    fleet.renameFleet("acme", "f/1", "edge-2");
    fleet.deleteFleet("acme", "f/1");
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/fleets", { name: "edge" });
    expect(mockClient.patch).toHaveBeenCalledWith("/api/acme/fleet/fleets/f%2F1", {
      name: "edge-2",
    });
    expect(mockClient.delete).toHaveBeenCalledWith("/api/acme/fleet/fleets/f%2F1");
  });

  it("moveCollectors() posts the ids and the destination", () => {
    fleet.moveCollectors("acme", ["c1", "c2"], "edge");
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/fleets/move", {
      collector_ids: ["c1", "c2"],
      to_fleet: "edge",
    });
  });

  it("reads and writes a fleet's settings", () => {
    const body = {
      heartbeat_interval_secs: 15,
      offline_heartbeats: null,
      retention_days: null,
      offline_ratio_percent: null,
      phase_timeout_secs: null,
      gate: null,
    };
    fleet.getFleetSettings("acme", "edge");
    fleet.updateFleetSettings("acme", "edge", body);
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/fleets/edge/settings");
    expect(mockClient.put).toHaveBeenCalledWith("/api/acme/fleet/fleets/edge/settings", body);
  });

  it("previewDesired() posts the desired body to the preview path", () => {
    const body = {
      config: "edge",
      version: 2,
      start: { kind: "now" as const },
      batching: { kind: "canary" as const, first: 3 },
      verify: true,
      auto_rollback: false,
    };
    fleet.previewDesired("acme", "f1", body);
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/fleets/f1/desired/preview", body);
  });

  it("posts each rollout exit to its own path", () => {
    fleet.resumeRollout("acme", "r1");
    fleet.rollbackRollout("acme", "r1");
    fleet.skipRollout("acme", "r1", ["c1"]);
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/rollouts/r1/resume");
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/rollouts/r1/rollback");
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/rollouts/r1/skip", {
      collector_ids: ["c1"],
    });
  });

  it("listConfigs() calls GET /api/{org}/fleet/configs", () => {
    fleet.listConfigs("acme");
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/configs");
  });

  it("getConfig() calls GET /api/{org}/fleet/configs/{id} with the id encoded", () => {
    fleet.getConfig("acme", "a/b c");
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/configs/a%2Fb%20c");
  });

  it("createConfig() posts the body to /api/{org}/fleet/configs", () => {
    const body = { id: "edge", description: "Edge", yaml: "receivers: {}" };
    fleet.createConfig("acme", body);
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/configs", body);
  });

  it("saveConfigDraft() puts the yaml to /api/{org}/fleet/configs/{id}/draft", () => {
    fleet.saveConfigDraft("acme", "a/b", { yaml: "x: 1" });
    expect(mockClient.put).toHaveBeenCalledWith("/api/acme/fleet/configs/a%2Fb/draft", {
      yaml: "x: 1",
    });
  });

  it("publishConfigVersion() posts to /api/{org}/fleet/configs/{id}/versions", () => {
    fleet.publishConfigVersion("acme", "a b", { yaml: "x: 1", message: "m" });
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/configs/a%20b/versions", {
      yaml: "x: 1",
      message: "m",
    });
  });

  it("getConfigVersion() calls GET /api/{org}/fleet/configs/{id}/versions/{version}", () => {
    fleet.getConfigVersion("acme", "a/b", 3);
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/configs/a%2Fb/versions/3");
  });

  it("validateConfig() posts the yaml to /api/{org}/fleet/configs/validate", () => {
    fleet.validateConfig("acme", { yaml: "x: 1" });
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/configs/validate", {
      yaml: "x: 1",
    });
  });

  it("deleteConfig() deletes /api/{org}/fleet/configs/{id} with the id encoded", () => {
    fleet.deleteConfig("acme", "a/b");
    expect(mockClient.delete).toHaveBeenCalledWith("/api/acme/fleet/configs/a%2Fb");
  });

  it("listRollouts() calls GET /api/{org}/fleet/rollouts", () => {
    fleet.listRollouts("acme");
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/rollouts");
  });

  it("getRollout() calls GET /api/{org}/fleet/rollouts/{id} with the id encoded", () => {
    fleet.getRollout("acme", "a/b c");
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/rollouts/a%2Fb%20c");
  });

  it("setDesired() PUTs the body to /api/{org}/fleet/fleets/{id}/desired with the id encoded", () => {
    const body = {
      config: "edge",
      version: 2,
      start: { kind: "now" as const },
      batching: { kind: "one" as const },
      verify: false,
      auto_rollback: false,
    };
    fleet.setDesired("acme", "a/b c", body);
    expect(mockClient.put).toHaveBeenCalledWith("/api/acme/fleet/fleets/a%2Fb%20c/desired", body);
  });

  it("listFleets() calls GET /api/{org}/fleet/fleets", () => {
    fleet.listFleets("acme");
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/fleets");
  });

  it("has no label, apply, unenroll or pause calls", () => {
    for (const gone of [
      "updateCollector",
      "unenrollCollector",
      "createRollout",
      "pauseRollout",
      "stopRollout",
      "updateRollout",
      "rotateToken",
    ]) {
      expect(fleet, gone).not.toHaveProperty(gone);
    }
  });

  it("listAudit() calls GET /api/{org}/fleet/audit", () => {
    fleet.listAudit("acme");
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/audit");
  });

  it("getPipelines() calls GET /api/{org}/fleet/pipelines with the window as a param", () => {
    fleet.getPipelines("default", "24h");
    expect(mockClient.get).toHaveBeenCalledWith("/api/default/fleet/pipelines", {
      params: { window: "24h" },
    });
  });

  it("getSettings() calls GET /api/{org}/fleet/settings", () => {
    fleet.getSettings("default");
    expect(mockClient.get).toHaveBeenCalledWith("/api/default/fleet/settings");
  });

  it("updateSettings() PUTs the full body to /api/{org}/fleet/settings", () => {
    const body = {
      restricted_components: ["debug"],
      target_collector_version: null,
      fleet_defaults: {
        heartbeat_interval_secs: 30,
        offline_heartbeats: 3,
        retention_days: 30,
        offline_ratio_percent: 20,
        phase_timeout_secs: 1800,
        gate: { observe_secs: 600, window_secs: 300, pass_percent: 95 },
      },
    };
    fleet.updateSettings("default", body);
    expect(mockClient.put).toHaveBeenCalledWith("/api/default/fleet/settings", body);
  });
});

describe("fleet queries", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keys each flow window under the flows prefix the overview refresh invalidates", () => {
    const prefix = fleetKeys.flows("acme");
    expect(prefix.slice(0, fleetKeys.all("acme").length)).toEqual(fleetKeys.all("acme"));
    expect(fleetKeys.flow("acme", "5m").slice(0, prefix.length)).toEqual(prefix);
    expect(fleetKeys.flow("acme", "5m")).not.toEqual(fleetKeys.flow("acme", "1h"));
  });

  it("polls the flow every 15 s and unwraps its body", async () => {
    expect(FLOW_POLL_MS).toBe(15_000);
    const opts = fleetFlowQuery("acme", "5m");
    expect(opts.queryKey).toEqual(fleetKeys.flow("acme", "5m"));
    expect(opts.refetchInterval).toBe(FLOW_POLL_MS);
    mockClient.get.mockResolvedValueOnce({ data: { window: "5m", links: [] } });
    expect(await (opts.queryFn as any)()).toEqual({ window: "5m", links: [] });
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/pipelines", {
      params: { window: "5m" },
    });
  });

  it("roots every key at the org", () => {
    expect(fleetKeys.collectors("acme").slice(0, 2)).toEqual(["org", "acme"]);
    expect(fleetKeys.collector("acme", "c1").slice(0, 2)).toEqual(["org", "acme"]);
    expect(fleetKeys.summary("acme").slice(0, 2)).toEqual(["org", "acme"]);
    expect(fleetKeys.tokens("acme").slice(0, 2)).toEqual(["org", "acme"]);
  });

  it("keeps every key under the fleet invalidation scope", () => {
    const scope = fleetKeys.all("acme");
    for (const key of [
      fleetKeys.collectors("acme"),
      fleetKeys.collector("acme", "c1"),
      fleetKeys.summary("acme"),
      fleetKeys.tokens("acme"),
    ]) {
      expect(key.slice(0, scope.length)).toEqual(scope);
    }
  });

  it("unwraps the collector list envelope", async () => {
    mockClient.get.mockResolvedValueOnce({ data: { total: 1, items: [{ id: "c1" }] } });
    const items = await (fleetCollectorsQuery("acme").queryFn as any)();
    expect(items).toEqual([{ id: "c1" }]);
  });

  it.each([{}, { items: null }, { items: "x" }, null])(
    "fails the query on a malformed list response (%j)",
    async (data) => {
      mockClient.get.mockResolvedValueOnce({ data });
      await expect((fleetCollectorsQuery("acme").queryFn as any)()).rejects.toThrow();
    },
  );

  it("returns the detail and the summary bodies as is", async () => {
    mockClient.get.mockResolvedValueOnce({ data: { id: "c1", capabilities: [] } });
    expect(await (fleetCollectorQuery("acme", "c1").queryFn as any)()).toEqual({
      id: "c1",
      capabilities: [],
    });
    mockClient.get.mockResolvedValueOnce({ data: { target_version: "0.124.0" } });
    expect(await (fleetSummaryQuery("acme").queryFn as any)()).toEqual({
      target_version: "0.124.0",
    });
  });

  it("unwraps the token list envelope", async () => {
    mockClient.get.mockResolvedValueOnce({ data: { items: [{ id: "t1" }] } });
    expect(await (fleetTokensQuery("acme").queryFn as any)()).toEqual([{ id: "t1" }]);
  });

  it.each([{}, { items: null }, null])(
    "fails the token query on a malformed response (%j)",
    async (data) => {
      mockClient.get.mockResolvedValueOnce({ data });
      await expect((fleetTokensQuery("acme").queryFn as any)()).rejects.toThrow();
    },
  );

  it("keeps config keys under the fleet scope and version keys outside the config detail", () => {
    const scope = fleetKeys.all("acme");
    for (const key of [
      fleetKeys.configs("acme"),
      fleetKeys.config("acme", "edge"),
      fleetKeys.configVersions("acme", "edge"),
      fleetKeys.configVersion("acme", "edge", 2),
      fleetKeys.audit("acme"),
    ]) {
      expect(key.slice(0, scope.length)).toEqual(scope);
    }
    const detail = fleetKeys.config("acme", "edge");
    const version = fleetKeys.configVersion("acme", "edge", 2);
    expect(version.slice(0, detail.length)).not.toEqual(detail);
    const versions = fleetKeys.configVersions("acme", "edge");
    expect(version.slice(0, versions.length)).toEqual(versions);
  });

  it("unwraps the config list envelope and fails on a malformed one", async () => {
    mockClient.get.mockResolvedValueOnce({ data: { items: [{ id: "edge" }] } });
    expect(await (fleetConfigsQuery("acme").queryFn as any)()).toEqual([{ id: "edge" }]);
    mockClient.get.mockResolvedValueOnce({ data: { items: null } });
    await expect((fleetConfigsQuery("acme").queryFn as any)()).rejects.toThrow();
  });

  it("returns the config detail and a version body as is", async () => {
    mockClient.get.mockResolvedValueOnce({ data: { id: "edge", versions: [] } });
    expect(await (fleetConfigQuery("acme", "edge").queryFn as any)()).toEqual({
      id: "edge",
      versions: [],
    });
    mockClient.get.mockResolvedValueOnce({ data: { version: 2, yaml: "x: 1", hash: "ab" } });
    expect(await (fleetConfigVersionQuery("acme", "edge", 2).queryFn as any)()).toEqual({
      version: 2,
      yaml: "x: 1",
      hash: "ab",
    });
    expect(mockClient.get).toHaveBeenLastCalledWith("/api/acme/fleet/configs/edge/versions/2");
  });

  it("never refetches a published version, which is immutable", () => {
    expect(fleetConfigVersionQuery("acme", "edge", 2).staleTime).toBe(Infinity);
    expect(fleetConfigQuery("acme", "edge").staleTime).toBe(LIVE_STALE_TIME);
    expect(fleetConfigsQuery("acme").staleTime).toBe(LIVE_STALE_TIME);
    expect(fleetAuditQuery("acme").staleTime).toBe(LIVE_STALE_TIME);
  });

  it("keeps rollout keys under the fleet scope", () => {
    const scope = fleetKeys.all("acme");
    for (const key of [fleetKeys.rollouts("acme"), fleetKeys.rollout("acme", "r1")]) {
      expect(key.slice(0, scope.length)).toEqual(scope);
    }
  });

  it("unwraps the rollout list envelope and fails on a malformed one", async () => {
    mockClient.get.mockResolvedValueOnce({ data: { items: [{ id: "r1" }] } });
    expect(await (fleetRolloutsQuery("acme").queryFn as any)()).toEqual([{ id: "r1" }]);
    mockClient.get.mockResolvedValueOnce({ data: {} });
    await expect((fleetRolloutsQuery("acme").queryFn as any)()).rejects.toThrow();
  });

  it("returns the rollout detail as is", async () => {
    mockClient.get.mockResolvedValueOnce({ data: { id: "r1", members: ["c1"] } });
    expect(await (fleetRolloutQuery("acme", "r1").queryFn as any)()).toEqual({
      id: "r1",
      members: ["c1"],
    });
    expect(mockClient.get).toHaveBeenLastCalledWith("/api/acme/fleet/rollouts/r1");
  });

  const interval = (options: any, data: unknown) =>
    options.refetchInterval({ state: { data } } as any);

  it("polls the rollout list only while a rollout is in progress", () => {
    const q = fleetRolloutsQuery("acme");
    expect(interval(q, undefined)).toBe(false);
    expect(interval(q, [{ status: "completed" }])).toBe(false);
    expect(interval(q, [{ status: "completed" }, { status: "in_progress" }])).toBe(5000);
    expect(interval(q, [{ status: "superseded" }])).toBe(false);
  });

  it("never polls a completed, rolled back or superseded rollout", () => {
    for (const status of ["completed", "rolled_back", "superseded"]) {
      expect(interval(fleetRolloutsQuery("acme"), [{ status }])).toBe(false);
      expect(interval(fleetRolloutQuery("acme", "r1"), { status })).toBe(false);
    }
  });

  it("keeps polling a halted rollout only while its auto-rollback is owed", () => {
    const halted = { status: "halted", auto_rollback: true, halt: { class: "looks_worse" } };
    const list = fleetRolloutsQuery("acme");
    const detail = fleetRolloutQuery("acme", "r1");
    expect(interval(list, [halted])).toBe(5000);
    expect(interval(detail, { ...halted, halt: { class: "proven_bad" } })).toBe(5000);
    expect(interval(detail, { ...halted, halt: { class: "cannot_see" } })).toBe(false);
    expect(interval(detail, { ...halted, auto_rollback: false })).toBe(false);
  });

  it("refetches a scheduled rollout every minute and never a superseded one", () => {
    const scheduled = { status: "scheduled", total: 3, attempted: 0 };
    const superseded = { status: "superseded", total: 3, attempted: 1, accepted: 1 };
    expect(interval(fleetRolloutsQuery("acme"), [scheduled])).toBe(60_000);
    expect(interval(fleetRolloutQuery("acme", "r1"), scheduled)).toBe(60_000);
    expect(interval(fleetRolloutsQuery("acme"), [scheduled, { status: "in_progress" }])).toBe(5000);
    expect(interval(fleetRolloutsQuery("acme"), [superseded])).toBe(false);
    expect(interval(fleetRolloutQuery("acme", "r1"), superseded)).toBe(false);
  });

  it("unwraps the fleet list envelope and polls while a fleet's rollout moves", async () => {
    const opts = fleetsQuery("acme");
    expect(opts.queryKey).toEqual(fleetKeys.fleets("acme"));
    expect(fleetKeys.fleets("acme").slice(0, fleetKeys.all("acme").length)).toEqual(
      fleetKeys.all("acme"),
    );
    mockClient.get.mockResolvedValueOnce({ data: { items: [{ id: "default" }] } });
    expect(await (opts.queryFn as any)()).toEqual([{ id: "default" }]);
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/fleets");
    mockClient.get.mockResolvedValueOnce({ data: {} });
    await expect((opts.queryFn as any)()).rejects.toThrow();
    const at = (status: string) => [{ state: { rollout: { id: "r1", status } } }];
    expect(interval(opts, [{ state: null }, { state: { rollout: null } }])).toBe(false);
    expect(interval(opts, at("completed"))).toBe(false);
    expect(interval(opts, at("in_progress"))).toBe(5000);
    expect(interval(opts, at("halted"))).toBe(5000);
    expect(interval(opts, at("scheduled"))).toBe(60_000);
  });

  it("polls the collectors list while a row's delivery is in flight or a rollout moves", () => {
    const q = fleetCollectorsQuery("acme");
    expect(interval(q, [{ delivery: "running" }, { delivery: null }])).toBe(false);
    expect(interval(q, [{ delivery: "running" }, { delivery: "sent" }])).toBe(5000);
    queryClient.setQueryData(fleetKeys.rollouts("acme"), [
      { status: "in_progress", attempted: 0, total: 1 },
    ]);
    try {
      expect(interval(q, [{ delivery: "running" }])).toBe(5000);
    } finally {
      queryClient.clear();
    }
  });

  it("polls the summary while a rollout is active or an actively read list is delivering", () => {
    expect(interval(fleetSummaryQuery("acme"), { rollouts_active: 0 })).toBe(false);
    expect(interval(fleetSummaryQuery("acme"), undefined)).toBe(false);
    expect(interval(fleetSummaryQuery("acme"), { rollouts_active: 1 })).toBe(5000);
    expect(interval(fleetSummaryQuery("acme", true), { rollouts_active: 0 })).toBe(false);
  });

  it("finds a delivery in flight in a collectors list", () => {
    expect(collectorsInFlight(undefined)).toBe(false);
    expect(collectorsInFlight([{ delivery: "running" }] as any)).toBe(false);
    expect(collectorsInFlight([{ delivery: "sent" }] as any)).toBe(true);
  });

  it.each(["assigned", "sent", "accepted"])(
    "polls a collector's detail while its delivery is %s",
    (delivery) => {
      expect(interval(fleetCollectorQuery("acme", "c1"), { delivery })).toBe(5000);
    },
  );

  it.each([null, "running", "rejected"])(
    "does not poll a collector's detail when its delivery is %s",
    (delivery) => {
      expect(interval(fleetCollectorQuery("acme", "c1"), { delivery })).toBe(false);
    },
  );

  it("returns the audit envelope and fails on a malformed one", async () => {
    const list = { items: [{ id: "a1" }], audit_disabled: false };
    mockClient.get.mockResolvedValueOnce({ data: list });
    expect(await (fleetAuditQuery("acme").queryFn as any)()).toEqual(list);
    mockClient.get.mockResolvedValueOnce({ data: {} });
    await expect((fleetAuditQuery("acme").queryFn as any)()).rejects.toThrow();
  });

  it("keys the settings under the fleet scope and returns their body as is", async () => {
    const scope = fleetKeys.all("acme");
    expect(fleetKeys.settings("acme").slice(0, scope.length)).toEqual(scope);
    const opts = fleetSettingsQuery("acme");
    expect(opts.queryKey).toEqual(fleetKeys.settings("acme"));
    expect(opts.staleTime).toBe(LIVE_STALE_TIME);
    const body = { restricted_components: ["debug"], target_version: "0.170.0" };
    mockClient.get.mockResolvedValueOnce({ data: body });
    expect(await (opts.queryFn as any)()).toEqual(body);
    expect(mockClient.get).toHaveBeenCalledWith("/api/acme/fleet/settings");
  });
});

describe("fleet mutations", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();
  const run = (options: any, vars: unknown) =>
    queryClient.getMutationCache().build(queryClient, options).execute(vars);
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    invalidate = vi.spyOn(queryClient, "invalidateQueries");
  });

  afterEach(() => {
    invalidate.mockRestore();
    queryClient.clear();
  });

  it("returns the created token and refetches the token list", async () => {
    const created = { id: "t1", name: "k8s", token: "o2ft_secret" };
    mockClient.post.mockResolvedValueOnce({ data: created });
    const body = { name: "k8s", expires_in_days: 90, max_uses: null, fleet: "default" };
    expect(await run(createFleetTokenMutation("acme"), body)).toEqual(created);
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/tokens", body);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.tokens("acme") });
  });

  const heldPlaintext = () =>
    queryClient
      .getMutationCache()
      .getAll()
      .some((m: any) => m.state.data?.token === "o2ft_secret");

  function mountCreator() {
    let mutation!: ReturnType<typeof useMutation<any, any, any, any>>;
    const w = mount(
      defineComponent({
        setup() {
          mutation = useMutation(() => createFleetTokenMutation("acme"));
          return () => null;
        },
      }),
    );
    return { w, mutation: () => mutation };
  }

  it("drops the plaintext from the cache when the observing component resets", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { id: "t1", token: "o2ft_secret" } });
    const { w, mutation } = mountCreator();
    await mutation().mutateAsync({ name: "k8s" });
    expect(heldPlaintext()).toBe(true);
    mutation().reset();
    await vi.waitFor(() => expect(heldPlaintext()).toBe(false));
    expect(mutation().data.value).toBeUndefined();
    w.unmount();
  });

  it("drops the plaintext from the cache on a logout purge", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { id: "t1", token: "o2ft_secret" } });
    const { w, mutation } = mountCreator();
    await mutation().mutateAsync({ name: "k8s" });
    expect(heldPlaintext()).toBe(true);
    purgeAllQueries();
    expect(heldPlaintext()).toBe(false);
    w.unmount();
  });

  it("revokes a token and refetches every fleet read, since its collectors are cut off", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { id: "t1", revoked: true } });
    await run(revokeFleetTokenMutation("acme"), "t1");
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/tokens/t1/revoke");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.all("acme") });
    for (const key of [
      fleetKeys.tokens("acme"),
      fleetKeys.collectors("acme"),
      fleetKeys.collector("acme", "c1"),
      fleetKeys.summary("acme"),
    ]) {
      expect(key.slice(0, fleetKeys.all("acme").length)).toEqual(fleetKeys.all("acme"));
    }
  });

  it("removes once per id and refetches the collectors list and summary", async () => {
    mockClient.delete.mockResolvedValue({ status: 204 });
    expect(await run(deleteCollectorsMutation("acme"), ["c1", "c2"])).toEqual({
      succeeded: ["c1", "c2"],
      failed: [],
      firstError: null,
    });
    expect(mockClient.delete).toHaveBeenCalledTimes(2);
    expect(mockClient.delete).toHaveBeenCalledWith("/api/acme/fleet/collectors/c1");
    expect(mockClient.delete).toHaveBeenCalledWith("/api/acme/fleet/collectors/c2");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.collectors("acme") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.summary("acme") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.fleets("acme") });
  });

  it("drops the removed collectors' cached detail so a reopened drawer shows no ghost", async () => {
    mockClient.delete.mockResolvedValue({ status: 204 });
    queryClient.setQueryData(fleetKeys.collector("acme", "c1"), { id: "c1" });
    queryClient.setQueryData(fleetKeys.collector("acme", "c9"), { id: "c9" });
    await run(deleteCollectorsMutation("acme"), ["c1"]);
    expect(queryClient.getQueryData(fleetKeys.collector("acme", "c1"))).toBeUndefined();
    expect(queryClient.getQueryData(fleetKeys.collector("acme", "c9"))).toEqual({ id: "c9" });
  });

  it("reports a partial remove with the ids and the first failure", async () => {
    const err = { response: { status: 404, data: { message: "collector c2 not found" } } };
    mockClient.delete.mockResolvedValueOnce({ status: 204 }).mockRejectedValueOnce(err);
    expect(await run(deleteCollectorsMutation("acme"), ["c1", "c2"])).toEqual({
      succeeded: ["c1"],
      failed: ["c2"],
      firstError: err,
    });
  });

  it("drops cached detail only for the collectors that were removed", async () => {
    mockClient.delete
      .mockResolvedValueOnce({ status: 204 })
      .mockRejectedValueOnce({ response: { status: 500 } });
    queryClient.setQueryData(fleetKeys.collector("acme", "c1"), { id: "c1" });
    queryClient.setQueryData(fleetKeys.collector("acme", "c2"), { id: "c2" });
    await run(deleteCollectorsMutation("acme"), ["c1", "c2"]);
    expect(queryClient.getQueryData(fleetKeys.collector("acme", "c1"))).toBeUndefined();
    expect(queryClient.getQueryData(fleetKeys.collector("acme", "c2"))).toEqual({ id: "c2" });
  });

  it("refetches the audit log after a token is created or collectors are removed", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { id: "t1", token: "o2ft_x" } });
    await run(createFleetTokenMutation("acme"), { name: "k8s" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.audit("acme") });
    invalidate.mockClear();
    mockClient.delete.mockResolvedValue({ status: 204 });
    await run(deleteCollectorsMutation("acme"), ["c1"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.audit("acme") });
  });

  it("creates a config and refetches the list and the audit log", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { id: "edge" } });
    const body = { id: "edge", description: "", yaml: "x: 1" };
    expect(await run(createFleetConfigMutation("acme"), body)).toEqual({ id: "edge" });
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/configs", body);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.configs("acme") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.audit("acme") });
  });

  it("saves a draft and refetches only that config", async () => {
    mockClient.put.mockResolvedValueOnce({ data: { at: 1 } });
    await run(saveFleetConfigDraftMutation("acme"), { id: "edge", yaml: "x: 1" });
    expect(mockClient.put).toHaveBeenCalledWith("/api/acme/fleet/configs/edge/draft", {
      yaml: "x: 1",
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.config("acme", "edge") });
  });

  it("publishes a version and refetches the list, the config and the audit log", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { version: 1, warnings: {} } });
    const out = await run(publishFleetConfigVersionMutation("acme"), {
      id: "edge",
      yaml: "x: 1",
      message: "first",
    });
    expect(out).toEqual({ version: 1, warnings: {} });
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/configs/edge/versions", {
      yaml: "x: 1",
      message: "first",
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.configs("acme") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.config("acme", "edge") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.audit("acme") });
  });

  it("deletes a config and drops its cached detail and versions so a re-created id starts clean", async () => {
    mockClient.delete.mockResolvedValueOnce({ status: 204 });
    queryClient.setQueryData(fleetKeys.config("acme", "edge"), { id: "edge" });
    queryClient.setQueryData(fleetKeys.configVersion("acme", "edge", 1), { yaml: "old" });
    queryClient.setQueryData(fleetKeys.config("acme", "other"), { id: "other" });
    await run(deleteFleetConfigMutation("acme"), "edge");
    expect(mockClient.delete).toHaveBeenCalledWith("/api/acme/fleet/configs/edge");
    expect(queryClient.getQueryData(fleetKeys.config("acme", "edge"))).toBeUndefined();
    expect(queryClient.getQueryData(fleetKeys.configVersion("acme", "edge", 1))).toBeUndefined();
    expect(queryClient.getQueryData(fleetKeys.config("acme", "other"))).toEqual({ id: "other" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.configs("acme") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.audit("acme") });
  });

  it("validates without invalidating anything", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { issues: {} } });
    expect(await run(validateFleetConfigMutation("acme"), { yaml: "x: 1" })).toEqual({
      issues: {},
    });
    expect(mockClient.post).toHaveBeenCalledWith("/api/acme/fleet/configs/validate", {
      yaml: "x: 1",
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("silences the default error toast on every config mutation", () => {
    for (const m of [
      createFleetConfigMutation("acme"),
      saveFleetConfigDraftMutation("acme"),
      publishFleetConfigVersionMutation("acme"),
      deleteFleetConfigMutation("acme"),
      validateFleetConfigMutation("acme"),
    ]) {
      expect(m.meta?.silentError).toBe(true);
    }
  });

  it("sets a fleet's desired version and refetches every fleet read", async () => {
    const created = { id: "r1", status: "in_progress" };
    mockClient.put.mockResolvedValueOnce({ data: created });
    const body = {
      config: "edge",
      version: 2,
      start: { kind: "now" },
      batching: { kind: "one" },
      verify: true,
      auto_rollback: true,
    };
    expect(await run(setFleetDesiredMutation("acme"), { fleet: "f1", body })).toEqual(created);
    expect(mockClient.put).toHaveBeenCalledWith("/api/acme/fleet/fleets/f1/desired", body);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.all("acme") });
    expect(setFleetDesiredMutation("acme").meta?.silentError).toBe(true);
  });

  it("fails the remove with the first error when every call fails", async () => {
    const err = { response: { status: 403 } };
    mockClient.delete.mockRejectedValue(err);
    await expect(run(deleteCollectorsMutation("acme"), ["c1", "c2"])).rejects.toBe(err);
  });

  it("saves the settings and refetches every fleet read, since outdated moves everywhere", async () => {
    const body = {
      restricted_components: ["kafka"],
      target_collector_version: "0.170.0",
      fleet_defaults: {
        heartbeat_interval_secs: 30,
        offline_heartbeats: 3,
        retention_days: 30,
        offline_ratio_percent: 20,
        phase_timeout_secs: 1800,
        gate: { observe_secs: 600, window_secs: 300, pass_percent: 95 },
      },
    };
    mockClient.put.mockResolvedValueOnce({ data: body });
    expect(await run(updateFleetSettingsMutation("acme"), body)).toEqual(body);
    expect(mockClient.put).toHaveBeenCalledWith("/api/acme/fleet/settings", body);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.all("acme") });
    expect(updateFleetSettingsMutation("acme").meta?.silentError).toBe(true);
  });

  it("moves collectors and refetches every fleet read", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { moved: 2 } });
    expect(await run(moveCollectorsMutation("acme"), { ids: ["c1", "c2"], to: "edge" })).toEqual({
      moved: 2,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.all("acme") });
  });

  it("restarts once per id and reports a partial result", async () => {
    const err = { response: { status: 409 } };
    mockClient.post.mockResolvedValueOnce({ data: { queued: true } }).mockRejectedValueOnce(err);
    expect(await run(restartCollectorsMutation("acme"), ["c1", "c2"])).toEqual({
      succeeded: ["c1"],
      failed: ["c2"],
      firstError: err,
    });
  });

  it("redelivers and renames a collector, refetching its detail", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { revision: 4 } });
    expect(await run(redeliverCollectorMutation("acme"), "c1")).toEqual({ revision: 4 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.collector("acme", "c1") });
    invalidate.mockClear();
    mockClient.patch.mockResolvedValueOnce({ data: { id: "c1", name: "edge" } });
    await run(renameCollectorMutation("acme"), { id: "c1", name: "edge" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.collector("acme", "c1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.collectors("acme") });
  });

  it("creates, renames and deletes fleets through their own API", async () => {
    mockClient.post.mockResolvedValueOnce({ data: { id: "f1", name: "edge" } });
    expect(await run(createFleetMutation("acme"), "edge")).toEqual({ id: "f1", name: "edge" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.fleets("acme") });
    mockClient.patch.mockResolvedValueOnce({ data: { id: "f1", name: "edge-2" } });
    await run(renameFleetMutation("acme"), { id: "f1", name: "edge-2" });
    mockClient.delete.mockResolvedValueOnce({ status: 204 });
    await run(deleteFleetMutation("acme"), "f1");
    expect(mockClient.delete).toHaveBeenCalledWith("/api/acme/fleet/fleets/f1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.all("acme") });
  });

  it("saves a fleet's settings into its cache entry", async () => {
    const body = {
      heartbeat_interval_secs: 10,
      offline_heartbeats: null,
      retention_days: null,
      offline_ratio_percent: null,
      phase_timeout_secs: null,
      gate: null,
    };
    mockClient.put.mockResolvedValueOnce({ data: body });
    await run(updateFleetSettingsOfMutation("acme"), { id: "f1", body });
    expect(queryClient.getQueryData(fleetKeys.fleetSettings("acme", "f1"))).toEqual(body);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.fleets("acme") });
    queryClient.clear();
  });

  it.each([
    ["resume", "/api/acme/fleet/rollouts/r1/resume", undefined],
    ["rollback", "/api/acme/fleet/rollouts/r1/rollback", undefined],
    ["skip", "/api/acme/fleet/rollouts/r1/skip", { collector_ids: ["c1"] }],
  ] as const)("posts the %s exit and refetches every fleet read", async (exit, path, body) => {
    mockClient.post.mockResolvedValueOnce({ data: { id: "r1" } });
    await run(rolloutExitMutation("acme"), { id: "r1", exit, collectorIds: ["c1"] });
    if (body) expect(mockClient.post).toHaveBeenCalledWith(path, body);
    else expect(mockClient.post).toHaveBeenCalledWith(path);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetKeys.all("acme") });
  });

  it("keys each plan preview by its body", () => {
    const body = {
      config: "edge",
      version: 2,
      start: { kind: "now" as const },
      batching: { kind: "one" as const },
      verify: false,
      auto_rollback: false,
    };
    const a = fleetPlanPreviewQuery("acme", "f1", body).queryKey;
    const b = fleetPlanPreviewQuery("acme", "f1", { ...body, verify: true }).queryKey;
    expect(a).not.toEqual(b);
    expect(a.slice(0, fleetKeys.all("acme").length)).toEqual(fleetKeys.all("acme"));
  });
});
