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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";
import anomalyDetectionService from "@/services/anomaly_detection";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { alertDraftBase } from "@/utils/alerts/alertEditorDraft";
import { fillField } from "@/test/unit/helpers/fillField";
import { PANEL_DRAFT_AUTOSAVE_MS } from "@/composables/dashboard/usePanelDraft";
import { byTest, click, clickLeave, clickRestore, pressEscape } from "@/test/unit/helpers/draftDom";
import AddAlert from "./AddAlert.vue";

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn(() => Promise.resolve({ schema: [{ name: "status", type: "Int64" }] })),
    getStreams: vi.fn(() => Promise.resolve({ list: [{ name: "default" }, { name: "k8s" }] })),
  }),
}));
vi.mock("@/composables/useFunctions", () => ({
  default: () => ({ getAllFunctions: vi.fn().mockResolvedValue({ functions: [] }) }),
}));
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: async () => ({
      astify: vi.fn(() => ({ columns: [] })),
      parse: vi.fn(),
      sqlify: vi.fn(),
    }),
  }),
}));
vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  getTimezonesByOffset: vi.fn(() => Promise.resolve(["UTC"])),
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: vi.fn(() => () => {}),
}));
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create_by_alert_id: vi.fn(() => Promise.resolve({ data: { code: 200 } })),
      update_by_alert_id: vi.fn(() => Promise.resolve({ data: { code: 200 } })),
      generate_sql: vi.fn(() => Promise.resolve({ data: { sql: "SELECT * FROM default" } })),
      listByFolderId: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    },
  });
});
vi.mock("@/services/anomaly_detection", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { get: vi.fn() } });
});
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

interface AlertForm {
  setFieldValue: (path: string, value: unknown) => void;
  state: { values: Record<string, unknown> };
}

interface AddAlertVm {
  form: AlertForm;
  formData: Record<string, unknown>;
  activeTab: string;
  activeFolderId: string;
  handleSave: () => Promise<void>;
  alertDraft: { hasUnsavedChanges: () => boolean };
}

const newScope: EditorDraftScope = {
  kind: "alert",
  org: "default",
  entityId: null,
  userEmail: "example@gmail.com",
};

// Shape of GET /api/v2/{org}/alerts/{id} on a live instance, evaluation timestamps included.
const savedAlert = {
  id: "3HGifdlCfgrm1thif69NRJig9E5",
  name: "checkout_5xx",
  org_id: "default",
  stream_type: "logs",
  stream_name: "default",
  is_real_time: false,
  query_condition: {
    type: "custom",
    conditions: {
      version: 2,
      conditions: { filterType: "group", logicalOperator: "AND", conditions: [] },
    },
    sql: "",
    promql: null,
    promql_condition: null,
    aggregation: null,
    vrl_function: null,
    multi_time_range: [],
  },
  trigger_condition: {
    period: 10,
    operator: ">=",
    threshold: 1,
    frequency: 10,
    cron: "",
    frequency_type: "minutes",
    silence: 10,
    timezone: "UTC",
  },
  destinations: ["EndpointTest"],
  context_attributes: {},
  row_template: "",
  row_template_type: "String",
  description: "",
  enabled: true,
  tz_offset: 0,
  last_triggered_at: 1793108452309917,
  last_satisfied_at: 1793108452309917,
  owner: "example@gmail.com",
  last_edited_by: "example@gmail.com",
  workflows: [],
  pending_period_sec: 0,
  recovery_destinations: [],
};
const editScope: EditorDraftScope = { ...newScope, entityId: savedAlert.id };

const stubs = {
  QueryConfig: true,
  AlertSettings: true,
  CompareWithPast: true,
  Deduplication: true,
  Advanced: true,
  PreviewAlert: true,
  AlertSummary: true,
  AnomalyDetectionConfig: true,
  AnomalyAlerting: true,
  AnomalySummary: true,
  AnomalyDataPreview: true,
  JsonEditor: true,
  InlineSelectFolderDropdown: true,
  OPageHeader: true,
};

let router: Router;
let wrapper: VueWrapper | null = null;
let editorProps: Record<string, unknown> = {};
const emitted: { list: unknown[][]; cancel: number } = { list: [], cancel: 0 };

const EditorRoute = defineComponent({
  setup() {
    return () =>
      h(AddAlert, {
        ...editorProps,
        "onUpdate:list": (...args: unknown[]) => emitted.list.push(args),
        "onCancel:hideform": () => emitted.cancel++,
      });
  },
});

