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
import { defineComponent, h } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import config from "@/aws-exports";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import { queryClient } from "@/composables/query/queryClient";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { alertDetailQuery } from "@/services/alerts.queries";
import { toast } from "@/lib/feedback/Toast/useToast";
import { readEditorDraft, type EditorDraftScope } from "@/utils/drafts/editorDraftStore";
import { AlertFocusManager } from "@/utils/alerts/focusManager";
import { ALERT_PREFILL_KEY, writeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import {
  ALERT_PREFILL_VERSION,
  type AlertEditHandoff,
  type AlertFieldPatch,
} from "@/ts/interfaces/alertPrefill";
import { byTest, clickLeave, clickRestore, pressEscape } from "@/test/unit/helpers/draftDom";
import autoobserveDecisions from "@/services/autoobserveDecisions";
import {
  clearAppliedSession,
  useAppliedChanges,
} from "@/components/autoobserve/decisions/appliedChanges";
import AddAlert from "./AddAlert.vue";

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn(() => Promise.resolve({ schema: [{ name: "status", type: "Int64" }] })),
    getStreams: vi.fn(() => Promise.resolve({ list: [{ name: "default" }, { name: "app" }] })),
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
      update_by_alert_id: vi.fn(() => Promise.resolve({ data: { code: 200 } })),
      get_by_alert_id: vi.fn(),
      listByFolderId: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    },
  });
});
vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(() => Promise.resolve({ data: [{ name: "ops-pager" }, { name: "ops-mail" }] })),
    },
  });
});
vi.mock("@/services/autoobserveDecisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/autoobserveDecisions")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      decide: vi.fn(() => Promise.reject({ response: { status: 404, data: {} } })),
      list: vi.fn(),
    },
  };
});
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

interface AddAlertVm {
  form: { setFieldValue: (path: string, value: unknown) => void };
  formData: Record<string, any>;
  handleSave: () => Promise<void>;
  alertDraft: { hasUnsavedChanges: () => boolean };
}

// Shape of GET /api/v2/{org}/alerts/{id}, with neutral names.
const savedAlert = {
  id: "a1",
  name: "ops_cpu",
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
  destinations: [] as string[],
  context_attributes: {},
  row_template: "",
  row_template_type: "String",
  description: "",
  enabled: true,
  tz_offset: 0,
  owner: "root@example.com",
  last_edited_by: "root@example.com",
  workflows: ["wf-1"],
  pending_period_sec: 60,
  keep_firing_for: 0,
  recovery_destinations: [],
};

const editScope: EditorDraftScope = {
  kind: "alert",
  org: "default",
  entityId: "a1",
  userEmail: "example@gmail.com",
};

const fullPatch: AlertFieldPatch = {
  pendingPeriodSecs: { from: 60, to: 120 },
  keepFiringForSecs: { from: 0, to: 300 },
  silenceMinutes: { from: 10, to: 45 },
  destinations: { from: [], to: ["ops-pager"] },
};

const handoff = (overrides: Partial<AlertEditHandoff> = {}): AlertEditHandoff => ({
  version: ALERT_PREFILL_VERSION,
  source: "calibration",
  target: { alertId: "a1", findingId: "f1" },
  focus: "pending_period",
  patch: fullPatch,
  ...overrides,
});

const stubs = {
  QueryConfig: true,
  AlertSettings: true,
  CompareWithPast: true,
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
  CompositeAlertForm: true,
};

let router: Router;
let wrapper: VueWrapper | null = null;
let editorProps: Record<string, unknown> = {};
// The alert the server answers with; a test edits it to model another user's change.
let serverAlert: Record<string, unknown> = savedAlert;
const serverDestinations = () =>
  Promise.resolve({ data: [{ name: "ops-pager" }, { name: "ops-mail" }] });

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

const EditorRoute = defineComponent({
  setup() {
    return () => h(AddAlert, { ...editorProps });
  },
});

