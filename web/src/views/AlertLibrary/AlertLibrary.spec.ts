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
    expect(wrapper.find(".app-page-header h1").text()).toBe("Alert Library");
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
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(false);

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

  it("shows the first pack's alerts only", async () => {
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-test="alert-library-card-openobserve/ingest-errors"]').exists(),
    ).toBe(false);
  });

  it("greys out only the alert whose stream is missing", async () => {
    const wrapper = await mountView();
    const unusable = wrapper.find('[data-test="alert-library-card-k8s/cert-expiring"]');
    expect(unusable.text()).toContain("Needs data");
    expect(
      wrapper.find('[data-test="alert-library-card-k8s/pod-oom-killed"]').text(),
    ).not.toContain("Needs data");
  });

  it("counts ready, needs-data and total for the active pack, with All last", async () => {
    const wrapper = await mountView();
    const tiles = wrapper.findAll('[data-test^="alert-library-stat-"]');
    expect(tiles.map((tile) => tile.attributes("data-test"))).toEqual([
      "alert-library-stat-ready",
      "alert-library-stat-missing",
      "alert-library-stat-all",
    ]);
    expect(tiles[0].text()).toContain("2");
    expect(tiles[1].text()).toContain("1");
    expect(tiles[2].text()).toContain("3");
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

  it("switches packs from the rail and resets the category with it", async () => {
    const wrapper = await mountView();
    // The rail lists one axis at a time behind a segmented control, so the
    // categories tab has to be opened before a category row exists.
    await wrapper.find('[data-test="alert-library-rail-axis-categories"]').trigger("click");
    await wrapper.find('[data-test="alert-library-rail-category-node"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-test="alert-library-rail-axis-packs"]').trigger("click");
    await wrapper.find('[data-test="alert-library-rail-pack-openobserve"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-test="alert-library-card-openobserve/ingest-errors"]').exists(),
    ).toBe(true);

    // Reopen the categories tab to see the reset: the new pack's categories are
    // a different set, so carrying "node" across would filter to nothing.
    await wrapper.find('[data-test="alert-library-rail-axis-categories"]').trigger("click");
    expect(
      wrapper.find('[data-test="alert-library-rail-category-all"]').attributes("data-active"),
    ).toBe("true");
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

  it("shows the collector banner only when nothing in the pack can run", async () => {
    getStreams.mockResolvedValue({ name: "all", list: [] });
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="alert-library-empty-state"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-empty-state"]').text()).toContain("Kubernetes");
  });

  it("does not claim your data is missing when the stream request itself failed", async () => {
    getStreams.mockRejectedValue(new Error("boom"));
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="alert-library-empty-state"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-library-card-k8s/cert-expiring"]').text()).not.toContain(
      "Needs data",
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
});
