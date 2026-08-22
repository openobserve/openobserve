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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

const mocks = vi.hoisted(() => ({
  loadAlertFile: vi.fn(),
  openAlertCreation: vi.fn(() => true),
  toast: vi.fn(),
  refreshData: vi.fn(),
}));

vi.mock("@/composables/alerts/useAlertLibrary", () => ({
  useAlertLibrary: () => ({ loadAlertFile: mocks.loadAlertFile }),
}));

vi.mock("@/composables/alerts/useAlertCreation", () => ({
  useAlertCreation: () => ({ openAlertCreation: mocks.openAlertCreation }),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mocks.toast }));

// PreviewAlert is driven through the ref it exposes, so the stub has to expose
// the same surface rather than being a plain template stub.
vi.mock("@/components/alerts/PreviewAlert.vue", async () => {
  const { defineComponent, h, ref } = await import("vue");
  return {
    default: defineComponent({
      name: "PreviewAlert",
      props: {
        query: { type: String, default: "" },
        formData: { type: Object, default: () => ({}) },
        isAggregationEnabled: { type: Boolean, default: false },
        selectedTab: { type: String, default: "" },
        isUsingBackendSql: { type: Boolean, default: false },
        isEditorOpen: { type: Boolean, default: false },
      },
      setup(_props, { expose }) {
        expose({
          refreshData: mocks.refreshData,
          evaluationStatus: ref({ wouldTrigger: true, reason: "4 rows match (4 >= 1)" }),
        });
        return () => h("div", { "data-test": "preview-alert" });
      },
    }),
  };
});

import AlertQueryPreview from "@/components/alerts/AlertQueryPreview.vue";

import LibraryDrawer from "./LibraryDrawer.vue";

// ── stubs ──────────────────────────────────────────────────────────────────

const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "title", "subTitle", "size"],
  emits: ["update:open"],
  template:
    '<div data-test="o-drawer" :data-title="title" :data-subtitle="subTitle"><slot /><slot name="footer" /></div>',
};

const stubs = {
  ODrawer: ODrawerStub,
};

// ── fixtures ───────────────────────────────────────────────────────────────

const promqlEntry: AlertLibraryEntry = {
  id: "k8s/go_gc_pause_high",
  name: "go_gc_pause_high",
  pack: "k8s",
  category: "app-performance",
  title: "Go GC Pause High",
  severity: "warning",
  description: "Go GC average pause time exceeds 100ms.",
  stream: "go_gc_duration_seconds_sum",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["go_gc_duration_seconds_sum"],
  path: "packs/k8s/alerts/app-performance/go_gc_pause_high.json",
  content_hash: "1c09e8f6ac33",
};

const promqlFile = (): AlertLibraryFile => ({
  id: "3Dnovc9lnVMx1H6gvcRZbN01FYu",
  name: "go_gc_pause_high",
  stream_type: "metrics",
  stream_name: "go_gc_duration_seconds_sum",
  row_template: "GC pause is {value} on {k8s_node_name}",
  query_condition: {
    type: "promql",
    sql: null,
    promql: "rate(go_gc_duration_seconds_sum[5m])",
    promql_condition: { column: "value", operator: ">", value: 100, ignore_case: false },
  },
  trigger_condition: { period: 5, operator: ">=", threshold: 1, frequency: 5, silence: 30 },
});

const sqlEntry: AlertLibraryEntry = {
  ...promqlEntry,
  id: "k8s/pod_events",
  title: "Pod Events",
  severity: "critical",
  stream: "k8s_events",
  stream_type: "logs",
  query_type: "sql",
  required_streams: ["k8s_events"],
};

const sqlFile = (): AlertLibraryFile => ({
  name: "pod_events",
  stream_type: "logs",
  stream_name: "k8s_events",
  query_condition: {
    type: "sql",
    sql: 'SELECT count(*) as event_count FROM "k8s_events" HAVING event_count > 7',
    promql: null,
    promql_condition: null,
  },
  trigger_condition: { period: 5, operator: ">=", threshold: 1, frequency: 5, silence: 120 },
});

const mountDrawer = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(LibraryDrawer, {
    props: { open: true, entry: promqlEntry, ready: true, ...props },
    global: { plugins: [i18n], stubs },
  });
  await flushPromises();
  return wrapper;
};