const mountEditor = async (
  path = "/alerts?action=add",
  props: Record<string, unknown> = {},
  settle = true,
  stubOverrides: Record<string, boolean> = {},
) => {
  editorProps = props;
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/alerts", name: "alertList", component: EditorRoute },
      { path: "/alerts/anomaly/add", name: "addAnomalyDetection", component: EditorRoute },
      {
        path: "/alerts/anomaly/edit/:anomaly_id",
        name: "editAnomalyDetection",
        component: EditorRoute,
      },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push(path);
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [i18n, router],
        provide: { store },
        stubs: { ...stubs, ...stubOverrides },
      },
    },
  );
  if (settle) await flushPromises();
  return wrapper;
};

const vm = () => wrapper!.findComponent(AddAlert).vm as unknown as AddAlertVm;

const edit = async (path: string, value: unknown) => {
  window.dispatchEvent(new Event("pointerdown"));
  vm().form.setFieldValue(path, value);
  await flushPromises();
};

const seedValidScheduled = (form: AlertForm) => {
  form.setFieldValue("name", "checkout_5xx");
  form.setFieldValue("stream_type", "logs");
  form.setFieldValue("stream_name", "default");
  form.setFieldValue("destinations", ["EndpointTest"]);
  form.setFieldValue("query_condition.type", "custom");
  form.setFieldValue("trigger_condition", {
    period: 10,
    operator: ">=",
    frequency: 10,
    cron: "",
    threshold: 3,
    silence: 10,
    frequency_type: "minutes",
    timezone: "UTC",
  });
};

