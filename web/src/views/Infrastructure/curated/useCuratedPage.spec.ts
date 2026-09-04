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
import { useCuratedPage, PROBE_TIMEOUT_MS } from "./useCuratedPage";
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

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

vi.mock("@/services/search", () => ({
  default: { search: searchMock, metrics_query: vi.fn(), metrics_query_range: vi.fn() },
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

// ── Synthetic probe pack ───────────────────────────────────────────────────
// The probe ladder is ENGINE behavior (§5.2 pass 1b), not AWS pack content, so
// it is pinned against a pack-agnostic manifest. The AWS pack is deferred; these
// rows must not wait on it, and must not author it either.

const logsEntry = (name: string, schema: string[], docTimeMax = NOW_US - 60_000_000) => ({
  ...streamEntry(name, schema, docTimeMax),
  stream_type: "logs",
});

const probeGroup = (id: string, streams: string[], field: string) => ({
  id,
  labelKey: `synthetic.${id}.label`,
  capabilityKey: `synthetic.${id}.cap`,
  setupHintKey: `synthetic.${id}.hint`,
  setup: { kind: "route", routeName: "syntheticSetup" },
  streamType: "logs",
  probe: { streams, sqlFilter: `${field} IS NOT NULL`, fields: [field] },
  fieldOverrides: { [GROUP.host]: "host_name" },
});

const probePanel = (id: string, groupId: string) => ({
  id,
  groupId,
  titleKey: `synthetic.${id}.title`,
  type: "line",
  layout: { w: 96, h: 16 },
  variants: [
    {
      queryType: "sql",
      requiresStreams: [] as string[],
      fields: { x: [], y: [], breakdown: [] },
      queries: [{ query: `SELECT COUNT(*) FROM "<probe>"`, legend: "" }],
    },
  ],
  drilldown: [],
});

/** Four probe groups — the four-ladder shape the asymmetric settle rule needs. */
const PROBE_IDS = ["alpha", "beta", "gamma", "delta"];
const PROBE_FIELDS: Record<string, string> = {
  alpha: "alpha_field",
  beta: "beta_field",
  gamma: "gamma_field",
  delta: "delta_field",
};

const syntheticProbePage: any = {
  id: "synthetic",
  titleKey: "synthetic.title",
  icon: "server",
  contentVersion: 1,
  defaultRelativePeriod: "3h",
  stalenessThresholdUs: 24 * 60 * 60 * 1_000_000,
  groups: PROBE_IDS.map((id) => probeGroup(id, [`${id}_stream`, "default"], PROBE_FIELDS[id])),
  scopePickers: [],
  sections: [
    {
      id: "overview",
      titleKey: "synthetic.overview",
      scopedBy: [],
      panels: PROBE_IDS.map((id) => probePanel(`${id}_p1`, id)),
    },
  ],
};

/** Every probe candidate present, live, and carrying its probe column. */
const primeProbeStreams = (over: Record<string, string[]> = {}) => {
  const list = PROBE_IDS.map((id) => logsEntry(`${id}_stream`, over[id] ?? [PROBE_FIELDS[id]]));
  list.push(logsEntry("default", over.default ?? []));
  primeStreams({ metrics: [], logs: list });
  getStreamMock.mockImplementation(async (name: string) => {
    const found = list.find((s) => s.name === name);
    if (!found) throw new Error(`no schema for ${name}`);
    return found;
  });
};

/** A promise plus its settle handles — the controllable probe deferred. */
const deferred = () => {
  let resolve!: (v: any) => void;
  let reject!: (e: any) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const countHits = (n: number) => ({ data: { hits: [{ zo_count: n }] } });

/** Route each group's COUNT to its own deferred, keyed by the probed stream. */
const primeProbeDeferreds = () => {
  const gates: Record<string, ReturnType<typeof deferred>> = {};
  for (const id of PROBE_IDS) gates[id] = deferred();
  searchMock.mockImplementation((args: any) => {
    const sql = JSON.stringify(args?.query ?? args ?? "");
    const hit = PROBE_IDS.find((id) => sql.includes(`${id}_stream`));
    return hit ? gates[hit].promise : Promise.resolve(countHits(0));
  });
  return gates;
};

const presentGroupIds = (page: any): string[] =>
  ((page.dashboard.value as any)?.tabs ?? [])
    .flatMap((t: any) => t.panels ?? [])
    .map((p: any) => String(p.id).replace(/_p1$/, ""));

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
    searchMock.mockResolvedValue(countHits(0));
  });

  afterEach(() => {
    // Restoring inside a test body leaks fake timers over the whole file if that
    // body throws first — every later case then hangs on a real await.
    vi.useRealTimers();
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

    it("L0-detected with zero groups ⇒ `undetected`, and l0State reads `detected`", async () => {
      // The nav's "detected" and the page's setup face must tell one story (§6.1):
      // k8s streams ARE arriving, but none satisfies a pack group, so the face must
      // claim absence while l0State keeps saying the workload was seen — the exact
      // pair the partialTelemetry line needs. `toBeDefined()` alone passed on ref(null).
      primeStreams({
        metrics: [streamEntry("k8s_ingress_requests_total", NODE_SCHEMA)],
        logs: [],
      });
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.face.value).toBe("undetected");
      expect(h.page.l0State.value).toBe("detected");
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
      getStreamsMock
        .mockRejectedValueOnce(new Error("network"))
        .mockRejectedValueOnce(new Error("network"));
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

  // ── Asymmetric settle rule (§5.1, §5.6 — pass-4 finding 14b) ─────────────

  describe("asymmetric face-ladder settle", () => {
    beforeEach(() => {
      primeProbeStreams();
    });

    it("(a) the FIRST ladder to pass flips `ready` while the others are still pending", async () => {
      // The fast-CloudTrail case: `ready` claims only "here is some data", which
      // nothing arriving later can falsify, so it must not wait on the slowest
      // probe. Previously the page held the spinner for the whole 4s budget.
      const gates = primeProbeDeferreds();
      const h = withCuratedPage(syntheticProbePage);
      wrapper = h.wrapper;

      const pending = h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.face.value).toBe("unknown");

      gates.alpha.resolve(countHits(42));
      await flushPromises();
      expect(h.page.face.value).toBe("ready");

      for (const id of ["beta", "gamma", "delta"]) gates[id].resolve(countHits(0));
      await pending;
      await flushPromises();
    });

    it("(b) a LATER-settling pass ADDS its panels; the face never leaves `ready`", async () => {
      const gates = primeProbeDeferreds();
      const h = withCuratedPage(syntheticProbePage);
      wrapper = h.wrapper;

      const pending = h.page.refresh(refreshArgs);
      await flushPromises();

      gates.alpha.resolve(countHits(1));
      await flushPromises();
      const afterFirst = visiblePanelIds(h.page);
      expect(h.page.face.value).toBe("ready");

      gates.beta.resolve(countHits(1));
      await flushPromises();
      const afterSecond = visiblePanelIds(h.page);
      // Groups that pass later mount into the already-rendered page.
      expect(afterSecond.length).toBeGreaterThan(afterFirst.length);
      expect(presentGroupIds(h.page)).toEqual(expect.arrayContaining(["alpha", "beta"]));
      expect(h.page.face.value).toBe("ready");

      for (const id of ["gamma", "delta"]) gates[id].resolve(countHits(0));
      await pending;
      await flushPromises();
      expect(h.page.face.value).toBe("ready");
    });

    it("(c) ladders IN FLIGHT with zero passes stay `unknown` — never a premature setup face", async () => {
      // `undetected` asserts ABSENCE, and a returning COUNT can falsify that, so
      // it requires EVERY ladder to have settled. This guarantee is unchanged by
      // the asymmetry above and is the reason the two faces differ.
      const gates = primeProbeDeferreds();
      const h = withCuratedPage(syntheticProbePage);
      wrapper = h.wrapper;

      const pending = h.page.refresh(refreshArgs);
      await flushPromises();
      expect(h.page.face.value).toBe("unknown");

      gates.alpha.resolve(countHits(0));
      await flushPromises();
      expect(h.page.face.value).toBe("unknown");

      gates.beta.resolve(countHits(0));
      gates.gamma.resolve(countHits(0));
      await flushPromises();
      // Three settled, one outstanding — still not entitled to claim absence.
      expect(h.page.face.value).toBe("unknown");

      gates.delta.resolve(countHits(0));
      await pending;
      await flushPromises();
      expect(h.page.face.value).toBe("undetected");
    });
  });

  // ── Probe ladder (§5.2 pass 1b) ──────────────────────────────────────────

  describe("probe ladder", () => {
    beforeEach(() => {
      primeProbeStreams();
      searchMock.mockResolvedValue(countHits(7));
    });

    it("a fulfilled COUNT > 0 ⇒ present; a fulfilled 0 ⇒ hidden `probe-empty`", async () => {
      searchMock.mockImplementation((args: any) => {
        const sql = JSON.stringify(args?.query ?? args ?? "");
        return Promise.resolve(countHits(sql.includes("alpha_stream") ? 5 : 0));
      });
      const h = withCuratedPage(syntheticProbePage);
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      expect(presentGroupIds(h.page)).toContain("alpha");
      const beta = h.page.hiddenGroups.value.find((g: any) => g.group.id === "beta");
      expect(beta.reason).toBe("probe-empty");
    });

    it("HTTP 400 naming an UNKNOWN FIELD hides `probe-empty` with missingFields and NO warning", async () => {
      // Measured (dry run finding 4): probing a stream without the column returns
      // 400 "unknown field 'x'" rather than zo_count 0. That is deterministic
      // schema evidence arriving over the query channel — not a transport failure,
      // so it must NOT take the render-more path and must NOT raise the error face.
      searchMock.mockImplementation((args: any) => {
        const sql = JSON.stringify(args?.query ?? args ?? "");
        if (!sql.includes("alpha_stream")) return Promise.resolve(countHits(1));
        return Promise.reject({
          response: { status: 400, data: { message: "unknown field 'alpha_field'" } },
        });
      });
      const h = withCuratedPage(syntheticProbePage);
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      const alpha = h.page.hiddenGroups.value.find((g: any) => g.group.id === "alpha");
      expect(alpha).toBeDefined();
      expect(alpha.reason).toBe("probe-empty");
      expect(alpha.missingFields).toContain("alpha_field");
      expect(h.page.warnings.value.some((w: any) => w.kind === "probe")).toBe(false);
    });

    it("a 500, a network failure, or a 400 NOT naming a field ⇒ present + `probe` warning", async () => {
      // The adjacent half of the pair above: the render-more invariant intact.
      // These two rows may not be weakened independently of one another.
      const failures: any[] = [
        { response: { status: 500, data: { message: "boom" } } },
        new Error("Network Error"),
        { response: { status: 400, data: { message: "syntax error at or near ..." } } },
      ];
      for (const failure of failures) {
        vi.clearAllMocks();
        primeProbeStreams();
        searchMock.mockImplementation((args: any) => {
          const sql = JSON.stringify(args?.query ?? args ?? "");
          return sql.includes("alpha_stream")
            ? Promise.reject(failure)
            : Promise.resolve(countHits(0));
        });
        const h = withCuratedPage(syntheticProbePage);
        await h.page.refresh(refreshArgs);
        await flushPromises();

        expect(presentGroupIds(h.page), JSON.stringify(failure)).toContain("alpha");
        expect(
          h.page.warnings.value.some((w: any) => w.kind === "probe"),
          JSON.stringify(failure),
        ).toBe(true);
        h.wrapper.unmount();
      }
    });

    it("a COUNT outstanding past PROBE_TIMEOUT_MS ⇒ present + `probe` warning, face unblocked", async () => {
      // The client budget bounds the FACE ladder for every pack; without it a
      // hung probe holds the page indefinitely.
      vi.useFakeTimers();
      const gates = primeProbeDeferreds();
      const h = withCuratedPage(syntheticProbePage);
      wrapper = h.wrapper;

      const pending = h.page.refresh(refreshArgs);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.page.face.value).toBe("unknown");

      // Never settle alpha; let the shared budget expire.
      for (const id of ["beta", "gamma", "delta"]) gates[id].resolve(countHits(0));
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1);
      await pending;

      expect(presentGroupIds(h.page)).toContain("alpha");
      expect(h.page.warnings.value.some((w: any) => w.kind === "probe")).toBe(true);
    });

    it("COUNTs fire CONCURRENTLY — all in flight before any resolves", async () => {
      // Measured at 1.2-1.6s each: sequential execution is ~6s against a 4s
      // budget, so concurrency is a requirement, not a style preference.
      const gates = primeProbeDeferreds();
      const h = withCuratedPage(syntheticProbePage);
      wrapper = h.wrapper;

      const pending = h.page.refresh(refreshArgs);
      await flushPromises();
      expect(searchMock).toHaveBeenCalledTimes(PROBE_IDS.length);

      for (const id of PROBE_IDS) gates[id].resolve(countHits(1));
      await pending;
      await flushPromises();
    });

    it("a same-(org, range-bucket) re-refresh fires ZERO COUNTs; force:true bypasses the cache", async () => {
      const h = withCuratedPage(syntheticProbePage);
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(searchMock.mock.calls.length).toBeGreaterThan(0);

      searchMock.mockClear();
      await h.page.refresh(refreshArgs);
      await flushPromises();
      expect(searchMock).not.toHaveBeenCalled();

      await h.page.refresh({ ...refreshArgs, force: true });
      await flushPromises();
      expect(searchMock.mock.calls.length).toBeGreaterThan(0);
    });

    it("crossing a 5-minute bucket EDGE re-fires the probes — the cache key changed", async () => {
      // Pins the bucket rule at its boundary, not just its hit path.
      const FIVE_MIN_US = 5 * 60 * 1_000_000;
      const bucketStart = Math.floor(RANGE.start / FIVE_MIN_US) * FIVE_MIN_US;
      const h = withCuratedPage(syntheticProbePage);
      wrapper = h.wrapper;
      await h.page.refresh({ ...refreshArgs, start: bucketStart, end: RANGE.end });
      await flushPromises();

      // Same bucket ⇒ cached.
      searchMock.mockClear();
      await h.page.refresh({ ...refreshArgs, start: bucketStart + 1, end: RANGE.end });
      await flushPromises();
      expect(searchMock).not.toHaveBeenCalled();

      // One bucket earlier ⇒ a different key, so the verdicts cannot be reused.
      await h.page.refresh({
        ...refreshArgs,
        start: bucketStart - FIVE_MIN_US,
        end: RANGE.end,
      });
      await flushPromises();
      expect(searchMock.mock.calls.length).toBeGreaterThan(0);
    });
  });

  // ── Probe CANDIDATE-LIST resolution (§5.2 pass 1b step 1, dry run finding 3) ─

  describe("probe candidate ladder", () => {
    /** A one-group probe manifest over an explicit candidate list. */
    const candidatePage = (streams: string[], groupCount = 1): any => ({
      ...syntheticProbePage,
      groups: Array.from({ length: groupCount }, (_, i) =>
        probeGroup(PROBE_IDS[i], streams, PROBE_FIELDS[PROBE_IDS[i]]),
      ),
      sections: [
        {
          id: "overview",
          titleKey: "synthetic.overview",
          scopedBy: [],
          panels: Array.from({ length: groupCount }, (_, i) =>
            probePanel(`${PROBE_IDS[i]}_p1`, PROBE_IDS[i]),
          ),
        },
      ],
    });

    /** Prime the logs list + per-stream schemas from an explicit spec. */
    const primeCandidates = (spec: Array<[string, string[] | null, number?]>) => {
      const list = spec
        .filter(([, schema]) => schema !== null)
        .map(([name, schema, docTimeMax]) =>
          logsEntry(name, schema as string[], docTimeMax ?? NOW_US - 60_000_000),
        );
      primeStreams({ metrics: [], logs: list });
      getStreamMock.mockImplementation(async (name: string) => {
        const found = list.find((s) => s.name === name);
        if (!found) throw new Error(`no schema for ${name}`);
        return found;
      });
      return list;
    };

    const schemaNames = () => getStreamMock.mock.calls.map((c: any[]) => c[0]);

    it("(a) the FIRST present+live+schema-matching candidate wins, and no later candidate's schema is read", async () => {
      // The ladder is ordered evidence, not a scan: once a candidate satisfies all
      // three conditions the walk STOPS. A pre-fetch-then-choose implementation
      // passes a naive "resolved to c1" assertion but fails on call-args here.
      primeCandidates([
        ["c1", ["alpha_field"]],
        ["c2", ["alpha_field"]],
        ["default", ["alpha_field"]],
      ]);
      searchMock.mockResolvedValue(countHits(3));
      const h = withCuratedPage(candidatePage(["c1", "c2", "default"]));
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      expect(presentGroupIds(h.page)).toContain("alpha");
      expect(schemaNames()).toContain("c1");
      expect(schemaNames()).not.toContain("c2");
      expect(schemaNames()).not.toContain("default");
      expect(JSON.stringify(searchMock.mock.calls)).toContain("c1");
    });

    it("(b) candidate 1 ABSENT from the list ⇒ the walk falls through to `default`", async () => {
      primeCandidates([["default", ["alpha_field"]]]);
      searchMock.mockResolvedValue(countHits(9));
      const h = withCuratedPage(candidatePage(["c1", "default"]));
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      expect(presentGroupIds(h.page)).toContain("alpha");
      // An absent candidate is skipped without a schema read — it is not in the list.
      expect(schemaNames()).not.toContain("c1");
      expect(JSON.stringify(searchMock.mock.calls)).toContain("default");
    });

    it("(c) candidate 1 PRESENT but missing the probe column ⇒ the walk CONTINUES; only exhaustion hides", async () => {
      // The half that makes the ladder a ladder: a column miss on c1 is evidence
      // about c1, not about the group. A "first present candidate is the target"
      // implementation hides the group here and this row is what catches it.
      primeCandidates([
        ["c1", ["unrelated_col"]],
        ["default", ["alpha_field"]],
      ]);
      searchMock.mockResolvedValue(countHits(4));
      const h = withCuratedPage(candidatePage(["c1", "default"]));
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      expect(presentGroupIds(h.page)).toContain("alpha");
      expect(schemaNames()).toContain("c1");
      expect(schemaNames()).toContain("default");
      expect(JSON.stringify(searchMock.mock.calls)).toContain("default");
    });

    it("(c') the probeStream reported on exhaustion is the FURTHEST candidate TRIED, not the first", async () => {
      // The strip has to name the stream that fell short, or the user is sent to
      // inspect a stream the engine never reached.
      primeCandidates([
        ["c1", ["unrelated_col"]],
        ["default", ["also_unrelated"]],
      ]);
      const h = withCuratedPage(candidatePage(["c1", "default"]));
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      const alpha = h.page.hiddenGroups.value.find((g: any) => g.group.id === "alpha");
      expect(alpha.reason).toBe("probe-empty");
      expect(alpha.probeStream).toBe("default");
    });

    it("(d) the RESOLVED candidate name flows into stalenessStreams AND the strip copy", async () => {
      // One resolved name, four consumers (§5.2 step 1): the COUNT, the panels'
      // FROM, the strip copy and stalenessStreams. A divergent doc_time_max makes
      // the wrong source observable — c1 is dead, so sourcing staleness from the
      // candidate LIST head instead of the RESOLVED stream badges a healthy group.
      const DEAD = NOW_US - 30 * 24 * HOUR_US;
      primeCandidates([
        ["c1", ["unrelated_col"], DEAD],
        ["default", ["alpha_field"]],
      ]);
      searchMock.mockResolvedValue(countHits(2));
      const h = withCuratedPage(candidatePage(["c1", "default"]));
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      expect(presentGroupIds(h.page)).toContain("alpha");
      // Staleness reads the RESOLVED stream (`default`, live), never dead `c1`.
      expect(h.page.staleGroups.value.some((s: any) => s.group.id === "alpha")).toBe(false);
    });

    it("(e) NO candidate in the list at all ⇒ hidden `streams-missing`, with ZERO schema reads", async () => {
      // Nothing to read a schema off — a request here is a request against a
      // stream the list already proved absent.
      primeCandidates([["unrelated", ["x"]]]);
      const h = withCuratedPage(candidatePage(["c1", "default"]));
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      const alpha = h.page.hiddenGroups.value.find((g: any) => g.group.id === "alpha");
      expect(alpha.reason).toBe("streams-missing");
      expect(getStreamMock).not.toHaveBeenCalled();
      expect(searchMock).not.toHaveBeenCalled();
    });

    it("(f) the column is absent on EVERY candidate ⇒ hidden `probe-empty` + missingFields, and ZERO COUNTs", async () => {
      // Schema evidence is conclusive before the query channel is touched; firing
      // a COUNT anyway spends a request to learn what the schema already said.
      primeCandidates([
        ["c1", ["unrelated_col"]],
        ["c2", ["still_unrelated"]],
        ["default", []],
      ]);
      const h = withCuratedPage(candidatePage(["c1", "c2", "default"]));
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      const alpha = h.page.hiddenGroups.value.find((g: any) => g.group.id === "alpha");
      expect(alpha.reason).toBe("probe-empty");
      expect(alpha.missingFields).toContain("alpha_field");
      expect(searchMock).not.toHaveBeenCalled();
    });

    it("(g) N groups resolving to ONE shared candidate read that schema exactly once", async () => {
      // §5.2's corrected cost model: `default` is Vuex-cached, so the realistic
      // ceiling is 5 reads, not one per group. A per-group re-fetch is the
      // regression this pins.
      primeCandidates([["default", ["alpha_field", "beta_field", "gamma_field"]]]);
      searchMock.mockResolvedValue(countHits(1));
      const h = withCuratedPage(candidatePage(["default"], 3));
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      expect(schemaNames().filter((n: string) => n === "default")).toHaveLength(1);
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

    it("an ORG-SWITCH refresh carries force:true into getStreams — ordering-independent of resetStreams", async () => {
      // §5.6: the upstream resetStreams() on org change still runs, but the page's
      // own refresh must not DEPEND on it having run first. Asserted on call-args
      // rather than on a reset having happened, so the guarantee holds either way.
      const h = withCuratedPage();
      wrapper = h.wrapper;
      await h.page.refresh(refreshArgs);
      await flushPromises();

      getStreamsMock.mockClear();
      await h.page.refresh({ ...refreshArgs, orgId: "other-org", force: true });
      await flushPromises();

      expect(getStreamsMock).toHaveBeenCalledWith("metrics", false, false, true);
      for (const call of getStreamsMock.mock.calls) expect(call[3]).toBe(true);
    });

    it("generation discipline covers the SCHEMA and PROBE fan-out, not just getStreams", async () => {
      // The lists are only the first tier. A superseded schema or COUNT response
      // arriving late must be dropped too, or an org switch mid-flight resolves
      // the new org's page against the old org's schemas.
      primeProbeStreams();
      const staleSchema = deferred();
      const staleCount = deferred();
      getStreamMock.mockImplementationOnce(() => staleSchema.promise);
      searchMock.mockImplementationOnce(() => staleCount.promise);

      const h = withCuratedPage(syntheticProbePage);
      wrapper = h.wrapper;
      const first = h.page.refresh(refreshArgs);
      await flushPromises();

      // A second refresh supersedes the first while both are still outstanding.
      primeProbeStreams();
      searchMock.mockResolvedValue(countHits(3));
      await h.page.refresh({ ...refreshArgs, orgId: "other-org", force: true });
      await flushPromises();
      const afterSecond = visiblePanelIds(h.page);
      const facAfterSecond = h.page.face.value;

      staleSchema.resolve(logsEntry("alpha_stream", []));
      staleCount.resolve(countHits(0));
      await first.catch(() => {});
      await flushPromises();

      expect(visiblePanelIds(h.page)).toEqual(afterSecond);
      expect(h.page.face.value).toBe(facAfterSecond);
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
