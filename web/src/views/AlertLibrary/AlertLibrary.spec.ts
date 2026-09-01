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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { makeAlertSectionRouter } from "@/test/unit/helpers/alertSectionRouter";
import type { AlertLibraryEntry, AlertLibraryManifest } from "@/types/alertLibrary";

// See AlertSectionTabs.spec.ts — the app router is neither needed nor cheap.
const router = makeAlertSectionRouter();

const entry = (over: Partial<AlertLibraryEntry> = {}): AlertLibraryEntry => ({
  id: `k8s/${over.name ?? "pod-oom-killed"}`,
  name: "pod-oom-killed",
  pack: "k8s",
  category: "pod",
  title: "Pod OOM Killed",
  severity: "critical",
  description: "A container was terminated by the OOM killer.",
  stream: "kube_pod_metrics",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["kube_pod_metrics"],
  path: "packs/k8s/alerts/pod/pod-oom-killed.json",
  content_hash: "hash-1",
  ...over,
});

const manifestFixture: AlertLibraryManifest = {
  format_version: "1.0.0",
  alert_count: 4,
  packs: [
    { id: "k8s", alert_count: 3, categories: [] },
    { id: "openobserve", alert_count: 1, categories: [] },
  ],
  alerts: [
    entry(),
    entry({
      id: "k8s/node-disk-pressure",
      name: "node-disk-pressure",
      category: "node",
      title: "Node Disk Pressure",
      severity: "warning",
      stream: "kube_node_metrics",
      required_streams: ["kube_node_metrics"],
      description: "Node reports disk pressure.",
    }),
    entry({
      id: "k8s/cert-expiring",
      name: "cert-expiring",
      category: "cert-manager",
      title: "Certificate Expiring",
      severity: "info",
      stream: "certmanager_metrics",
      required_streams: ["certmanager_metrics"],
      description: "A certificate expires soon.",
    }),
    entry({
      id: "openobserve/ingest-errors",
      name: "ingest-errors",
      pack: "openobserve",
      category: "self-monitoring",
      title: "Ingestion Errors",
      severity: "critical",
      stream: "o2_logs",
      stream_type: "logs",
      required_streams: ["o2_logs"],
      description: "Ingestion is returning errors.",
    }),
  ],
};

// The org receives two of the three k8s streams — so one k8s alert is unusable.
const STREAM_LIST = [
  { name: "kube_pod_metrics", stream_type: "metrics" },
  { name: "kube_node_metrics", stream_type: "metrics" },
  { name: "o2_logs", stream_type: "logs" },
];

const manifestRef = ref<AlertLibraryManifest | null>(null);
const isLoadingRef = ref(false);
const errorRef = ref<{ code: string } | null>(null);
const loadManifest = vi.fn();
const getStreams = vi.fn();

vi.mock("@/composables/alerts/useAlertLibrary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/alerts/useAlertLibrary")>();
  return {
    ...actual,
    useAlertLibrary: () => ({
      manifest: manifestRef,
      isLoading: isLoadingRef,
      error: errorRef,
      loadManifest,
      loadAlertFile: vi.fn(),
      clearLibrary: vi.fn(),
      isReady: (e: AlertLibraryEntry, byType: Record<string, Set<string>>) =>
        (e.required_streams ?? []).every((name) => byType[e.stream_type]?.has(name)),
    }),
  };
});

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams }),
}));

import AlertLibrary from "./AlertLibrary.vue";

// Tracked so afterEach can tear them down: the specs below reassign the shared
// `manifestRef`, and every still-mounted view re-renders on every reassignment.
const mounted: Array<ReturnType<typeof mount>> = [];

