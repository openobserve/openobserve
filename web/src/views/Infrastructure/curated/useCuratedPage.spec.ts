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

// The curated engine's orchestration layer (design §5.1-§5.6): faces, the await
// graph, force propagation, the semantic-groups ladder and the identity-stable
// dashboard ref. Fan-out/generation conventions follow useHostsList.spec.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import type { FieldAlias } from "@/services/service_streams";
import defaultSemanticGroups from "./packs/__fixtures__/semanticGroups.default.json";
import { useCuratedPage } from "./useCuratedPage";
import { GROUP } from "./types";
import { kubernetesPage } from "./packs/kubernetes.page";
import { hostsPage } from "./packs/hosts.page";

const { getStreamsMock, getStreamMock, loadSemanticGroupsMock, clearGroupsForOrgMock } = vi.hoisted(
  () => ({
    getStreamsMock: vi.fn(),
    getStreamMock: vi.fn(),
    loadSemanticGroupsMock: vi.fn(),
    clearGroupsForOrgMock: vi.fn(),
  }),
);

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: getStreamsMock, getStream: getStreamMock }),
}));

vi.mock("@/utils/semanticGroupsCache", () => ({
  loadSemanticGroups: loadSemanticGroupsMock,
  clearSemanticGroupsCacheForOrg: clearGroupsForOrgMock,
  getCachedSemanticGroups: vi.fn(() => null),
}));

vi.mock("@/services/search", () => ({
  default: { search: vi.fn(), metrics_query: vi.fn(), metrics_query_range: vi.fn() },
}));

const groups = defaultSemanticGroups as FieldAlias[];
const dictionary = (...ids: string[]): FieldAlias[] =>
  ids.map((id) => {
    const found = groups.find((g) => g.id === id);
    if (!found) throw new Error(`fixture group ${id} missing`);
    return found;
  });

const K8S_DICT = dictionary(GROUP.namespace, GROUP.pod, GROUP.node, GROUP.cluster, GROUP.host);

const NOW_US = 1_800_000_000_000_000;
const HOUR_US = 60 * 60 * 1_000_000;
const RANGE = { start: NOW_US - 3 * HOUR_US, end: NOW_US };

const streamEntry = (name: string, schema: string[] = [], docTimeMax = NOW_US - 60_000_000) => ({
  name,
  stream_type: "metrics",
  stats: {
    created_at: 0,
    doc_time_min: 0,
    doc_time_max: docTimeMax,
    doc_num: 1,
    file_num: 1,
    storage_size: 1,
    compressed_size: 1,
    index_size: 0,
  },
  schema: schema.map((n) => ({ name: n, type: "Utf8" })),
});

const NODE_SCHEMA = ["k8s_node_name", "k8s_cluster_name"];
const POD_SCHEMA = ["k8s_namespace_name", "k8s_pod_name"];
const KUBE_SCHEMA = ["namespace", "pod", "node", "phase", "condition", "status", "resource"];

const K8S_METRICS = [
  streamEntry("k8s_node_cpu_usage", NODE_SCHEMA),
  streamEntry("k8s_node_memory_usage", NODE_SCHEMA),
  streamEntry("k8s_node_network_io", NODE_SCHEMA),
  streamEntry("k8s_pod_cpu_usage", POD_SCHEMA),
  streamEntry("k8s_pod_memory_usage", POD_SCHEMA),
  streamEntry("k8s_pod_memory_limit_utilization", POD_SCHEMA),
  streamEntry("k8s_pod_network_io", POD_SCHEMA),
  streamEntry("k8s_pod_filesystem_usage", POD_SCHEMA),
  streamEntry("k8s_pod_filesystem_capacity", POD_SCHEMA),
  streamEntry("kube_pod_status_phase", KUBE_SCHEMA),
  streamEntry("kube_node_status_condition", KUBE_SCHEMA),
  streamEntry("kube_pod_container_resource_requests", KUBE_SCHEMA),
  streamEntry("kube_pod_container_status_restarts_total", KUBE_SCHEMA),
];

