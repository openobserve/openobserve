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

// PreviewAlert is driven through its exposed ref, so the stub has to expose the
// same surface rather than being a plain template stub.
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
          evaluationStatus: ref({ wouldTrigger: true, reason: "matched 4 rows" }),
        });
        return () => h("div", { "data-test": "preview-alert" });
      },
    }),
  };
});

import LibraryDrawer from "./LibraryDrawer.vue";

// ── stubs ──────────────────────────────────────────────────────────────────

const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "title", "subTitle", "size"],
  emits: ["update:open"],
  template:
    '<div data-test="o-drawer" :data-title="title" :data-subtitle="subTitle"><slot /><slot name="footer" /></div>',
};

const OCodeBlockStub = {
  name: "OCodeBlock",
  props: ["code", "lang", "wrap", "maxLines", "copyMessage"],
  template: '<pre :data-test="$attrs[\'data-test\']" :data-lang="lang">{{ code }}</pre>',
};

const OInputStub = {
  name: "OInput",
  props: ["modelValue", "label", "helpText", "suffix", "type", "size"],
  emits: ["update:modelValue"],
  template:
    '<input :data-test="$attrs[\'data-test\']" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const OSelectStub = {
  name: "OSelect",
  props: ["modelValue", "options", "label", "size"],
  emits: ["update:modelValue"],
  template: '<select :data-test="$attrs[\'data-test\']" :data-value="modelValue"></select>',
};

const stubs = {
  ODrawer: ODrawerStub,
  OCodeBlock: OCodeBlockStub,
  OInput: OInputStub,
  OSelect: OSelectStub,
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

  it("renders the query, highlighted as the language it is written in", async () => {
    const wrapper = await mountDrawer();
    const block = wrapper.find('[data-test="alert-library-drawer-query"]');
    expect(block.text()).toContain("rate(go_gc_duration_seconds_sum[5m])");
    expect(block.attributes("data-lang")).toBe("promql");
  });

  it("names the identity fields install will stamp: library id and content hash", async () => {
    const wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="alert-library-drawer-id"]').text()).toBe(
      "k8s/go_gc_pause_high",
    );
    expect(wrapper.find('[data-test="alert-library-drawer-hash"]').text()).toBe("1c09e8f6ac33");
  });

  it("shows the priority the alert installs as, per the settled severity mapping", async () => {
    const warning = await mountDrawer();
    expect(warning.find('[data-test="alert-library-drawer-priority"]').text()).toContain("P3");

    const critical = await mountDrawer({ entry: sqlEntry });
    expect(critical.find('[data-test="alert-library-drawer-priority"]').text()).toContain("P1");
  });

  it("offers the PromQL condition as fields, because that is where its threshold lives", async () => {
    const wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="alert-library-drawer-promql-operator"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-test="alert-library-drawer-promql-value"]').attributes("value"),
    ).toBe("100");
  });

  it("seeds the structured knobs from the file rather than from a default", async () => {
    const wrapper = await mountDrawer();
    const value = (test: string) => wrapper.find(`[data-test="${test}"]`).attributes("value");
    expect(value("alert-library-drawer-period")).toBe("5");
    expect(value("alert-library-drawer-frequency")).toBe("5");
    expect(value("alert-library-drawer-silence")).toBe("30");
  });

  it("locks a threshold that lives inside the SQL text instead of editing the query", async () => {
    mocks.loadAlertFile.mockResolvedValue(sqlFile());
    const wrapper = await mountDrawer({ entry: sqlEntry });

    const locked = wrapper.find('[data-test="alert-library-drawer-locked"]');
    expect(locked.exists()).toBe(true);
    expect(locked.text()).toContain("event_count > 7");
    // No PromQL condition fields on a SQL alert — there is no such field to edit.
    expect(wrapper.find('[data-test="alert-library-drawer-promql-value"]').exists()).toBe(false);
  });

  it("leaves the lock off an alert whose threshold is a real field", async () => {
    const wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="alert-library-drawer-locked"]').exists()).toBe(false);
  });

  it("previews the notification the alert would send", async () => {
    const wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="alert-library-drawer-row-template"]').text()).toContain(
      "GC pause is {value}",
    );
  });

  it("says so plainly when there is no row template", async () => {
    const file = promqlFile();
    delete file.row_template;
    mocks.loadAlertFile.mockResolvedValue(file);
    const wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="alert-library-drawer-row-template"]').exists()).toBe(false);
  });

  it("admits remediation notes do not exist yet rather than showing an empty box", async () => {
    const wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="alert-library-drawer-remediation"]').text()).toContain(
      "metadata backfill",
    );
  });

  it("runs the preview through PreviewAlert's exposed ref — it emits nothing", async () => {
    const wrapper = await mountDrawer();
    await wrapper.find('[data-test="alert-library-drawer-run-preview"]').trigger("click");
    await flushPromises();

    expect(mocks.refreshData).toHaveBeenCalled();
    const preview = wrapper.findComponent({ name: "PreviewAlert" });
    // Without these four the refresh silently no-ops.
    const formData = preview.props("formData") as Record<string, unknown>;
    expect(formData.stream_name).toBe("go_gc_duration_seconds_sum");
    expect(formData.stream_type).toBe("metrics");
    expect(formData.query_condition).toBeTruthy();
    expect(formData.trigger_condition).toBeTruthy();
    expect(preview.props("selectedTab")).toBe("promql");
  });

  it("cannot preview an alert whose stream this org does not have", async () => {
    const wrapper = await mountDrawer({ ready: false });
    expect(
      wrapper.find('[data-test="alert-library-drawer-run-preview"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.find('[data-test="alert-library-drawer-preview"]').text()).toContain(
      "nothing to evaluate",
    );
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

  it("carries the drawer's edits into what it hands on — the tuned file, not the fetched one", async () => {
    const wrapper = await mountDrawer();
    await wrapper.find('[data-test="alert-library-drawer-silence"]').setValue("45");
    await wrapper.find('[data-test="alert-library-drawer-install"]').trigger("click");

    const payload = wrapper.emitted("install")?.[0]?.[0] as {
      entry: AlertLibraryEntry;
      file: AlertLibraryFile;
    };
    expect(payload.entry.id).toBe("k8s/go_gc_pause_high");
    expect((payload.file.trigger_condition as Record<string, unknown>).silence).toBe(45);
  });

  it("will not let a cleared window become an alert that evaluates over zero minutes", async () => {
    const wrapper = await mountDrawer();
    await wrapper.find('[data-test="alert-library-drawer-period"]').setValue("");
    await wrapper.find('[data-test="alert-library-drawer-install"]').trigger("click");

    const payload = wrapper.emitted("install")?.[0]?.[0] as { file: AlertLibraryFile };
    expect((payload.file.trigger_condition as Record<string, unknown>).period).toBe(1);
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