const mountView = async () => {
  const wrapper = mount(AlertLibrary, {
    global: { provide: { store }, plugins: [i18n, router] },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
};

/** Rail rows are checkboxes; the click target is the box, not the label. */
const tickRail = async (wrapper: ReturnType<typeof mount>, test: string) => {
  await wrapper.find(`[data-test="${test}"]`).find('[role="checkbox"]').trigger("click");
  await flushPromises();
};

describe("AlertLibrary", () => {
  beforeEach(async () => {
    manifestRef.value = manifestFixture;
    isLoadingRef.value = false;
    errorRef.value = null;
    loadManifest.mockReset().mockResolvedValue(manifestFixture);
    getStreams.mockReset().mockResolvedValue({ name: "all", list: STREAM_LIST });
    await router.push({ name: "alertLibrary" });
    await router.isReady();
  });

  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    vi.clearAllMocks();
  });

  it("renders the page header and the sibling section tabs", async () => {
    const wrapper = await mountView();
    // Identical on all four alerting pages — see TemplateList.spec.ts.
    expect(wrapper.find(".app-page-header h1").text()).toBe("Alerts");
    expect(wrapper.find('[data-test="alert-section-tabs"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-section-tab-alertLibrary"]').exists()).toBe(true);
  });

  it("loads the manifest and the org's streams on mount", async () => {
    await mountView();
    expect(loadManifest).toHaveBeenCalled();
    // Readiness is a background check — no global toast for it.
    expect(getStreams).toHaveBeenCalledWith("all", false, false);
  });

  it("waits for readiness before drawing cards, so none flips from ready to dimmed", async () => {
    // The manifest is a small cached S3 object; the org's streams are a backend
    // query, so the manifest lands first. Drawing on the manifest alone painted
    // every card solid — `entryReady` optimistically answers true while
    // readiness is unknown — and they then dimmed to `border-dashed opacity-65`
    // when the streams arrived. Visible as the borders lightening on their own.
    let releaseStreams: () => void = () => {};
    getStreams.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseStreams = () => resolve({ name: "all", list: STREAM_LIST });
      }),
    );

    const wrapper = await mountView();
    // Manifest has resolved, streams have not: skeleton, no cards to flip.
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(
      false,
    );

    releaseStreams();
    await flushPromises();
    // Cards appear once, already carrying the correct verdict.
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(true);
  });

  it("still renders the grid when the stream check fails", async () => {
    // The skeleton must not latch on: a failed stream load leaves readiness
    // unknown deliberately, and cards render undimmed rather than claiming the
    // org has no telemetry.
    getStreams.mockRejectedValueOnce(new Error("streams unavailable"));
    const wrapper = await mountView();

    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(true);
  });

  it("opens on the whole library, not on one pack", async () => {
    // The rail narrows; it does not gate. Landing pre-filtered to whichever
    // pack happens to sort first hides most of the catalogue behind a click
    // nobody knows to make.
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-test="alert-library-card-openobserve/ingest-errors"]').exists(),
    ).toBe(true);
  });

  it("offers no pack facet — the pack survives only as group context", async () => {
    // A pack is a coarse bucket; the category is what people search for. The
    // rail lists categories alone, and the heading still says which pack a
    // group came from.
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="alert-library-rail-pack-k8s"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-library-group-k8s/pod"]').text()).toContain(
      "Kubernetes",
    );
  });

  it("names the pack in group headings only while more than one is on screen", async () => {
    // Category names are pack-scoped, so a heading has to say which pack it
    // belongs to — but repeating it on every group of a single pack is noise.
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="alert-library-group-k8s/pod"]').text()).toContain(
      "Kubernetes",
    );

    await tickRail(wrapper, "alert-library-rail-category-pod");
    expect(wrapper.find('[data-test="alert-library-group-k8s/pod"]').text()).not.toContain(
      "Kubernetes",
    );
  });

  it("marks only the alert whose stream is missing, and names that stream", async () => {
    const wrapper = await mountView();
    const unusable = wrapper.find('[data-test="alert-library-card-k8s/cert-expiring"]');
    expect(unusable.text()).toContain("Not ingested");
    expect(
      wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').text(),
    ).not.toContain("Not ingested");
  });

  it("counts ready, needs-data and total over what is in view, with All last", async () => {
    const wrapper = await mountView();
    const tiles = wrapper.findAll('[data-test^="alert-library-stat-"]');
    expect(tiles.map((tile) => tile.attributes("data-test"))).toEqual([
      "alert-library-stat-ready",
      "alert-library-stat-missing",
      "alert-library-stat-all",
    ]);
    // All four alerts are in view; only cert-expiring's stream is missing.
    expect(tiles[0].text()).toContain("3");
    expect(tiles[1].text()).toContain("1");
    expect(tiles[2].text()).toContain("4");
  });

  it("recounts the strip when the rail narrows", async () => {
    // The tiles describe what is on screen. Left counting the whole library
    // they would contradict the grid under them.
    const wrapper = await mountView();
    await tickRail(wrapper, "alert-library-rail-category-self-monitoring");
    const tiles = wrapper.findAll('[data-test^="alert-library-stat-"]');
    expect(tiles[2].text()).toContain("1");
  });

  it("recounts the strip when the search narrows, since search is not a facet", async () => {
    // The search box sits directly above the tiles. Numbers that ignored it
    // would describe a grid that is no longer there.
    const wrapper = await mountView();
    wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "disk pressure");
    await flushPromises();
    const tiles = wrapper.findAll('[data-test^="alert-library-stat-"]');
    expect(tiles[2].text()).toContain("1");
  });

  it("counts each severity before its own filter, so the others do not read as empty", async () => {
    // Counting after the severity filter would zero every chip except the one
    // you are standing on, which reads as "there is nothing else".
    const wrapper = await mountView();
    await wrapper.find('[data-test="alert-library-rail-severity-critical"]').trigger("click");
    await flushPromises();
    const rail = wrapper.findComponent({ name: "LibraryRail" });
    const facets = rail.props("severities") as Array<{ id: string; count: number }>;
    expect(facets.find((f) => f.id === "warning")?.count).toBe(1);
  });

  it("filters to the unusable alerts when the needs-data tile is clicked", async () => {
    const wrapper = await mountView();
    await wrapper.find('[data-test="alert-library-stat-missing"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="alert-library-card-k8s/cert-expiring"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(
      false,
    );
  });

  it("clears the facet when the active tile is clicked again", async () => {
    const wrapper = await mountView();
    const tile = '[data-test="alert-library-stat-missing"]';
    await wrapper.find(tile).trigger("click");
    await flushPromises();
    await wrapper.find(tile).trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(true);
  });

  it("uses the All tile only to clear, never to highlight", async () => {
    const wrapper = await mountView();
    await wrapper.find('[data-test="alert-library-stat-ready"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-test="alert-library-stat-all"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="alert-library-card-k8s/cert-expiring"]').exists()).toBe(true);
  });

  it("narrows to the ticked categories, and holds more than one at a time", async () => {
    const wrapper = await mountView();
    await tickRail(wrapper, "alert-library-rail-category-node");
    expect(wrapper.find('[data-test="alert-library-card-k8s/node-disk-pressure"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(
      false,
    );

    await tickRail(wrapper, "alert-library-rail-category-pod");
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-card-k8s/node-disk-pressure"]').exists()).toBe(
      true,
    );
  });

  it("crosses packs, since a category is picked without one", async () => {
    // Nothing scopes the rail to a pack any more, so a category selection is
    // answered from the whole library.
    const wrapper = await mountView();
    await tickRail(wrapper, "alert-library-rail-category-self-monitoring");
    expect(
      wrapper.find('[data-test="alert-library-card-openobserve/ingest-errors"]').exists(),
    ).toBe(true);
  });

  it("counts a category over the whole library, not over the current selection", async () => {
    // Counts answer "how many are there". Recomputing them against the
    // selection would drop every other row to zero the moment you ticked one.
    const wrapper = await mountView();
    await tickRail(wrapper, "alert-library-rail-category-pod");
    const facets = wrapper.findComponent({ name: "LibraryRail" }).props("categories") as Array<{
      id: string;
      count: number;
    }>;
    expect(facets.find((f) => f.id === "node")?.count).toBe(1);
  });

  it("searches across title, description and stream", async () => {
    const wrapper = await mountView();
    wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "disk pressure");
    await flushPromises();
    expect(wrapper.find('[data-test="alert-library-card-k8s/node-disk-pressure"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(
      false,
    );
  });

  it("offers a way back when a filter matches nothing", async () => {
    const wrapper = await mountView();
    wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "zzzz");
    await flushPromises();
    const empty = wrapper.find('[data-test="alert-library-no-results"]');
    expect(empty.exists()).toBe(true);
    await empty.findComponent({ name: "OButton" }).trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(true);
  });

  it("hides the collector banner while anything at all is ready", async () => {
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="alert-library-empty-state"]').exists()).toBe(false);
  });

  it("shows the collector banner only when one category is in view and none of it can run", async () => {
    // The copy names the telemetry to send, so it is only advice while there is
    // a single thing to name.
    getStreams.mockResolvedValue({ name: "all", list: [] });
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="alert-library-empty-state"]').exists()).toBe(false);

    await tickRail(wrapper, "alert-library-rail-category-cert-manager");
    expect(wrapper.find('[data-test="alert-library-empty-state"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-empty-state"]').text()).toContain(
      "Cert manager",
    );
  });

  it("does not claim your data is missing when the stream request itself failed", async () => {
    getStreams.mockRejectedValue(new Error("boom"));
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="alert-library-empty-state"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-library-card-k8s/cert-expiring"]').text()).not.toContain(
      "Not ingested",
    );
  });

  it("opens the drawer on the card that was clicked, and only then", async () => {
    const wrapper = await mountView();
    const drawer = wrapper.findComponent({ name: "LibraryDrawer" });
    // Mounted from the start but closed: the drawer is what performs the second
    // GET, and it must not fire for a gallery nobody has clicked into.
    expect(drawer.props("open")).toBe(false);

    await wrapper.find('[data-test="alert-library-card-k8s/node-disk-pressure"]').trigger("click");
    expect(drawer.props("open")).toBe(true);
    expect((drawer.props("entry") as AlertLibraryEntry).id).toBe("k8s/node-disk-pressure");
  });

  it("tells the drawer whether the alert can run, so it can say so before install", async () => {
    const wrapper = await mountView();
    await wrapper.find('[data-test="alert-library-card-k8s/cert-expiring"]').trigger("click");
    expect(wrapper.findComponent({ name: "LibraryDrawer" }).props("ready")).toBe(false);
  });

  it("explains a load failure by its error code and offers a retry", async () => {
    manifestRef.value = null;
    errorRef.value = { code: "unsupported_version" };
    const wrapper = await mountView();
    const errorState = wrapper.find('[data-test="alert-library-error"]');
    expect(errorState.exists()).toBe(true);
    expect(errorState.text()).toContain("newer than this version");

    loadManifest.mockClear();
    await errorState.findComponent({ name: "OButton" }).trigger("click");
    expect(loadManifest).toHaveBeenCalledWith({ force: true });
  });

  describe("defects found in review", () => {
    it("shows an em dash, not a ready count, when the stream check failed", async () => {
      // entryReady answers true while readiness is unknown, so the cards stay
      // undimmed on purpose — but the strip was making the opposite claim just
      // as loudly: "Ready to install 4 / Not ingested 0" for an org we know
      // nothing about.
      getStreams.mockRejectedValue(new Error("boom"));
      const wrapper = await mountView();
      const tiles = wrapper.findAll('[data-test^="alert-library-stat-"]');
      expect(tiles[0].text()).toContain("—");
      expect(tiles[1].text()).toContain("—");
      // The total is a fact about the catalog, not about the org.
      expect(tiles[2].text()).toContain("4");
    });

    it("keeps a known verdict when a REFRESH fails, instead of discarding it", async () => {
      const wrapper = await mountView();
      expect(wrapper.findAll('[data-test^="alert-library-stat-"]')[1].text()).toContain("1");

      getStreams.mockRejectedValueOnce(new Error("timeout"));
      const callsBefore = getStreams.mock.calls.length;
      await wrapper.findComponent({ name: "ORefreshButton" }).vm.$emit("click");
      await flushPromises();
      // Guard: without a real refresh this test would assert nothing.
      expect(getStreams.mock.calls.length).toBe(callsBefore + 1);

      // Still 1 missing: a transient failure must not rewrite what we knew.
      expect(wrapper.findAll('[data-test^="alert-library-stat-"]')[1].text()).toContain("1");
      expect(wrapper.find('[data-test="alert-library-card-k8s/cert-expiring"]').text()).toContain(
        "Not ingested",
      );
    });

    it("counts categories against the OTHER filters, not the whole library", async () => {
      // Absolute counts advertised rows that filter to nothing: with a search
      // active the rail still offered a category, and ticking it emptied the grid.
      const wrapper = await mountView();
      const facets = () =>
        wrapper.findComponent({ name: "LibraryRail" }).props("categories") as Array<{
          id: string;
          count: number;
        }>;
      expect(facets().find((f) => f.id === "node")?.count).toBe(1);

      wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "OOM killer");
      await flushPromises();
      // "node-disk-pressure" does not match, so its category offers nothing.
      expect(facets().find((f) => f.id === "node")).toBeUndefined();
      expect(facets().find((f) => f.id === "pod")?.count).toBe(1);
    });

    it("does not explain an empty grid twice", async () => {
      // The banner and the no-results state both used to render: two different
      // explanations for one blank area, the banner citing alerts not on screen.
      getStreams.mockResolvedValue({ name: "all", list: [] });
      const wrapper = await mountView();
      await tickRail(wrapper, "alert-library-rail-category-cert-manager");
      expect(wrapper.find('[data-test="alert-library-empty-state"]').exists()).toBe(true);

      await wrapper.find('[data-test="alert-library-stat-ready"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="alert-library-no-results"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-library-empty-state"]').exists()).toBe(false);
    });

    it("calls an empty catalog what it is, rather than blaming the filters", async () => {
      manifestRef.value = { ...manifestFixture, alerts: [] };
      const wrapper = await mountView();
      expect(wrapper.find('[data-test="alert-library-empty-catalog"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-library-no-results"]').exists()).toBe(false);
    });

    it("survives an entry the manifest never validated a title for", async () => {
      // assertManifest checks five fields; title is not one of them, and the
      // sort dereferenced it — one bad entry blanked the whole gallery.
      manifestRef.value = {
        ...manifestFixture,
        alerts: [
          { ...manifestFixture.alerts[0], title: undefined },
          { ...manifestFixture.alerts[1], severity: "critical", title: undefined },
        ],
      } as unknown as AlertLibraryManifest;

      const wrapper = await mountView();
      expect(wrapper.find('[data-test="alert-library-grid"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(
        true,
      );
    });

    it("clears the rail's own search box along with the filters", async () => {
      const wrapper = await mountView();
      const rail = wrapper.findComponent({ name: "LibraryRail" });
      await rail.vm.$emit("update:search", "kafka");
      await flushPromises();
      expect(rail.props("search")).toBe("kafka");

      wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "zzzz");
      await flushPromises();
      await wrapper
        .find('[data-test="alert-library-no-results"]')
        .findComponent({ name: "OButton" })
        .trigger("click");
      await flushPromises();
      expect(rail.props("search")).toBe("");
    });
  });
  it("shows the All tile as the active one until a facet is chosen", async () => {
    // The strip has a state — "no availability filter" — that used to light no
    // tile at all, while the All tile it corresponds to was a button that could
    // never look pressed.
    const wrapper = await mountView();
    const pressed = () =>
      ["ready", "missing", "all"].filter(
        (key) =>
          wrapper.find(`[data-test="alert-library-stat-${key}"]`).attributes("aria-pressed") ===
          "true",
      );

    expect(pressed()).toEqual(["all"]);

    await wrapper.find('[data-test="alert-library-stat-ready"]').trigger("click");
    await flushPromises();
    expect(pressed()).toEqual(["ready"]);

    // Toggling the active tile off returns to All — and now says so.
    await wrapper.find('[data-test="alert-library-stat-ready"]').trigger("click");
    await flushPromises();
    expect(pressed()).toEqual(["all"]);
  });

  // ── selection ──────────────────────────────────────────────────────────────
  describe("bulk selection", () => {
    const CARD = "alert-library-card-k8s/pod-oom-killed";
    const BOX = "alert-library-select-k8s/pod-oom-killed";
    const BAR = "alert-library-selection-bar";
    const ALL = "alert-library-select-all-in-view";

    type View = ReturnType<typeof mount>;

    /** Ticking is on the box itself; clicking the card would open the drawer. */
    // `get`, not `find`: a missing hook then names itself in the failure.
    const tick = async (wrapper: View, test: string) => {
      await wrapper.get(`[data-test="${test}"]`).get('[role="checkbox"]').trigger("click");
      await flushPromises();
    };

    const press = async (wrapper: View, test: string) => {
      await wrapper.get(`[data-test="${test}"]`).trigger("click");
      await flushPromises();
    };

    const bar = (wrapper: View) => wrapper.find(`[data-test="${BAR}"]`);
    const dialog = (wrapper: View) => wrapper.findComponent({ name: "LibraryInstallDialog" });

    /** The toolbar box; the rail's own filter is an OInput, so this is unique. */
    const search = async (wrapper: View, term: string) => {
      wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", term);
      await flushPromises();
    };

    /** A manifest whose k8s/pod group holds two alerts, not one. */
    const withPairedGroup = () => ({
      ...manifestFixture,
      alerts: [
        ...manifestFixture.alerts,
        entry({
          id: "k8s/pod-restart-storm",
          name: "pod-restart-storm",
          category: "pod",
          title: "Pod Restart Storm",
          severity: "warning",
          description: "A pod is restarting far more often than its baseline.",
        }),
      ],
    });

    it("keeps the selection controls out of the grid's row, so the grid never moves", async () => {
      // Selecting used to insert a row between the strip and the grid, pushing
      // every card down by the height of that row.
      const wrapper = await mountView();
      const toolbar = () => wrapper.get('[data-test="alert-library-toolbar"]').element;
      expect(toolbar().contains(wrapper.get('[data-test="alert-library-grid"]').element)).toBe(
        false,
      );

      await tick(wrapper, BOX);
      expect(toolbar().contains(wrapper.get(`[data-test="${BAR}"]`).element)).toBe(true);
    });

    it("shares the search row, leaving the stat tiles alone", async () => {
      // The strip's tiles are elastic, so hosting the controls there would make
      // all three re-flow on the first tick — the same shift, moved sideways.
      const wrapper = await mountView();
      await tick(wrapper, BOX);

      const searchRow = wrapper.get('[data-test="alert-library-toolbar"]').element;
      expect(searchRow.contains(wrapper.get('[data-test="alert-library-search"]').element)).toBe(
        true,
      );
      expect(searchRow.contains(wrapper.get('[data-test="alert-library-strip"]').element)).toBe(
        false,
      );
      // The search field is the only elastic thing on the row, so it is the only
      // thing the controls take width from.
      expect(wrapper.get('[data-test="alert-library-search"]').classes()).toContain("flex-1");
    });

    it("keeps the tri-state control pinned as the last thing in the row", async () => {
      // Anything after it would push it sideways when the selection appears.
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      const cluster = wrapper.get('[data-test="alert-library-toolbar-actions"]').element;

      expect(cluster.lastElementChild).toBe(wrapper.get(`[data-test="${ALL}"]`).element);
      expect(cluster.firstElementChild).toBe(wrapper.get(`[data-test="${BAR}"]`).element);
    });

    it("shows no action row until something is selected", async () => {
      const wrapper = await mountView();
      expect(bar(wrapper).exists()).toBe(false);
      await tick(wrapper, BOX);
      expect(bar(wrapper).exists()).toBe(true);
    });

    it("selects one alert from its card and counts it", async () => {
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      expect(bar(wrapper).attributes("data-selected")).toBe("1");
      expect(wrapper.find(`[data-test="${CARD}"]`).attributes("data-selected")).toBe("true");
    });

    it("selects every visible alert from the toolbar, and deselects them again", async () => {
      const wrapper = await mountView();
      await tick(wrapper, ALL);
      expect(bar(wrapper).attributes("data-selected")).toBe("4");
      await tick(wrapper, ALL);
      expect(bar(wrapper).exists()).toBe(false);
    });

    it("reads none, some and all as the selection grows", async () => {
      const wrapper = await mountView();
      const state = () =>
        wrapper.find(`[data-test="${ALL}"]`).find('[role="checkbox"]').attributes("aria-checked");
      expect(state()).toBe("false");
      await tick(wrapper, BOX);
      expect(state()).toBe("mixed");
      await tick(wrapper, ALL);
      expect(state()).toBe("true");
    });

    it("deselects only what is in view, never the rest of the batch", async () => {
      // B1 lets a selection outlive the filters that made it. Emptying it from
      // a control labelled "in view" would silently discard that work.
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      await tickRail(wrapper, "alert-library-rail-category-node");

      await tick(wrapper, ALL);
      expect(bar(wrapper).attributes("data-selected")).toBe("2");
      await tick(wrapper, ALL);
      expect(bar(wrapper).attributes("data-selected")).toBe("1");
      expect(bar(wrapper).attributes("data-offscreen")).toBe("1");
    });

    it("hides the toolbar control when there is nothing in view to select", async () => {
      const wrapper = await mountView();
      expect(wrapper.find(`[data-test="${ALL}"]`).exists()).toBe(true);
      await search(wrapper, "zzzz-no-such-alert");
      expect(wrapper.find(`[data-test="${ALL}"]`).exists()).toBe(false);
    });

    it("offers no select-all while the page is still loading", async () => {
      // `visibleEntries` is empty during the skeleton; a control over nothing
      // would claim there is nothing to select.
      let release: () => void = () => {};
      getStreams.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve({ name: "all", list: STREAM_LIST });
        }),
      );
      const wrapper = await mountView();
      expect(wrapper.find(`[data-test="${ALL}"]`).exists()).toBe(false);

      release();
      await flushPromises();
      expect(wrapper.find(`[data-test="${ALL}"]`).exists()).toBe(true);
    });

    it("keeps a selection across a filter change, and says how much is off screen", async () => {
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      await tickRail(wrapper, "alert-library-rail-category-node");

      expect(wrapper.find(`[data-test="${CARD}"]`).exists()).toBe(false);
      expect(bar(wrapper).attributes("data-selected")).toBe("1");
      expect(bar(wrapper).attributes("data-offscreen")).toBe("1");
      expect(bar(wrapper).text()).toContain(
        i18n.global.t("alert_library.selectionOffscreen", { count: 1 }, 1),
      );
    });

    it("counts the off-screen part of a bigger selection", async () => {
      // One is not enough to catch a set difference taken the wrong way round.
      const wrapper = await mountView();
      await tick(wrapper, ALL);
      await tickRail(wrapper, "alert-library-rail-category-node");

      expect(bar(wrapper).attributes("data-selected")).toBe("4");
      expect(bar(wrapper).attributes("data-offscreen")).toBe("3");
    });

    it("says nothing about off-screen alerts when there are none", async () => {
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      expect(bar(wrapper).attributes("data-offscreen")).toBe("0");
      // Count-free needle: "0 not in view" would satisfy a count-carrying one.
      expect(bar(wrapper).text()).not.toContain("not in view");
      expect(bar(wrapper).text()).not.toContain(
        i18n.global.t("alert_library.selectionOffscreen", { count: 0 }, 0),
      );
    });

    it("keeps the action row over an empty grid, so a selection is never stranded", async () => {
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      await search(wrapper, "zzzz-no-such-alert");

      expect(wrapper.find('[data-test="alert-library-no-results"]').exists()).toBe(true);
      expect(bar(wrapper).attributes("data-selected")).toBe("1");
    });

    it("clears filters without clearing the selection — different intents", async () => {
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      await search(wrapper, "zzzz-no-such-alert");
      await wrapper
        .find('[data-test="alert-library-no-results"]')
        .findComponent({ name: "OButton" })
        .trigger("click");
      await flushPromises();

      expect(wrapper.find(`[data-test="${CARD}"]`).exists()).toBe(true);
      expect(bar(wrapper).attributes("data-selected")).toBe("1");
    });

    it("keeps the selection when the rail clears its categories", async () => {
      // The gallery has two Clear-filters controls with different scopes; B4
      // has to hold for both.
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      await tickRail(wrapper, "alert-library-rail-category-node");
      await press(wrapper, "alert-library-rail-clear-categories");

      expect(bar(wrapper).attributes("data-selected")).toBe("1");
    });

    it("empties the selection from its own control", async () => {
      const wrapper = await mountView();
      await tick(wrapper, ALL);
      await press(wrapper, "alert-library-clear-selection");
      expect(bar(wrapper).exists()).toBe(false);
    });

    it("keeps focus on the page after clearing, not on a control it just removed", async () => {
      // The action row unmounts with the selection, taking the focused button
      // with it — a keyboard user would restart from the top of the grid.
      const wrapper = mount(AlertLibrary, {
        global: { provide: { store }, plugins: [i18n, router] },
        attachTo: document.body,
      });
      mounted.push(wrapper);
      await flushPromises();

      await tick(wrapper, ALL);
      await press(wrapper, "alert-library-clear-selection");
      await flushPromises();

      expect(bar(wrapper).exists()).toBe(false);
      expect(document.activeElement).toBe(
        wrapper.get(`[data-test="${ALL}"]`).get('[role="checkbox"]').element,
      );
    });

    it("selects every alert in that group and nothing outside it", async () => {
      // A group of ONE cannot tell "selects the group" from "selects its first
      // entry", so this one holds two.
      manifestRef.value = withPairedGroup();
      const wrapper = await mountView();
      await press(wrapper, "alert-library-select-group-k8s/pod");

      expect(bar(wrapper).attributes("data-selected")).toBe("2");
      expect(wrapper.find(`[data-test="${CARD}"]`).attributes("data-selected")).toBe("true");
      expect(
        wrapper
          .find('[data-test="alert-library-card-k8s/pod-restart-storm"]')
          .attributes("data-selected"),
      ).toBe("true");
      expect(
        wrapper
          .find('[data-test="alert-library-card-k8s/node-disk-pressure"]')
          .attributes("data-selected"),
      ).toBe("false");
    });

    it("still offers select-all while a group is only partly selected", async () => {
      // "Clear N" the moment ANY member is ticked would strand the rest of the
      // group behind a control that no longer adds anything.
      manifestRef.value = withPairedGroup();
      const wrapper = await mountView();
      await tick(wrapper, BOX);

      const toggle = wrapper.get('[data-test="alert-library-select-group-k8s/pod"]');
      expect(toggle.text()).toBe(i18n.global.t("alert_library.selectAllInGroup", { count: 2 }, 2));

      await press(wrapper, "alert-library-select-group-k8s/pod");
      expect(bar(wrapper).attributes("data-selected")).toBe("2");
    });

    it("keeps the group control out of the heading it sits beside", async () => {
      // A button inside an <h2> becomes part of that heading's accessible name,
      // so heading navigation would read "Kubernetes · Pods 2 Select all 2".
      manifestRef.value = withPairedGroup();
      const wrapper = await mountView();
      const heading = wrapper.get('[data-test="alert-library-group-k8s/pod"]');

      expect(heading.element.tagName).toBe("H2");
      expect(heading.find('[data-test="alert-library-select-group-k8s/pod"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="alert-library-select-group-k8s/pod"]').exists()).toBe(true);
    });

    it("counts the group on its own control", async () => {
      manifestRef.value = withPairedGroup();
      const wrapper = await mountView();
      const toggle = () => wrapper.find('[data-test="alert-library-select-group-k8s/pod"]');
      expect(toggle().text()).toBe("Select all 2");
      await press(wrapper, "alert-library-select-group-k8s/pod");
      expect(toggle().text()).toBe("Clear 2");
    });

    it("turns the group heading into a clear once that group is full", async () => {
      manifestRef.value = withPairedGroup();
      const wrapper = await mountView();
      const toggle = () => wrapper.find('[data-test="alert-library-select-group-k8s/pod"]');
      const label = (key: string) => i18n.global.t(`alert_library.${key}`, { count: 2 }, 2);
      // vue-i18n answers a missing key with the key path, which would make both
      // sides of the comparison below the same string over a broken UI.
      expect(label("selectAllInGroup")).not.toContain("alert_library.");
      expect(label("selectAllInGroup")).not.toBe(label("clearGroupSelection"));

      expect(toggle().text()).toBe(label("selectAllInGroup"));
      await press(wrapper, "alert-library-select-group-k8s/pod");
      expect(toggle().text()).toBe(label("clearGroupSelection"));
      await press(wrapper, "alert-library-select-group-k8s/pod");
      expect(bar(wrapper).exists()).toBe(false);
    });

    it("adds to the selection from a group rather than replacing it", async () => {
      manifestRef.value = withPairedGroup();
      const wrapper = await mountView();
      await tick(wrapper, "alert-library-select-k8s/node-disk-pressure");
      await press(wrapper, "alert-library-select-group-k8s/pod");
      expect(bar(wrapper).attributes("data-selected")).toBe("3");
    });

    it("drops the group heading control when only one group is on screen", async () => {
      // It would duplicate the toolbar's control on the same screen.
      const wrapper = await mountView();
      await tickRail(wrapper, "alert-library-rail-category-pod");
      expect(wrapper.find('[data-test="alert-library-select-group-k8s/pod"]').exists()).toBe(false);
    });

    it("selects the not-ingested alerts the strip is showing", async () => {
      // B3 in its stated form: stand on "Not ingested", select all in view.
      const wrapper = await mountView();
      await press(wrapper, "alert-library-stat-missing");
      await tick(wrapper, ALL);

      expect(bar(wrapper).attributes("data-selected")).toBe("1");
      expect(
        wrapper
          .find('[data-test="alert-library-card-k8s/cert-expiring"]')
          .attributes("data-selected"),
      ).toBe("true");
    });

    it("includes an alert whose stream this org does not receive", async () => {
      // They are legitimately addable — the product already promises they start
      // working when the data arrives — so select-all must not quietly skip them.
      const wrapper = await mountView();
      await tick(wrapper, ALL);
      expect(
        wrapper
          .find('[data-test="alert-library-card-k8s/cert-expiring"]')
          .attributes("data-selected"),
      ).toBe("true");
      expect(bar(wrapper).attributes("data-selected")).toBe("4");
    });

    it("counts one alert and many alerts differently on the button", async () => {
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      const label = (count: number) => i18n.global.t("alert_library.addSelected", { count }, count);
      const button = () => wrapper.get('[data-test="alert-library-add-selected"]').text();

      expect(label(1)).not.toContain("alert_library.");
      expect(label(1)).not.toBe(label(2)); // else the assertion below proves nothing
      expect(button()).toBe(label(1));
      await tick(wrapper, "alert-library-select-k8s/node-disk-pressure");
      expect(button()).toBe(label(2));
    });

    it("hands the wizard the selection, frozen, with no seed", async () => {
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      await tick(wrapper, "alert-library-select-k8s/node-disk-pressure");
      await press(wrapper, "alert-library-add-selected");

      const wizard = dialog(wrapper);
      expect(wizard.props("open")).toBe(true);
      expect(wizard.props("seed")).toBe(null);
      expect((wizard.props("preselect") as AlertLibraryEntry[]).map((e) => e.id)).toEqual([
        "k8s/pod-oom-killed",
        "k8s/node-disk-pressure",
      ]);
    });

    it("resolves the batch against the whole manifest, not the filtered view", async () => {
      // The off-view selection is the reason B2 exists; dropping it at the
      // hand-off would install a different set from the one that was counted.
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      await tickRail(wrapper, "alert-library-rail-category-node");
      await press(wrapper, "alert-library-add-selected");

      expect((dialog(wrapper).props("preselect") as AlertLibraryEntry[]).map((e) => e.id)).toEqual([
        "k8s/pod-oom-killed",
      ]);
    });

    it("does not move the batch when the gallery re-filters behind the open wizard", async () => {
      const wrapper = await mountView();
      await tick(wrapper, ALL);
      await press(wrapper, "alert-library-add-selected");
      await tickRail(wrapper, "alert-library-rail-category-node");

      expect(dialog(wrapper).props("preselect") as AlertLibraryEntry[]).toHaveLength(4);
    });

    it("ignores the gallery selection when the drawer starts the add", async () => {
      // Reading one alert and pressing Add must not drag in eleven others.
      const wrapper = await mountView();
      await tick(wrapper, ALL);
      await wrapper.find('[data-test="alert-library-card-k8s/cert-expiring"]').trigger("click");
      await flushPromises();

      const file = { name: "cert-expiring" };
      wrapper
        .findComponent({ name: "LibraryDrawer" })
        .vm.$emit("install", { entry: manifestFixture.alerts[2], file });
      await flushPromises();

      const wizard = dialog(wrapper);
      expect(wizard.props("open")).toBe(true);
      expect((wizard.props("seed") as any).entry.id).toBe("k8s/cert-expiring");
      expect(wizard.props("preselect")).toEqual([]);
    });

    it("keeps the selection when the wizard is cancelled without running", async () => {
      // Building a twelve-alert batch is real work with no undo; a cancelled
      // modal must not destroy it. This is what makes the "no destinations in
      // this org" dead end survivable.
      const wrapper = await mountView();
      await tick(wrapper, ALL);
      await press(wrapper, "alert-library-add-selected");
      expect(dialog(wrapper).props("open")).toBe(true);

      dialog(wrapper).vm.$emit("update:open", false);
      await flushPromises();

      expect(dialog(wrapper).props("open")).toBe(false);
      expect(bar(wrapper).attributes("data-selected")).toBe("4");
    });

    it("drops the batch when the wizard closes, so the drawer starts clean", async () => {
      // A stale pendingBatch would reach the drawer's own add and violate B8
      // without any test above noticing.
      const wrapper = await mountView();
      await tick(wrapper, ALL);
      await press(wrapper, "alert-library-add-selected");
      dialog(wrapper).vm.$emit("update:open", false);
      await flushPromises();

      await wrapper.get('[data-test="alert-library-card-k8s/cert-expiring"]').trigger("click");
      await flushPromises();
      wrapper
        .findComponent({ name: "LibraryDrawer" })
        .vm.$emit("install", { entry: manifestFixture.alerts[2], file: { name: "cert-expiring" } });
      await flushPromises();

      expect(dialog(wrapper).props("preselect")).toEqual([]);
    });

    it("takes only the alerts that were added off the selection, mid-run", async () => {
      // `installed` fires at the end of a run and after each retry, while the
      // dialog is still open. Failures stay selected so a retry is one click.
      const wrapper = await mountView();
      await tick(wrapper, ALL);
      await press(wrapper, "alert-library-add-selected");

      dialog(wrapper).vm.$emit("installed", {
        entryIds: ["k8s/pod-oom-killed", "k8s/cert-expiring"],
      });
      await flushPromises();

      expect(bar(wrapper).attributes("data-selected")).toBe("2");
      // The open wizard keeps the batch it started with.
      expect(dialog(wrapper).props("preselect") as AlertLibraryEntry[]).toHaveLength(4);
    });

    it("opens the drawer from the card title, which is now the control", async () => {
      const wrapper = await mountView();
      const drawer = wrapper.findComponent({ name: "LibraryDrawer" });

      await wrapper
        .find('[data-test="alert-library-card-title-k8s/cert-expiring"]')
        .trigger("click");
      expect(drawer.props("open")).toBe(true);
      expect((drawer.props("entry") as AlertLibraryEntry).id).toBe("k8s/cert-expiring");
    });

    it("forgets an alert the catalog no longer ships", async () => {
      // A stale id would fail its row at run time for a reason nobody can act on.
      const wrapper = await mountView();
      await tick(wrapper, ALL);
      expect(bar(wrapper).attributes("data-selected")).toBe("4");

      manifestRef.value = {
        ...manifestFixture,
        alerts: manifestFixture.alerts.filter((a) => a.id !== "k8s/cert-expiring"),
      };
      await flushPromises();

      expect(bar(wrapper).attributes("data-selected")).toBe("3");
    });

    it("keeps the selection when the manifest reloads unchanged", async () => {
      const wrapper = await mountView();
      await tick(wrapper, BOX);
      manifestRef.value = { ...manifestFixture, alerts: [...manifestFixture.alerts] };
      await flushPromises();
      expect(bar(wrapper).attributes("data-selected")).toBe("1");
    });
  });
});