const HOSTS_METRICS = [
  "system_cpu_time",
  "system_memory_usage",
  "system_cpu_load_average_1m",
  "system_cpu_load_average_5m",
  "system_cpu_load_average_15m",
  "system_disk_io",
  "system_filesystem_usage",
  "system_network_io",
].map((n) => streamEntry(n, ["host_name"]));

/** Route getStreams by stream type so wiring is order-independent. */
const primeStreams = (byType: Record<string, any[]>) => {
  getStreamsMock.mockImplementation(async (type: string) => ({
    name: type,
    schema: false,
    list: byType[type] ?? [],
  }));
};

const withCuratedPage = (manifest: any = kubernetesPage, opts: any = undefined) => {
  const store = createStore({
    state: { selectedOrganization: { identifier: "test-org" }, timezone: "UTC" },
  });
  let page!: ReturnType<typeof useCuratedPage>;
  const wrapper = mount(
    defineComponent({
      setup() {
        page = useCuratedPage(manifest, opts);
        return () => null;
      },
    }),
    { global: { plugins: [store] } },
  );
  return { page, wrapper };
};

const refreshArgs = { orgId: "test-org", start: RANGE.start, end: RANGE.end };

const visiblePanelIds = (page: any): string[] =>
  ((page.dashboard.value as any)?.tabs ?? []).flatMap((t: any) =>
    (t.panels ?? []).map((p: any) => p.id as string),
  );