const mountEditor = async (
  alert: Record<string, unknown> = savedAlert,
  query = "?prefill=calibration",
  stubOverrides: Record<string, boolean> = {},
) => {
  editorProps = { modelValue: structuredClone(alert), isUpdated: true };
  serverAlert = structuredClone(alert);
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/alerts/edit/:alert_id", name: "editAlert", component: EditorRoute },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push(`/alerts/edit/${String(alert.id)}${query}`);
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
  await flushPromises();
  return wrapper;
};

const vm = () => wrapper!.findComponent(AddAlert).vm as unknown as AddAlertVm;
const banner = () => byTest("add-alert-calibration-banner");
const bannerText = () => banner()?.textContent?.trim() ?? "";

const editSilence = async (value: number) => {
  window.dispatchEvent(new Event("pointerdown"));
  vm().form.setFieldValue("trigger_condition.silence", value);
  await flushPromises();
};

// The handoff is an Alert Calibration feature: the enterprise build flag and the server switch must both be on.
const calibration = {
  enterprise: config.isEnterprise,
  enabled: store.state.zoConfig.alert_calibration_enabled,
};
const setCalibration = (on: boolean) => {
  config.isEnterprise = on ? "true" : "false";
  store.state.zoConfig.alert_calibration_enabled = on;
};
const restoreCalibration = () => {
  config.isEnterprise = calibration.enterprise;
  store.state.zoConfig.alert_calibration_enabled = calibration.enabled;
};