describe("LibraryDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAlertFile.mockResolvedValue(promqlFile());
    mocks.openAlertCreation.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the alert file on open — the gallery never had the query", async () => {
    await mountDrawer();
    expect(mocks.loadAlertFile).toHaveBeenCalledWith(promqlEntry);
  });

  it("fetches nothing while closed", async () => {
    await mountDrawer({ open: false });
    expect(mocks.loadAlertFile).not.toHaveBeenCalled();
  });

  it("previews the whole query through the same component the alert editor uses", async () => {
    const wrapper = await mountDrawer();
    const preview = wrapper.findComponent(AlertQueryPreview);
    expect(preview.props("query")).toBe("rate(go_gc_duration_seconds_sum[5m])");
    expect(preview.props("language")).toBe("promql");
    expect(wrapper.find('[data-test="alert-library-drawer-query"]').text()).toContain(
      "rate(go_gc_duration_seconds_sum[5m])",
    );
  });

  it("previews a SQL alert as SQL", async () => {
    mocks.loadAlertFile.mockResolvedValue(sqlFile());
    const wrapper = await mountDrawer({ entry: sqlEntry });
    const preview = wrapper.findComponent(AlertQueryPreview);
    expect(preview.props("language")).toBe("sql");
    expect(preview.props("query")).toContain('FROM "k8s_events"');
  });

  it("keeps the threshold visible — a PromQL alert's is the metric condition", async () => {
    const wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="alert-library-drawer-threshold"]').text()).toBe("> 100");
  });

  it("falls back to the row count a SQL alert's trigger compares", async () => {
    mocks.loadAlertFile.mockResolvedValue(sqlFile());
    const wrapper = await mountDrawer({ entry: sqlEntry });
    expect(wrapper.find('[data-test="alert-library-drawer-threshold"]').text()).toBe(">= 1");
  });

  it("evaluates the alert as soon as the drawer opens — no button to press", async () => {
    const wrapper = await mountDrawer();
    const preview = wrapper.findComponent({ name: "PreviewAlert" });

    expect(preview.exists()).toBe(true);
    expect(preview.props("query")).toBe("rate(go_gc_duration_seconds_sum[5m])");
    expect(preview.props("selectedTab")).toBe("promql");
    // PreviewAlert does not self-run for PromQL, so the drawer must start it.
    expect(mocks.refreshData).toHaveBeenCalled();
    // Without these four the refresh silently no-ops.
    const formData = preview.props("formData") as Record<string, unknown>;
    expect(formData.stream_name).toBe("go_gc_duration_seconds_sum");
    expect(formData.stream_type).toBe("metrics");
    expect(formData.query_condition).toBeTruthy();
    expect(formData.trigger_condition).toBeTruthy();
  });

  it("re-evaluates for the next alert rather than leaving the last one's chart", async () => {
    const wrapper = await mountDrawer();
    mocks.loadAlertFile.mockResolvedValue(sqlFile());

    await wrapper.setProps({ entry: sqlEntry });
    await flushPromises();

    const preview = wrapper.findComponent({ name: "PreviewAlert" });
    expect(preview.props("query")).toContain('FROM "k8s_events"');
    expect(preview.props("selectedTab")).toBe("sql");
  });

  it("re-runs when the same alert is opened again instead of freezing", async () => {
    const wrapper = await mountDrawer({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    mocks.refreshData.mockClear();

    await wrapper.setProps({ open: false });
    await flushPromises();
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(mocks.refreshData).toHaveBeenCalled();
  });

  it("reports the verdict beside the chart", async () => {
    const wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="alert-library-drawer-evaluation"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-drawer-preview"]').text()).toContain(
      "4 rows match",
    );
  });

  it("says there is nothing to evaluate rather than drawing an empty chart", async () => {
    const wrapper = await mountDrawer({ ready: false });
    expect(wrapper.findComponent({ name: "PreviewAlert" }).exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-library-drawer-preview"]').text()).toContain(
      "nothing to evaluate",
    );
  });

  it("no longer offers tunables, a notification preview, a run or remediation", async () => {
    const wrapper = await mountDrawer();
    for (const test of [
      "alert-library-drawer-tunables",
      "alert-library-drawer-row-template",
      "alert-library-drawer-run-preview",
      "alert-library-drawer-remediation",
      "alert-library-drawer-runbook",
      "alert-library-drawer-id",
      "alert-library-drawer-condition",
      "alert-library-drawer-hash",
      "alert-library-drawer-priority",
    ]) {
      expect(wrapper.find(`[data-test="${test}"]`).exists()).toBe(false);
    }
  });

  it("hands the editor a library prefill and closes, so the two do not fight", async () => {
    const wrapper = await mountDrawer();
    await wrapper.find('[data-test="alert-library-drawer-customize"]').trigger("click");

    expect(mocks.openAlertCreation).toHaveBeenCalledTimes(1);
    const prefill = mocks.openAlertCreation.mock.calls[0][0] as Record<string, unknown>;
    expect(prefill.source).toBe("library");
    expect(prefill.sourceLabel).toBe("Go GC Pause High");
    expect(prefill.promql).toBe("rate(go_gc_duration_seconds_sum[5m])");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("stays open and says why when the editor could not be opened", async () => {
    mocks.openAlertCreation.mockReturnValue(false);
    const wrapper = await mountDrawer();
    await wrapper.find('[data-test="alert-library-drawer-customize"]').trigger("click");

    expect(mocks.toast).toHaveBeenCalled();
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("hands the install wizard the file it fetched", async () => {
    const wrapper = await mountDrawer();
    await wrapper.find('[data-test="alert-library-drawer-install"]').trigger("click");

    const payload = wrapper.emitted("install")?.[0]?.[0] as {
      entry: AlertLibraryEntry;
      file: AlertLibraryFile;
    };
    expect(payload.entry.id).toBe("k8s/go_gc_pause_high");
    expect(payload.file.name).toBe("go_gc_pause_high");
  });

  // A published file may carry zeros, or no trigger_condition at all —
  // assertAlertFile only checks it is an object. Raw, that installs an alert
  // evaluating over a zero-length window that fires on every evaluation, and
  // contradicts the threshold the panel above it displays.
  it("installs the floored file, not the zeros the published one carried", async () => {
    mocks.loadAlertFile.mockResolvedValue({
      ...promqlFile(),
      trigger_condition: { period: 0, operator: ">=", threshold: 0, frequency: 0, silence: 0 },
    });
    const wrapper = await mountDrawer();
    await wrapper.find('[data-test="alert-library-drawer-install"]').trigger("click");

    const payload = wrapper.emitted("install")?.[0]?.[0] as {
      entry: AlertLibraryEntry;
      file: AlertLibraryFile;
    };
    const trigger = payload.file.trigger_condition as Record<string, number>;
    expect(trigger.period).toBeGreaterThan(0);
    expect(trigger.threshold).toBeGreaterThan(0);
  });

  it("previews the floored file, so a missing trigger_condition cannot reach the API", async () => {
    const { trigger_condition: _dropped, ...noTrigger } = promqlFile() as Record<string, unknown>;
    mocks.loadAlertFile.mockResolvedValue(noTrigger);
    const wrapper = await mountDrawer();

    const preview = wrapper.findComponent({ name: "PreviewAlert" });
    const trigger = (preview.props("formData") as Record<string, any>).trigger_condition;
    expect(trigger.period).toBeGreaterThan(0);
    expect(trigger.threshold).toBeGreaterThan(0);
  });

  // "The stream exists" and "the stream has data" are different answers, and
  // only the first used to be shown — so an alert on a stream that has never
  // been written to read "Data available" and previewed as "would not fire".
  it("says a ready stream has never ingested, rather than claiming data is available", async () => {
    const wrapper = await mountDrawer({ dataState: "never" });

    const chip = wrapper.find('[data-test="alert-library-drawer-availability"]');
    expect(chip.text()).not.toContain("Data available");
    expect(wrapper.find('[data-test="alert-library-drawer-needs-data"]').exists()).toBe(true);
  });

  it("says when a quiet stream last had data", async () => {
    const threeDaysAgoMicros = (Date.now() - 3 * 24 * 60 * 60 * 1000) * 1000;
    const wrapper = await mountDrawer({
      dataState: "stale",
      lastIngestedMicros: threeDaysAgoMicros,
    });

    const chip = wrapper.find('[data-test="alert-library-drawer-availability"]');
    expect(chip.text()).toContain("3 days ago");
    expect(wrapper.find('[data-test="alert-library-drawer-needs-data"]').exists()).toBe(true);
  });

  it("keeps its clean state when the stream is actually ingesting", async () => {
    const wrapper = await mountDrawer({ dataState: "fresh" });

    expect(wrapper.find('[data-test="alert-library-drawer-availability"]').text()).toContain(
      "Data available",
    );
    expect(wrapper.find('[data-test="alert-library-drawer-needs-data"]').exists()).toBe(false);
  });

  it("reports a file that could not be fetched instead of rendering an empty alert", async () => {
    mocks.loadAlertFile.mockRejectedValue(new Error("boom"));
    const wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="alert-library-drawer-load-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-drawer-query"]').exists()).toBe(false);
  });

  it("titles itself with the alert and locates it with id, category and pack", async () => {
    const wrapper = await mountDrawer();
    const drawer = wrapper.find('[data-test="alert-library-drawer"]');
    expect(drawer.attributes("data-title")).toBe("Go GC Pause High");
    expect(drawer.attributes("data-subtitle")).toBe(
      "k8s/go_gc_pause_high · App performance · Kubernetes",
    );
  });
});