describe("useCuratedPage", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    primeStreams({ metrics: K8S_METRICS, logs: [] });
    getStreamMock.mockImplementation(async (name: string) => streamEntry(name, KUBE_SCHEMA));
    loadSemanticGroupsMock.mockResolvedValue(K8S_DICT);
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  // ── Face ladder (§5.1, §5.6) ─────────────────────────────────────────────

  describe("face ladder", () => {
    it("is `unknown` before any refresh — lists are the one hard dependency", () => {
      const h = withCuratedPage();
      wrapper = h.wrapper;
      expect(h.page.face.value).toBe("unknown");
      expect(h.page.loadError.value).toBe(false);
      expect(h.page.dashboard.value).toBeNull();
    });

    it("≥1 present group ⇒ `ready`", async () => {
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.face.value).toBe("ready");
      expect(h.page.dashboard.value).not.toBeNull();
    });

    it("lists loaded but ZERO groups present ⇒ `undetected`", async () => {
      primeStreams({ metrics: [], logs: [] });
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.face.value).toBe("undetected");
    });

    it("L0-detected with zero groups ⇒ `undetected`, and l0State is EXPOSED for the view's line", () => {
      // The nav's "detected" and the page's setup face must tell one story (§6.1).
      const h = withCuratedPage();
      wrapper = h.wrapper;
      expect(h.page.l0State).toBeDefined();
    });

    it("lists REJECTED ⇒ face stays `unknown` AND loadError flips true — not an infinite spinner", async () => {
      getStreamsMock.mockRejectedValue(new Error("network"));
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.face.value).toBe("unknown");
      expect(h.page.loadError.value).toBe(true);
    });

    it("a successful FORCED retry clears loadError and reaches `ready`", async () => {
      getStreamsMock.mockRejectedValueOnce(new Error("network")).mockRejectedValueOnce(new Error("network"));
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.loadError.value).toBe(true);

      primeStreams({ metrics: K8S_METRICS, logs: [] });
      await h.page.refresh({ ...refreshArgs, force: true });
      await flushPromises();
      expect(h.page.loadError.value).toBe(false);
      expect(h.page.face.value).toBe("ready");
    });
  });

  // ── Request discipline (§5.2, §5.6) ──────────────────────────────────────

  describe("request discipline", () => {
    it("calls getStreams as (type, false, false, force) — the notify=false regression pin", async () => {
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(getStreamsMock).toHaveBeenCalledWith("metrics", false, false, false);

      getStreamsMock.mockClear();
      await h.page.refresh({ ...refreshArgs, force: true });
      await flushPromises();
      expect(getStreamsMock).toHaveBeenCalledWith("metrics", false, false, true);
    });

    it("a WARM range-only refresh fires ZERO getStreams/getStream calls", async () => {
      // The §5.6 first-paint budget, as an assertion: presence and concept passes
      // never re-run without `force`.
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      getStreamsMock.mockClear();
      getStreamMock.mockClear();
      loadSemanticGroupsMock.mockClear();
      await h.page.refresh({ ...refreshArgs, start: RANGE.start - HOUR_US });
      await flushPromises();
      expect(getStreamsMock).not.toHaveBeenCalled();
      expect(getStreamMock).not.toHaveBeenCalled();
      expect(loadSemanticGroupsMock).not.toHaveBeenCalled();
    });

    it("propagates force:true into every getStream — a session-pinned schema defeats detection flips", async () => {
      // kube-state overrides all three of its concepts, so drive the fetch off the
      // kubeletstats groups with the dictionary missing them.
      loadSemanticGroupsMock.mockResolvedValue([]);
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh({ ...refreshArgs, force: true });
      await flushPromises();
      for (const call of getStreamMock.mock.calls) {
        expect(call[3]).toBe(true);
      }
    });

    it("drops a SUPERSEDED response when a second refresh starts mid-flight", async () => {
      let releaseFirst!: (v: any) => void;
      getStreamsMock.mockImplementationOnce(
        () => new Promise((resolve) => (releaseFirst = resolve)),
      );
      const h = withCuratedPage();
      wrapper = h.wrapper;

      const first = h.page.refresh(refreshArgs);
      primeStreams({ metrics: K8S_METRICS, logs: [] });
      await h.page.refresh({ ...refreshArgs, force: true });
      await flushPromises();
      const afterSecond = visiblePanelIds(h.page);

      releaseFirst({ name: "metrics", schema: false, list: [] });
      await first;
      await flushPromises();
      // The stale empty list must not blank the page the newer refresh built.
      expect(visiblePanelIds(h.page)).toEqual(afterSecond);
      expect(h.page.face.value).toBe("ready");
    });

    it("two instances share no state", async () => {
      const a = withCuratedPage();
      const b = withCuratedPage();
      wrapper = a.wrapper;
      await a.page.refresh(refreshArgs);
      await flushPromises();
      expect(a.page.face.value).toBe("ready");
      expect(b.page.face.value).toBe("unknown");
      b.wrapper.unmount();
    });
  });

  // ── Semantic groups ladder (§5.4, §5.6) ──────────────────────────────────

  describe("semantic groups", () => {
    const forbidden = () => Object.assign(new Error("Forbidden"), { response: { status: 403 } });

    it("403 pushes NO warning and is negative-cached — a second refresh fires zero requests", async () => {
      // The shared cache writes on success only, so without the engine's own
      // negative cache every refresh re-fires the doomed request.
      loadSemanticGroupsMock.mockImplementation(async (_org: string, onError?: any) => {
        onError?.(forbidden());
        return [];
      });
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.warnings.value.map((w: any) => w.kind)).not.toContain("semantic-groups");
      expect(h.page.warnings.value.map((w: any) => w.kind)).not.toContain("groups-missing");

      loadSemanticGroupsMock.mockClear();
      await h.page.refresh({ ...refreshArgs, force: false });
      await flushPromises();
      expect(loadSemanticGroupsMock).not.toHaveBeenCalled();
    });

    it("403 still renders the override-resolved panels — the O-1 interim path end to end", async () => {
      loadSemanticGroupsMock.mockImplementation(async (_org: string, onError?: any) => {
        onError?.(forbidden());
        return [];
      });
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.face.value).toBe("ready");
      // kube-state's overrides are dictionary-independent.
      expect(visiblePanelIds(h.page)).toContain("k8s_wl_nonrunning_by_ns");
    });

    it("5xx / network error pushes a `semantic-groups` warning — it is transient, unlike a 403", async () => {
      loadSemanticGroupsMock.mockImplementation(async (_org: string, onError?: any) => {
        onError?.(Object.assign(new Error("boom"), { response: { status: 500 } }));
        return [];
      });
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.warnings.value.map((w: any) => w.kind)).toContain("semantic-groups");
    });

    it("an EMPTY [] from a 200 warns `groups-missing` and is NOT negative-cached", async () => {
      // An enterprise org with no dictionary is a genuine misconfiguration, and
      // unlike a 403 it can fix itself — so the two paths differ deliberately.
      loadSemanticGroupsMock.mockResolvedValue([]);
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.warnings.value.map((w: any) => w.kind)).toContain("groups-missing");

      loadSemanticGroupsMock.mockClear();
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(loadSemanticGroupsMock).toHaveBeenCalled();
    });

    it("a named group absent from a NON-EMPTY dictionary warns `groups-missing`", async () => {
      loadSemanticGroupsMock.mockResolvedValue(
        dictionary(GROUP.namespace, GROUP.pod, GROUP.cluster, GROUP.host),
      );
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      const warning = h.page.warnings.value.find((w: any) => w.kind === "groups-missing");
      expect(warning).toBeDefined();
      expect(warning.message).toContain(GROUP.node);
    });

    it("DRY-RUN finding 13: the OBSERVED lossy override still renders — rung 4a is load-bearing", async () => {
      // The validation deployment returns a set with one default group MISSING and
      // a non-default one present, because saving an override REPLACES the set.
      loadSemanticGroupsMock.mockResolvedValue([
        ...groups.filter((g) => g.id !== GROUP.node),
        {
          id: "common-prabhat-env",
          display: "Prabhat Env",
          group: "Common",
          fields: ["prabhat-cluster", "prabhat-ns"],
        },
      ]);
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(visiblePanelIds(h.page)).toContain("k8s_nd_cpu");
      expect(h.page.warnings.value.filter((w: any) => w.kind === "groups-missing")).toHaveLength(1);
    });

    it("force:true CLEARS the shared groups cache first — the admin-edited-groups case", async () => {
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      clearGroupsForOrgMock.mockClear();
      loadSemanticGroupsMock.mockClear();
      await h.page.refresh({ ...refreshArgs, force: true });
      await flushPromises();
      expect(clearGroupsForOrgMock).toHaveBeenCalledWith("test-org");
      expect(loadSemanticGroupsMock).toHaveBeenCalled();
    });

    it("a NON-forced refresh inside the TTL fires zero semantic requests", async () => {
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      loadSemanticGroupsMock.mockClear();
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(loadSemanticGroupsMock).not.toHaveBeenCalled();
    });
  });

  // ── Render-more invariant (§5.6) ─────────────────────────────────────────

  describe("render-more invariant", () => {
    it("a REJECTED schema fetch renders the panel with a `schema` warning — never hides it", async () => {
      // A transport failure is not evidence of a missing field.
      loadSemanticGroupsMock.mockResolvedValue([]);
      getStreamMock.mockRejectedValue(new Error("schema 500"));
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.face.value).toBe("ready");
      expect(h.page.warnings.value.map((w: any) => w.kind)).toContain("schema");
      expect(visiblePanelIds(h.page).length).toBeGreaterThan(0);
    });

    it("ZERO-SHAPED stats render unbadged with a `stats` warning", async () => {
      primeStreams({
        metrics: K8S_METRICS.map((s) => ({ ...s, stats: undefined })),
        logs: [],
      });
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.warnings.value.map((w: any) => w.kind)).toContain("stats");
      expect(h.page.staleGroups.value).toEqual([]);
    });
  });

  // ── Identity stability (§5.5) ────────────────────────────────────────────

  describe("dashboard identity", () => {
    it("a range-only refresh with UNCHANGED resolution keeps the SAME dashboardData reference", async () => {
      // RenderDashboardCharts re-inits its whole variables manager on any new
      // object — a rebuild per range change resets picker selections.
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      const first = h.page.dashboard.value;

      await h.page.refresh({ ...refreshArgs, start: RANGE.start - HOUR_US });
      await flushPromises();
      expect(h.page.dashboard.value).toBe(first);
    });

    it("a CHANGED resolution swaps the reference", async () => {
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      const first = h.page.dashboard.value;

      primeStreams({
        metrics: K8S_METRICS.filter((s) => !s.name.startsWith("kube_")),
        logs: [],
      });
      await h.page.refresh({ ...refreshArgs, force: true });
      await flushPromises();
      expect(h.page.dashboard.value).not.toBe(first);
    });
  });

  // ── Hosts pack — the synchronous-open contract (§7.3) ────────────────────

  describe("hosts pack resolution", () => {
    beforeEach(() => {
      primeStreams({ metrics: HOSTS_METRICS, logs: [] });
    });

    it("fires ZERO getStream calls AND ZERO loadSemanticGroups calls", async () => {
      // Fails on BOTH regressions: dropping fieldOverrides so anchorStream takes
      // over, and making the dictionary load unconditional.
      const h = withCuratedPage(hostsPage, { pins: { [GROUP.host]: "web-01" } });
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(getStreamMock).not.toHaveBeenCalled();
      expect(loadSemanticGroupsMock).not.toHaveBeenCalled();
      expect(h.page.face.value).toBe("ready");
    });

    it("plumbs opts.lastSeenUs through to badge computation, beating the fleet-wide max", async () => {
      const deadHost = NOW_US - 5 * 24 * HOUR_US;
      const h = withCuratedPage(hostsPage, {
        pins: { [GROUP.host]: "web-01" },
        lastSeenUs: deadHost,
      });
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.staleGroups.value).toHaveLength(1);
      expect(h.page.staleGroups.value[0].lastSeenUs).toBe(deadHost);
    });
  });

  // ── Positive freshness (finding 23a) ─────────────────────────────────────

  describe("positive freshness", () => {
    it("exposes lastDataUs when every present group is fresh", async () => {
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(typeof h.page.lastDataUs.value).toBe("number");
    });

    it("lastDataUs is NULL when any group is stale — the line never sits beside the banner", async () => {
      primeStreams({
        metrics: K8S_METRICS.map((s) =>
          s.name.startsWith("kube_")
            ? { ...s, stats: { ...s.stats, doc_time_max: NOW_US - 3 * 24 * HOUR_US } }
            : s,
        ),
        logs: [],
      });
      const longRange = { ...refreshArgs, start: NOW_US - 30 * 24 * HOUR_US };
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(longRange);
      await flushPromises();
      expect(h.page.staleGroups.value.length).toBeGreaterThan(0);
      expect(h.page.lastDataUs.value).toBeNull();
    });
  });

  // ── Strip model surfaced to the view ─────────────────────────────────────

  describe("hidden/stale group models", () => {
    it("hidden groups carry reason, capabilityKey, panelCount and tagged missingStreams", async () => {
      primeStreams({
        metrics: K8S_METRICS.filter((s) => s.name.startsWith("kube_")),
        logs: [],
      });
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      const hidden = h.page.hiddenGroups.value.find((g: any) => g.group.id === "kubelet-node");
      expect(hidden).toBeDefined();
      expect(hidden.reason).toBe("streams-missing");
      expect(hidden.group.capabilityKey).toBeTruthy();
      expect(hidden.panelCount).toBeGreaterThan(0);
      expect(hidden.missingStreams.every((m: any) => m.state === "absent")).toBe(true);
    });

    it("a DEAD stream is reported as `stale` with its lastSeenUs, never as absent", async () => {
      const dead = NOW_US - 177 * 24 * HOUR_US;
      primeStreams({
        metrics: [
          ...K8S_METRICS.filter((s) => s.name.startsWith("kube_")),
          streamEntry("k8s_node_cpu_usage", NODE_SCHEMA, dead),
          streamEntry("k8s_node_cpu_utilization", NODE_SCHEMA, dead),
          streamEntry("k8s_node_memory_usage", NODE_SCHEMA, dead),
          streamEntry("k8s_node_memory_rss", NODE_SCHEMA, dead),
          streamEntry("k8s_node_network_io", NODE_SCHEMA, dead),
        ],
        logs: [],
      });
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      const hidden = h.page.hiddenGroups.value.find((g: any) => g.group.id === "kubelet-node");
      expect(hidden.missingStreams.every((m: any) => m.state === "stale")).toBe(true);
      expect(hidden.missingStreams.every((m: any) => m.lastSeenUs === dead)).toBe(true);
    });
  });
});