describe("AddAlert calibration handoff", () => {
  beforeEach(() => {
    setCalibration(true);
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(toast).mockClear();
    vi.mocked(alertsService.update_by_alert_id).mockClear();
    queryClient.clear();
    vi.mocked(alertsService.get_by_alert_id).mockImplementation(
      async () => ({ data: structuredClone(serverAlert) }) as any,
    );
    vi.mocked(destinationService.list).mockImplementation(serverDestinations as any);
  });

  afterEach(() => {
    restoreCalibration();
    vi.restoreAllMocks();
    wrapper?.unmount();
    wrapper = null;
  });

  it("the edit route with prefill=calibration keeps the saved query", async () => {
    writeAlertEditHandoff(handoff({ patch: undefined, focus: "query" }));
    const sqlAlert = {
      ...savedAlert,
      stream_name: "app",
      query_condition: { ...savedAlert.query_condition, type: "sql", sql: "SELECT * FROM app" },
    };
    await mountEditor(sqlAlert);

    expect(vm().formData.query_condition.type).toBe("sql");
    expect(vm().formData.query_condition.sql).toBe("SELECT * FROM app");
    expect(vm().formData.stream_name).toBe("app");
  });

  it("the patch lands as unsaved, in form units", async () => {
    writeAlertEditHandoff(handoff());
    await mountEditor();

    expect(vm().formData.pending_period_sec).toBe(2);
    expect(vm().formData._ui.pendingPeriod).toBe(2);
    expect(vm().formData.keep_firing_for).toBe(300);
    expect(vm().formData.trigger_condition.silence).toBe(45);
    expect(vm().formData.destinations).toEqual(["ops-pager"]);
    expect(vm().formData.workflows).toEqual(["wf-1"]);
    expect(vm().alertDraft.hasUnsavedChanges()).toBe(true);
    expect(banner()?.getAttribute("data-severity")).toBe("info");
    expect(bannerText()).toContain("Hold for 1 minute → 2 minutes");
    expect(bannerText()).toContain("Cooldown period 10 minutes → 45 minutes");
    expect(bannerText()).toContain("Destinations No destination → ops-pager");

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-secondary-btn");
    await navigation;
    expect(
      readEditorDraft<{ values: Record<string, unknown> }>(editScope)?.data.values,
    ).toMatchObject({ pending_period_sec: 2 });
  });

  it("shows a pending period held in hours as the suggested minutes", async () => {
    writeAlertEditHandoff(handoff({ patch: { pendingPeriodSecs: { from: 3600, to: 120 } } }));
    await mountEditor({ ...savedAlert, pending_period_sec: 3600 }, "?prefill=calibration", {
      AlertSettings: false,
    });

    expect(vm().formData.pending_period_sec).toBe(2);
    const input = wrapper!
      .findComponent(AddAlert)
      .get('[data-test="alert-settings-pending-period-input"] input');
    expect((input.element as HTMLInputElement).value).toBe("2");
  });

  it("a stored draft is never overwritten", async () => {
    const seedDraft = async () => {
      await mountEditor(savedAlert, "");
      await editSilence(99);
      window.dispatchEvent(new Event("pagehide"));
      wrapper!.unmount();
      writeAlertEditHandoff(handoff());
    };

    await seedDraft();
    await mountEditor();
    clickRestore("editor-draft-continue");
    await flushPromises();
    expect(vm().formData.trigger_condition.silence).toBe(99);
    expect(vm().formData.pending_period_sec).toBe(1);
    expect(banner()?.getAttribute("data-severity")).toBe("warning");
    expect(bannerText()).toContain("this alert has unsaved changes");
    wrapper!.unmount();
    localStorage.clear();

    await seedDraft();
    await mountEditor();
    pressEscape();
    await flushPromises();
    expect(vm().formData.trigger_condition.silence).toBe(10);
    expect(vm().formData.pending_period_sec).toBe(1);
    expect(bannerText()).toContain("this alert has unsaved changes");
    wrapper!.unmount();
    localStorage.clear();

    await seedDraft();
    await mountEditor();
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();
    expect(vm().formData.trigger_condition.silence).toBe(45);
    expect(vm().formData.pending_period_sec).toBe(2);
    expect(banner()?.getAttribute("data-severity")).toBe("info");
  });

  it("a stale handoff is not applied at the editor", async () => {
    writeAlertEditHandoff(handoff({ patch: { silenceMinutes: { from: 10, to: 45 } } }));
    await mountEditor({
      ...savedAlert,
      trigger_condition: { ...savedAlert.trigger_condition, silence: 30 },
    });

    expect(vm().formData.trigger_condition.silence).toBe(30);
    expect(banner()?.getAttribute("data-severity")).toBe("warning");
    expect(bannerText()).toContain("this alert changed after the analysis");
    expect(vm().alertDraft.hasUnsavedChanges()).toBe(false);
  });

  it("a handoff for another alert is ignored and cleared", async () => {
    writeAlertEditHandoff(handoff({ target: { alertId: "a2", findingId: "f1" } }));
    await mountEditor();

    expect(vm().formData.pending_period_sec).toBe(1);
    expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
    expect(bannerText()).toBe("");
    expect(vm().alertDraft.hasUnsavedChanges()).toBe(false);
  });

  it("a missing destination and an unsupported type apply nothing", async () => {
    writeAlertEditHandoff(
      handoff({
        patch: { silenceMinutes: { from: 10, to: 45 }, destinations: { from: [], to: ["gone"] } },
      }),
    );
    await mountEditor();
    expect(vm().formData.trigger_condition.silence).toBe(10);
    expect(vm().formData.destinations).toEqual([]);
    expect(banner()?.getAttribute("data-severity")).toBe("warning");
    expect(bannerText()).toContain("gone no longer exists");
    wrapper!.unmount();

    writeAlertEditHandoff(handoff({ patch: { silenceMinutes: { from: 10, to: 45 } } }));
    await mountEditor({ ...savedAlert, is_real_time: true });
    expect(vm().formData.trigger_condition.silence).toBe(10);
    expect(banner()?.getAttribute("data-severity")).toBe("default");
    expect(bannerText()).toContain("applies only to scheduled alerts");
    wrapper!.unmount();

    writeAlertEditHandoff(handoff({ patch: { keepFiringForSecs: { from: 0, to: 300 } } }));
    await mountEditor({ ...savedAlert, alert_type: "composite" });
    expect(vm().formData.keep_firing_for).toBe(0);
    expect(bannerText()).toContain("applies only to scheduled alerts");
    expect(vm().alertDraft.hasUnsavedChanges()).toBe(false);
  });

  it("an edit made while the handoff is still checking is never overwritten", async () => {
    const pendingList = deferred<unknown>();
    vi.mocked(destinationService.list).mockImplementation(() => pendingList.promise as any);
    writeAlertEditHandoff(handoff());
    await mountEditor();
    await editSilence(99);
    pendingList.resolve(await serverDestinations());
    await flushPromises();
    expect(vm().formData.trigger_condition.silence).toBe(99);
    expect(vm().formData.pending_period_sec).toBe(1);
    expect(vm().formData.destinations).toEqual([]);
    expect(banner()?.getAttribute("data-severity")).toBe("warning");
    expect(bannerText()).toContain("this alert has unsaved changes");
    wrapper!.unmount();
    localStorage.clear();

    // With draft storage unavailable nothing is ever stored, so only the live form can show the edit.
    const pendingAlert = deferred<unknown>();
    vi.mocked(alertsService.get_by_alert_id).mockImplementation(() => pendingAlert.promise as any);
    writeAlertEditHandoff(handoff({ patch: { silenceMinutes: { from: 10, to: 45 } } }));
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await mountEditor();
    await editSilence(99);
    pendingAlert.resolve({ data: structuredClone(savedAlert) });
    await flushPromises();
    expect(vm().formData.trigger_condition.silence).toBe(99);
    expect(bannerText()).toContain("this alert has unsaved changes");
    blocked.mockRestore();
  });

  it("the editor checks a fresh read of the alert, not the cached one", async () => {
    writeAlertEditHandoff(handoff({ patch: { pendingPeriodSecs: { from: 60, to: 120 } } }));
    // The prompt left this entry in the cache seconds ago, inside its stale time.
    queryClient.setQueryData(
      alertDetailQuery("default", "a1").queryKey,
      structuredClone(savedAlert),
    );
    const moved = { ...savedAlert, pending_period_sec: 300 };
    vi.mocked(alertsService.get_by_alert_id).mockImplementation(
      async () => ({ data: structuredClone(moved) }) as any,
    );
    await mountEditor();
    expect(vm().formData.pending_period_sec).toBe(1);
    expect(banner()?.getAttribute("data-severity")).toBe("warning");
    expect(bannerText()).toContain("this alert changed after the analysis");
    expect(vm().alertDraft.hasUnsavedChanges()).toBe(false);
    wrapper!.unmount();

    // A change saved by someone else while the restore dialog is open is caught after the choice.
    await mountEditor(savedAlert, "");
    await editSilence(99);
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();
    writeAlertEditHandoff(handoff({ patch: { silenceMinutes: { from: 10, to: 45 } } }));
    await mountEditor();
    serverAlert = {
      ...savedAlert,
      trigger_condition: { ...savedAlert.trigger_condition, silence: 30 },
    };
    vi.mocked(alertsService.get_by_alert_id).mockImplementation(
      async () => ({ data: structuredClone(serverAlert) }) as any,
    );
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();
    expect(vm().formData.trigger_condition.silence).toBe(10);
    expect(bannerText()).toContain("this alert changed after the analysis");
    wrapper!.unmount();
    localStorage.clear();

    vi.mocked(alertsService.get_by_alert_id).mockRejectedValue(new Error("offline"));
    writeAlertEditHandoff(handoff({ patch: { silenceMinutes: { from: 10, to: 45 } } }));
    await mountEditor();
    expect(vm().formData.trigger_condition.silence).toBe(10);
    expect(banner()?.getAttribute("data-severity")).toBe("warning");
    expect(bannerText()).toContain("could not be read");
  });

  it("a destination deleted since it was cached withholds the whole patch", async () => {
    queryClient.setQueryData(destinationsQuery("default", "alert").queryKey, [
      { name: "ops-pager" },
    ]);
    vi.mocked(destinationService.list).mockImplementation(
      async () => ({ data: [{ name: "ops-mail" }] }) as any,
    );
    writeAlertEditHandoff(
      handoff({
        patch: {
          silenceMinutes: { from: 10, to: 45 },
          destinations: { from: [], to: ["ops-pager"] },
        },
      }),
    );
    await mountEditor();
    expect(vm().formData.trigger_condition.silence).toBe(10);
    expect(vm().formData.destinations).toEqual([]);
    expect(bannerText()).toContain("ops-pager no longer exists");
  });

  it("a review handoff focuses the field and applies nothing", async () => {
    const focus = vi.spyOn(AlertFocusManager.prototype, "focusField");
    writeAlertEditHandoff(handoff({ patch: undefined, focus: "query" }));
    await mountEditor();

    expect(focus).toHaveBeenCalledWith("query");
    expect(vm().formData.pending_period_sec).toBe(1);
    expect(vm().alertDraft.hasUnsavedChanges()).toBe(false);
    expect(banner()?.getAttribute("data-severity")).toBe("info");
    expect(bannerText()).toBe("Opened from an Alert calibration finding.");
  });

  it("Save after a handoff is the ordinary save", async () => {
    writeAlertEditHandoff(handoff());
    await mountEditor();
    await vm().handleSave();
    await flushPromises();

    expect(alertsService.update_by_alert_id).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(alertsService.update_by_alert_id).mock.calls[0][1] as Record<
      string,
      any
    >;
    expect(payload.pending_period_sec).toBe(120);
    expect(payload.trigger_condition.silence).toBe(45);
    expect(payload.destinations).toEqual(["ops-pager"]);
    const messages = vi.mocked(toast).mock.calls.map(([options]) => String(options.message));
    expect(messages).toContain("Alert updated successfully.");
    expect(messages.join(" ")).not.toMatch(/calibration|suggest|appl/i);
    expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
  });

  it("Save after an applied handoff records it as applied in the editor, with Undo (W5)", async () => {
    vi.mocked(autoobserveDecisions.decide).mockResolvedValueOnce({
      data: {
        change: "created",
        decision: {
          decision_id: "alert_finding:f1",
          family: "alert_finding",
          id: "f1",
          action: "apply",
          state: "applied",
          reason: null,
          note: null,
          has_note: false,
          actor: "you",
          source: "ui",
          decided_at: 1,
          until: null,
          revision: 2,
        },
      },
    } as never);
    writeAlertEditHandoff(handoff());
    await mountEditor();
    await vm().handleSave();
    await flushPromises();
    expect(alertsService.update_by_alert_id).toHaveBeenCalledTimes(1);
    expect(autoobserveDecisions.decide).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        family: "alert_finding",
        id: "f1",
        action: "apply",
        applied_via: "editor",
      }),
    );
    const recorded = vi
      .mocked(toast)
      .mock.calls.find(([options]) => String(options.message).startsWith("Saved and recorded for"));
    expect(recorded?.[0].action?.label).toBe("Undo");
  });

  it("a recorded editor Save lists the change in What I've changed when the server lists none (F3)", async () => {
    clearAppliedSession();
    vi.mocked(autoobserveDecisions.decide).mockResolvedValueOnce({
      data: {
        change: "created",
        decision: {
          decision_id: "alert_finding:f1",
          family: "alert_finding",
          id: "f1",
          action: "apply",
          state: "applied",
          reason: null,
          note: null,
          has_note: false,
          actor: "you",
          source: "ui",
          decided_at: 1,
          until: null,
          revision: 2,
        },
      },
    } as never);
    writeAlertEditHandoff(handoff());
    await mountEditor();
    await vm().handleSave();
    await flushPromises();
    const org = String(store.state.selectedOrganization.identifier);
    const entries = useAppliedChanges(org, []).value;
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("ops_cpu");
    expect(entries[0].view.decision_id).toBe("alert_finding:f1");
    expect(entries[0].fields).toEqual(
      expect.arrayContaining([
        { field: "pending_period_secs", from: 60, to: 120 },
        { field: "silence_minutes", from: 10, to: 45 },
        { field: "destinations", from: [], to: ["ops-pager"] },
      ]),
    );
  });

  it("a failed record lists nothing in What I've changed (F3)", async () => {
    clearAppliedSession();
    vi.mocked(autoobserveDecisions.decide).mockRejectedValueOnce({
      response: { status: 500, data: {} },
    });
    writeAlertEditHandoff(handoff());
    await mountEditor();
    await vm().handleSave();
    await flushPromises();
    const org = String(store.state.selectedOrganization.identifier);
    expect(useAppliedChanges(org, []).value).toHaveLength(0);
  });

  it("a failed record after Save says the change was not recorded, in amber (D7)", async () => {
    vi.mocked(autoobserveDecisions.decide).mockRejectedValueOnce({
      response: { status: 500, data: {} },
    });
    writeAlertEditHandoff(handoff());
    await mountEditor();
    await vm().handleSave();
    await flushPromises();
    expect(alertsService.update_by_alert_id).toHaveBeenCalledTimes(1);
    const notice = vi
      .mocked(toast)
      .mock.calls.find(([options]) => String(options.message).includes("not recorded"));
    expect(String(notice?.[0].message)).toBe(
      "Saved. This change was not recorded, so it can't be undone from AutoObserve.",
    );
    expect(notice?.[0].variant).toBe("warning");
    expect(notice?.[0].action).toBeUndefined();
  });

  it("a finding gone since the handoff (404 not_found) says the change was not recorded (D7)", async () => {
    vi.mocked(autoobserveDecisions.decide).mockRejectedValueOnce({
      response: { status: 404, data: { code: 404, error: "not_found", message: "gone" } },
    });
    writeAlertEditHandoff(handoff());
    await mountEditor();
    await vm().handleSave();
    await flushPromises();
    const messages = vi.mocked(toast).mock.calls.map(([options]) => String(options.message));
    expect(messages).toContain(
      "Saved. This change was not recorded, so it can't be undone from AutoObserve.",
    );
  });

  it("a server without the decision route saves as today, with no notice (D7)", async () => {
    vi.mocked(autoobserveDecisions.decide).mockRejectedValueOnce({
      response: { status: 404, data: {} },
    });
    writeAlertEditHandoff(handoff());
    await mountEditor();
    await vm().handleSave();
    await flushPromises();
    expect(alertsService.update_by_alert_id).toHaveBeenCalledTimes(1);
    const messages = vi.mocked(toast).mock.calls.map(([options]) => String(options.message));
    expect(messages.join(" ")).not.toMatch(/not recorded/);
  });

  it("Save records nothing when the handoff did not apply", async () => {
    vi.mocked(autoobserveDecisions.decide).mockClear();
    writeAlertEditHandoff(handoff({ patch: { silenceMinutes: { from: 10, to: 45 } } }));
    await mountEditor({
      ...savedAlert,
      trigger_condition: { ...savedAlert.trigger_condition, silence: 30 },
    });
    expect(bannerText()).toContain("this alert changed after the analysis");
    await vm().handleSave();
    await flushPromises();
    expect(autoobserveDecisions.decide).not.toHaveBeenCalled();
  });

  it("the handoff is read once", async () => {
    writeAlertEditHandoff(handoff());
    await mountEditor();
    expect(vm().formData.pending_period_sec).toBe(2);
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();

    await mountEditor();
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();
    expect(vm().formData.pending_period_sec).toBe(1);
    expect(bannerText()).toBe("");
  });
});

describe("AddAlert calibration handoff without Alert Calibration (OSS build)", () => {
  beforeEach(() => {
    setCalibration(false);
    localStorage.clear();
    sessionStorage.clear();
    queryClient.clear();
    vi.mocked(alertsService.get_by_alert_id).mockImplementation(
      async () => ({ data: structuredClone(serverAlert) }) as any,
    );
    vi.mocked(destinationService.list).mockImplementation(serverDestinations as any);
  });

  afterEach(() => {
    restoreCalibration();
    vi.restoreAllMocks();
    wrapper?.unmount();
    wrapper = null;
  });

  it("a pasted prefill=calibration URL reserves no strip and applies nothing", async () => {
    writeAlertEditHandoff(handoff());
    await mountEditor();

    expect(banner()).toBeNull();
    expect(vm().formData.pending_period_sec).toBe(1);
    expect(vm().formData.destinations).toEqual([]);
  });

  it("stays off on an enterprise build with calibration turned off", async () => {
    config.isEnterprise = "true";
    writeAlertEditHandoff(handoff());
    await mountEditor();

    expect(banner()).toBeNull();
    expect(vm().formData.pending_period_sec).toBe(1);
  });
});