describe("AddAlert drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    emitted.list = [];
    emitted.cancel = 0;
    vi.mocked(toast).mockClear();
    vi.mocked(alertsService.create_by_alert_id).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    wrapper?.unmount();
    wrapper = null;
  });

  it("writes a new alert's form, folder and open tab when the page hides", async () => {
    await mountEditor();
    await edit("name", "checkout_errors");
    vm().activeTab = "advanced";
    await nextTick();
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<Record<string, unknown>>(newScope);
    expect(draft?.data).toMatchObject({
      tab: "advanced",
      folderId: "default",
      values: { name: "checkout_errors", is_real_time: "false" },
    });
  });

  it("does not count switching tabs alone as an unsaved change", async () => {
    await mountEditor();
    window.dispatchEvent(new Event("pointerdown"));
    vm().activeTab = "advanced";
    await nextTick();
    window.dispatchEvent(new Event("pagehide"));

    expect(vm().alertDraft.hasUnsavedChanges()).toBe(false);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("takes its change detection from the shared draft hook, with no first-input listeners of its own", async () => {
    const added = vi.spyOn(window, "addEventListener");
    try {
      await mountEditor();
      const captured = (name: string) =>
        added.mock.calls.filter(([type, , opts]) => type === name && opts === true).length;
      for (const name of ["pointerdown", "keydown", "focusin", "beforeinput"]) {
        expect(captured(name)).toBe(1);
      }
    } finally {
      added.mockRestore();
    }
  });

  it("continues a draft into a fresh editor with its values, tab and folder", async () => {
    await mountEditor();
    await edit("name", "checkout_errors");
    await edit("stream_name", "k8s");
    vm().activeTab = "advanced";
    vm().activeFolderId = "7400179149878333440";
    await nextTick();
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();

    await mountEditor();
    expect(byTest("editor-draft-restore-message")?.textContent).toContain(
      "unsaved changes to this alert",
    );
    click("editor-draft-continue");
    await flushPromises();

    expect(vm().formData.name).toBe("checkout_errors");
    expect(vm().formData.stream_name).toBe("k8s");
    expect(vm().activeTab).toBe("advanced");
    expect(vm().activeFolderId).toBe("7400179149878333440");
    expect(vm().alertDraft.hasUnsavedChanges()).toBe(true);
  });

  it("drafts a composite alert from its form's update and continues it as a composite", async () => {
    const composite = { CompositeAlertForm: true };
    await mountEditor("/alerts?action=add", {}, true, composite);
    await edit("is_real_time", "composite");
    await edit("name", "checkout_composite");
    const children = [
      { alert_id: "a1", alias: "A" },
      { alert_id: "a2", alias: "B" },
    ];
    window.dispatchEvent(new Event("pointerdown"));
    wrapper!.findComponent({ name: "CompositeAlertForm" }).vm.$emit("update:modelValue", {
      composite_condition: {
        expression: "A && B",
        warning_counts_as_firing: true,
        stale_child_policy: "use_last_state",
      },
      children,
    });
    await flushPromises();
    window.dispatchEvent(new Event("pagehide"));

    expect(
      readEditorDraft<{ values: Record<string, unknown> }>(newScope)?.data.values,
    ).toMatchObject({
      name: "checkout_composite",
      is_real_time: "composite",
      composite_condition: { expression: "A && B" },
      children,
    });
    wrapper!.unmount();

    await mountEditor("/alerts?action=add", {}, true, composite);
    click("editor-draft-continue");
    await flushPromises();
    expect(vm().formData).toMatchObject({
      name: "checkout_composite",
      is_real_time: "composite",
      composite_condition: { expression: "A && B" },
      children,
    });
    expect(wrapper!.findComponent({ name: "CompositeAlertForm" }).exists()).toBe(true);
    expect(vm().alertDraft.hasUnsavedChanges()).toBe(true);
  });

  it("Escape on the restore dialog keeps the draft, Start fresh drops it", async () => {
    await mountEditor();
    await edit("name", "from_draft");
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();

    await mountEditor();
    pressEscape();
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(vm().formData.name).toBe("");
    expect(readEditorDraft(newScope)).not.toBeNull();
    wrapper!.unmount();

    await mountEditor();
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();
    expect(vm().formData.name).toBe("");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("a new anomaly detection's draft has its own slot, with Escape and Start fresh", async () => {
    const anomalyScope = { ...newScope, variant: "anomaly" };
    writeEditorDraft(anomalyScope, {
      data: { values: { name: "anomaly_from_draft" }, tab: "condition", folderId: "default" },
    });
    await mountEditor("/alerts/anomaly/add");
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    pressEscape();
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(readEditorDraft(anomalyScope)).not.toBeNull();
    expect(readEditorDraft(newScope)).toBeNull();
    wrapper!.unmount();

    await mountEditor("/alerts/anomaly/add");
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(readEditorDraft(anomalyScope)).toBeNull();
  });

  it("keys an edited alert's draft by its id and ignores evaluation timestamps in the base", async () => {
    await mountEditor("/alerts?action=update&alert_id=3HGifdlCfgrm1thif69NRJig9E5", {
      modelValue: { ...savedAlert },
      isUpdated: true,
    });
    await edit("description", "pages on-call");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft(editScope);
    expect(draft?.data).toMatchObject({ values: { description: "pages on-call" } });
    expect(draft?.baseHash).toBe(
      hashDraftValue(alertDraftBase({ ...savedAlert, last_triggered_at: 1 })),
    );
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("counts an edit typed while the editor is still loading as unsaved, through a later click", async () => {
    await mountEditor(
      "/alerts?action=update&alert_id=3HGifdlCfgrm1thif69NRJig9E5",
      { modelValue: { ...savedAlert }, isUpdated: true },
      false,
      { AlertSettings: false },
    );
    await wrapper!
      .findComponent(AddAlert)
      .get('[data-test="alert-settings-period-input-field"]')
      .setValue("15");
    await flushPromises();
    window.dispatchEvent(new Event("pointerdown"));

    expect(vm().alertDraft.hasUnsavedChanges()).toBe(true);
    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-secondary-btn");
    await navigation;
    expect(readEditorDraft(editScope)).not.toBeNull();
  });

  it("drafts an edit filled with no key or pointer event, and asks on leave", async () => {
    await mountEditor(
      "/alerts?action=update&alert_id=3HGifdlCfgrm1thif69NRJig9E5",
      { modelValue: { ...savedAlert }, isUpdated: true },
      true,
      { AlertSettings: false },
    );
    await fillField("alert-settings-period-input-field", "25");
    // The period field commits after its 300 ms debounce.
    await vi.waitFor(() =>
      expect(String((vm().formData.trigger_condition as { period: unknown }).period)).toBe("25"),
    );
    window.dispatchEvent(new Event("pagehide"));

    expect(vm().alertDraft.hasUnsavedChanges()).toBe(true);
    expect(readEditorDraft(editScope)).not.toBeNull();
    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-secondary-btn");
    await navigation;
  });

  it("Discard on a sidebar leave removes the edit's autosaved draft", async () => {
    await mountEditor("/alerts?action=update&alert_id=3HGifdlCfgrm1thif69NRJig9E5", {
      modelValue: { ...savedAlert },
      isUpdated: true,
    });
    await edit("trigger_condition.threshold", 7);
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).not.toBeNull();

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("o-dialog-neutral-btn");
    await navigation;
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/logs");
    expect(readEditorDraft(editScope)).toBeNull();
  });

  it("does not take a hidden select's change during the load for an edit, so nothing autosaves", async () => {
    await mountEditor(
      "/alerts?action=update&alert_id=3HGifdlCfgrm1thif69NRJig9E5",
      { modelValue: { ...savedAlert }, isUpdated: true },
      false,
    );
    const hidden = wrapper!.findComponent(AddAlert).get('select[aria-hidden="true"]');
    hidden.element.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vm().form.setFieldValue("description", "set by a late load");
    await vi.advanceTimersByTimeAsync(PANEL_DRAFT_AUTOSAVE_MS + 100);
    vi.useRealTimers();
    window.dispatchEvent(new Event("pagehide"));

    expect(vm().alertDraft.hasUnsavedChanges()).toBe(false);
    expect(readEditorDraft(editScope)).toBeNull();
    await router.push("/logs");
    expect(router.currentRoute.value.path).toBe("/logs");
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });

  it("after Discard, a load landing before the editor goes writes nothing back", async () => {
    let release!: () => void;
    const nextPage = new Promise<void>((resolve) => (release = resolve));
    await mountEditor("/alerts?action=update&alert_id=3HGifdlCfgrm1thif69NRJig9E5", {
      modelValue: { ...savedAlert },
      isUpdated: true,
    });
    router.beforeEach((to) => (to.path === "/logs" ? nextPage.then(() => true) : true));
    await edit("trigger_condition.threshold", 7);
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).not.toBeNull();

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("o-dialog-neutral-btn");
    await flushPromises();
    expect(readEditorDraft(editScope)).toBeNull();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vm().form.setFieldValue("description", "set by a late load");
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(PANEL_DRAFT_AUTOSAVE_MS + 100);
    vi.useRealTimers();
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).toBeNull();

    release();
    await navigation;
    expect(router.currentRoute.value.path).toBe("/logs");
    expect(readEditorDraft(editScope)).toBeNull();
  });

  it("ignores a shortcut pressed while the editor is still loading", async () => {
    await mountEditor(
      "/alerts?action=update&alert_id=3HGifdlCfgrm1thif69NRJig9E5",
      { modelValue: { ...savedAlert }, isUpdated: true },
      false,
      { AlertSettings: false },
    );
    await wrapper!
      .findComponent(AddAlert)
      .get('[data-test="alert-settings-period-input-field"]')
      .trigger("keydown", { key: "s", metaKey: true });
    await flushPromises();
    window.dispatchEvent(new Event("pointerdown"));

    expect(vm().alertDraft.hasUnsavedChanges()).toBe(false);
  });

  it("warns when the saved alert changed after the draft was written", async () => {
    writeEditorDraft(editScope, {
      data: { values: {}, tab: "condition", folderId: "default", aggregationEnabled: false },
      baseHash: hashDraftValue(alertDraftBase(savedAlert)),
    });
    await mountEditor("/alerts?action=update&alert_id=3HGifdlCfgrm1thif69NRJig9E5", {
      modelValue: { ...savedAlert, description: "edited by a teammate" },
      isUpdated: true,
    });

    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("asks on Cancel with unsaved changes, and Discard closes and drops the draft", async () => {
    await mountEditor();
    await edit("name", "checkout_errors");
    window.dispatchEvent(new Event("pagehide"));

    click("add-alert-cancel-btn");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-neutral-btn");
    await flushPromises();

    expect(emitted.cancel).toBe(1);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("guards closing the list-hosted editor through the route query", async () => {
    await mountEditor();
    await edit("name", "checkout_errors");

    const navigation = router.push("/alerts");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-secondary-btn");
    await navigation;

    expect(router.currentRoute.value.query.action).toBeUndefined();
    expect(readEditorDraft(newScope)?.data).toMatchObject({
      values: { name: "checkout_errors" },
    });
  });

  it("saves from the leave dialog without navigating, then continues the navigation", async () => {
    await mountEditor();
    window.dispatchEvent(new Event("pointerdown"));
    seedValidScheduled(vm().form);
    await flushPromises();

    const navigation = router.push("/logs");
    await flushPromises();
    click("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1);
    expect(emitted.list).toEqual([["default", { navigate: false }]]);
    expect(router.currentRoute.value.path).toBe("/logs");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("stays in the editor when the leave dialog's Save fails validation", async () => {
    await mountEditor();
    await edit("name", "bad name");

    const navigation = router.push("/logs");
    await flushPromises();
    click("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/alerts");
    expect(emitted.list).toEqual([]);
  });

  it("drops the draft on a normal save and tells the host to navigate", async () => {
    await mountEditor();
    window.dispatchEvent(new Event("pointerdown"));
    seedValidScheduled(vm().form);
    await flushPromises();
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).not.toBeNull();

    await vm().handleSave();
    await flushPromises();

    expect(emitted.list).toEqual([["default", { navigate: true }]]);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("leaves no new-alert draft behind when the reset form changes after a save, before the editor closes", async () => {
    await mountEditor();
    window.dispatchEvent(new Event("pointerdown"));
    seedValidScheduled(vm().form);
    await flushPromises();

    await vm().handleSave();
    await flushPromises();
    vm().form.setFieldValue("stream_type", "metrics");
    vm().activeFolderId = "7400179149878333440";
    await flushPromises();
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();
    wrapper = null;

    expect(readEditorDraft(newScope)).toBeNull();
    await mountEditor();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
  });

  it("leaves no draft of a saved alert behind once the save reset its form", async () => {
    await mountEditor("/alerts?action=update&alert_id=3HGifdlCfgrm1thif69NRJig9E5", {
      modelValue: { ...savedAlert },
      isUpdated: true,
    });
    await edit("description", "pages on-call");

    await vm().handleSave();
    await flushPromises();
    vm().form.setFieldValue("stream_type", "metrics");
    await flushPromises();
    window.dispatchEvent(new Event("pagehide"));

    expect(emitted.list).toEqual([["default", { navigate: true }]]);
    expect(readEditorDraft(editScope)).toBeNull();
  });

  describe("new anomaly detection", () => {
    const anomalyNewScope: EditorDraftScope = { ...newScope, variant: "anomaly" };

    it("drafts in its own slot, never offering or overwriting a new alert's draft", async () => {
      await mountEditor();
      await edit("name", "checkout_errors");
      window.dispatchEvent(new Event("pagehide"));
      wrapper!.unmount();
      wrapper = null;

      await mountEditor("/alerts/anomaly/add");
      expect(byTest("editor-draft-restore-dialog")).toBeNull();
      expect(vm().formData.is_real_time).toBe("anomaly");
      await edit("name", "latency_spikes");
      window.dispatchEvent(new Event("pagehide"));

      expect(
        readEditorDraft<{ values: Record<string, unknown> }>(anomalyNewScope)?.data.values,
      ).toMatchObject({
        name: "latency_spikes",
        is_real_time: "anomaly",
      });
      expect(
        readEditorDraft<{ values: Record<string, unknown> }>(newScope)?.data.values,
      ).toMatchObject({
        name: "checkout_errors",
      });
    });

    it("leaves a new anomaly's draft out of a new alert, and offers it back on the anomaly page", async () => {
      await mountEditor("/alerts/anomaly/add");
      await edit("name", "latency_spikes");
      window.dispatchEvent(new Event("pagehide"));
      wrapper!.unmount();
      wrapper = null;

      await mountEditor();
      expect(byTest("editor-draft-restore-dialog")).toBeNull();
      expect(vm().formData.is_real_time).toBe("false");
      wrapper!.unmount();
      wrapper = null;

      await mountEditor("/alerts/anomaly/add");
      expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    });
  });

  describe("anomaly edit", () => {
    const anomalyScope: EditorDraftScope = { ...newScope, entityId: "3KueJDSDHSuMkVJzytLUMBNEBLN" };
    const anomalyDraft = {
      values: {},
      tab: "anomaly-config",
      folderId: "default",
      aggregationEnabled: false,
      anomaly: {},
    };

    it("drops the draft of a deleted anomaly config with an info toast", async () => {
      writeEditorDraft(anomalyScope, { data: anomalyDraft });
      vi.mocked(anomalyDetectionService.get).mockRejectedValueOnce({
        response: { status: 404 },
      });
      await mountEditor("/alerts/anomaly/edit/3KueJDSDHSuMkVJzytLUMBNEBLN");

      expect(readEditorDraft(anomalyScope)).toBeNull();
      expect(byTest("editor-draft-restore-dialog")).toBeNull();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "info",
          message: "This alert no longer exists, so its unsaved draft was discarded.",
        }),
      );
    });

    it("keeps the draft when the anomaly config could not be loaded", async () => {
      writeEditorDraft(anomalyScope, { data: anomalyDraft });
      vi.mocked(anomalyDetectionService.get).mockRejectedValueOnce({
        response: { status: 500 },
      });
      await mountEditor("/alerts/anomaly/edit/3KueJDSDHSuMkVJzytLUMBNEBLN");

      expect(readEditorDraft(anomalyScope)).not.toBeNull();
      expect(byTest("editor-draft-restore-dialog")).toBeNull();
    });
  });
});
