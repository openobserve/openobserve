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

const mountView = async () => {
  const wrapper = mount(AlertLibrary, {
    global: { provide: { store }, plugins: [i18n, router] },
  });
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
});
