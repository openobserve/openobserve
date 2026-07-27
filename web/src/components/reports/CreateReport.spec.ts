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
//
// CreateReport is migrated to OForm + Zod (CreateReport.schema.ts). These tests
// mount the REAL <OForm> (it is NOT stubbed) and assert behavior through the
// form: an empty/invalid required field blocks submit (schema gates it, save NOT
// called); a valid form submits and calls the report service. They also cover the
// restored BEFORE-baseline rules (title/emails required when !cached, name
// resource check, cron required) and keep the folder/dashboard/variables coverage.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import * as vueRouter from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import reports from "@/services/reports";
import dashboardService from "@/services/dashboards";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import CreateReport from "./CreateReport.vue";

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<typeof vueRouter>("vue-router");
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      push: vi.fn(),
      back: vi.fn(),
      replace: vi.fn(),
      currentRoute: { value: { query: {} } },
    })),
  };
});

vi.mock("@/services/reports", () => ({
  default: {
    getReport: vi.fn(),
    getReportById: vi.fn(),
    createReport: vi.fn(),
    createReportV2: vi.fn(),
    updateReport: vi.fn(),
    updateReportById: vi.fn(),
  },
}));

vi.mock("@/services/dashboards", () => ({
  default: {
    list_Folders: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getImageURL: vi.fn(() => ""),
    getUUID: vi.fn(() => "mock-uuid"),
    isValidResourceName: vi.fn((val: string) => /^[a-zA-Z0-9+=,.@_-]+$/.test(val)),
    useLocalTimezone: vi.fn(() => "UTC"),
    getCronIntervalDifferenceInSeconds: vi.fn(() => 3600),
    isAboveMinRefreshInterval: vi.fn(() => true),
    verifyOrganizationStatus: vi.fn(() => Promise.resolve(true)),
  };
});

vi.mock("@/utils/date", () => ({
  convertDateToTimestamp: vi.fn(() => ({
    timestamp: 1700000000,
    offset: 0,
  })),
}));

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn(() => Promise.resolve()),
}));

// ─── Constants ───────────────────────────────────────────────────────────────

const platform = { is: { desktop: true, mobile: false }, has: { touch: false } };

const MOCK_FOLDERS = [
  { name: "Default", folderId: "folder-1" },
  { name: "Reports", folderId: "folder-2" },
];

const MOCK_DASHBOARDS = [
  {
    v1: {
      title: "My Dashboard",
      dashboardId: "dash-1",
      tabs: [{ name: "Tab 1", tabId: "tab-1" }],
      version: 1,
    },
  },
];

const MOCK_REPORT = {
  name: "existing-report",
  description: "Existing description",
  dashboards: [
    {
      folder: "folder-1",
      dashboard: "dash-1",
      tabs: ["tab-1"],
      variables: [],
      timerange: { type: "relative", period: "30m", from: 0, to: 0 },
      report_type: "pdf",
      email_attachment_type: "standard",
      attachment_dimensions: null,
    },
  ],
  destinations: [{ email: "dest@example.com" }],
  enabled: true,
  imagePreview: false,
  title: "Report Title",
  message: "Hello",
  orgId: "test-org",
  start: 0,
  frequency: { interval: 1, type: "once", cron: "" },
  timezone: "UTC",
  timezoneOffset: 0,
  lastTriggeredAt: null,
  createdAt: "",
  updatedAt: "",
  owner: "user@test.com",
  lastEditedBy: "user@test.com",
  report_type: "PDF",
};

// ─── Mount factory ────────────────────────────────────────────────────────────

function mountComponent(routeQuery: Record<string, string> = {}) {
  const mockRouter = {
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    currentRoute: { value: { query: routeQuery } },
  };
  vi.mocked(vueRouter.useRouter).mockReturnValue(mockRouter as any);

  const wrapper = mount(CreateReport, {
    global: {
      plugins: [store, i18n],
      provide: { store, platform },
      stubs: {
        DateTime: { template: '<div data-test="datetime-stub" />' },
        VariablesInput: { template: '<div data-test="variables-stub" />' },
        ConfirmDialog: { template: '<div data-test="confirm-dialog-stub" />' },
        SelectFolderDropdown: { template: '<div data-test="folder-dropdown-stub" />' },
      },
    },
    attachTo: document.body,
  });

  return { wrapper, mockRouter };
}

// Drive the REAL form's submit so the schema runs + the handler is awaited
// deterministically (a fire-and-forget native submit would not be).
async function submitForm(w: VueWrapper) {
  await (w.vm as any).form.handleSubmit();
  await flushPromises();
}

function setField(w: VueWrapper, name: string, value: unknown) {
  (w.vm as any).form.setFieldValue(name, value);
}

// Drive a real OFormSelect's inner OSelect the way a user click does — emit
// `update:modelValue` from the actual rendered OSelect. This exercises the full
// path: OFormSelect's internal `field.handleChange` AND the consumer's
// `@update:model-value` handler (merged onto the same event via $attrs), which is
// exactly the wiring the cascade depends on.
async function pickFromSelect(w: VueWrapper, name: string, value: unknown) {
  const target = w.findAllComponents(OSelect).find((s) => s.props("name") === name);
  if (!target) throw new Error(`OSelect[name="${name}"] not rendered`);
  target.vm.$emit("update:modelValue", value);
  await flushPromises();
}

// Fill every required field for the default (once / scheduleNow / not-cached)
// mode so the whole schema passes. The dashboard row is now a form-owned
// field-array (dashboards[0].*).
async function fillValidForm(w: VueWrapper) {
  setField(w, "dashboards[0].folder", "folder-1");
  setField(w, "dashboards[0].dashboard", "dash-1");
  setField(w, "dashboards[0].tabs", "tab-1");
  setField(w, "name", "new-report");
  setField(w, "title", "Test Title");
  setField(w, "emails", "user@example.com");
  await flushPromises();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CreateReport", () => {
  let wrapper: VueWrapper;
  let mockRouter: ReturnType<typeof mountComponent>["mockRouter"];

  beforeEach(() => {
    vi.mocked(dashboardService.list_Folders).mockResolvedValue({
      data: { list: MOCK_FOLDERS },
    } as any);
    vi.mocked(dashboardService.list).mockResolvedValue({
      data: { dashboards: MOCK_DASHBOARDS },
    } as any);
    vi.mocked(reports.createReport).mockResolvedValue({} as any);
    vi.mocked(reports.createReportV2).mockResolvedValue({} as any);
    vi.mocked(reports.updateReport).mockResolvedValue({} as any);
    vi.mocked(reports.updateReportById).mockResolvedValue({} as any);
    vi.mocked(reports.getReport).mockResolvedValue({ data: MOCK_REPORT } as any);
    vi.mocked(reports.getReportById).mockResolvedValue({ data: MOCK_REPORT } as any);

    store.state.selectedOrganization = {
      identifier: "test-org",
      name: "Test Org",
    } as any;
    store.state.userInfo = { email: "user@test.com" } as any;
    store.state.theme = "light";
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Render ──────────────────────────────────────────────────────────────

  describe("initial render", () => {
    it("should render without errors", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the add-report section", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="add-report-section"]').exists()).toBe(true);
    });

    it("should render the back button", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="add-report-back-btn"]').exists()).toBe(true);
    });

    it("should render 'Add Report' title when not editing", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      const title = wrapper.find('[data-test="add-report-title"]');
      expect(title.exists()).toBe(true);
      expect(title.text()).toContain(i18n.global.t("reports.add"));
    });

    it("should render the report name input", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="add-report-name-input"]').exists()).toBe(true);
    });

    it("should render the description input", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="add-report-description-input"]').exists()).toBe(true);
    });

    it("should render the cached report toggle", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="report-cached-toggle-btn"]').exists()).toBe(true);
    });

    it("should keep the Save button enabled (R3) and submit type", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      const save = wrapper.find('[data-test="add-report-save-btn"]');
      expect(save.exists()).toBe(true);
      expect(save.attributes("disabled")).toBeUndefined();
    });

    it("associates the footer Save with the OForm via form-id (R4 Enter/footer submit)", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      // The id falls through onto OForm's <form>; the footer Save (outside the
      // form) is linked to it via the native form="<id>" attribute.
      const formEl = wrapper.find("form.create-report-form");
      const save = wrapper.find('[data-test="add-report-save-btn"]');
      expect(formEl.attributes("id")).toBe("create-report-form");
      expect(save.attributes("type")).toBe("submit");
      expect(save.attributes("form")).toBe("create-report-form");
    });
  });

  // ── Real OForm schema validation (the key wiring proof) ───────────────────

  describe("OForm schema validation (real form)", () => {
    it("blocks submit and does NOT call the service when required fields are empty", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect(reports.createReportV2).not.toHaveBeenCalled();
    });

    it("submits and calls createReportV2 when the schema passes", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(true);
      expect(reports.createReportV2).toHaveBeenCalledTimes(1);
    });

    it("rejects a name with invalid resource characters", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);
      setField(wrapper, "name", "bad name?");
      await flushPromises();

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect(reports.createReportV2).not.toHaveBeenCalled();
    });

    it("blocks submit in cron mode when the cron expression is empty", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);
      setField(wrapper, "frequencyType", "cron");
      setField(wrapper, "timezone", "UTC");
      setField(wrapper, "cron", "");
      await flushPromises();

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect(reports.createReportV2).not.toHaveBeenCalled();
    });

    it("form-owns the whole dashboard row as a field-array (dashboards[0].*)", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      setField(wrapper, "dashboards[0].report_type", "png");
      setField(wrapper, "dashboards[0].email_attachment_type", "inline");
      setField(wrapper, "dashboards[0].attachmentWidth", 1440);
      setField(wrapper, "dashboards[0].attachmentHeight", 900);
      await flushPromises();
      const row = (wrapper.vm as any).form.state.values.dashboards[0];
      expect(row.report_type).toBe("png");
      expect(row.email_attachment_type).toBe("inline");
      expect(row.attachmentWidth).toBe(1440);
      expect(row.attachmentHeight).toBe(900);
    });

    it("coerces the STRING emitted by the number inputs into a numeric attachment_dimensions payload", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);

      // report_type is "pdf" by default → the Custom Dimensions section renders.
      // Expand it so the width/height number inputs mount.
      await wrapper
        .find('[data-test="add-report-custom-dimensions-section"] .cursor-pointer')
        .trigger("click");
      await flushPromises();

      // Type through the REAL <input type="number">. An OInput number field (no
      // `.number` modifier) emits the RAW STRING the DOM input holds — exactly what
      // a user's keystrokes produce — so this drives the z.coerce.number() path the
      // schema exists for, not a pre-made JS number handed straight to the form.
      await wrapper.find('[data-test="add-report-dimension-width"] input').setValue("1440");
      await wrapper.find('[data-test="add-report-dimension-height"] input').setValue("900");
      await flushPromises();

      // The form holds the raw STRING the number input emitted (pre-coercion).
      const row = (wrapper.vm as any).form.state.values.dashboards[0];
      expect(row.attachmentWidth).toBe("1440");
      expect(row.attachmentHeight).toBe("900");

      await submitForm(wrapper);

      // …but the SAVED payload carries NUMBERS — attachment_dimensions matches the
      // API contract (guards the dashboards `max_record_size` string-leak class of
      // regression: a plain z.number() / a leaked "1440" would fail this).
      expect(reports.createReportV2).toHaveBeenCalledTimes(1);
      const payload = vi.mocked(reports.createReportV2).mock.calls[0][1] as any;
      expect(payload.dashboards[0].attachment_dimensions).toEqual({
        width: 1440,
        height: 900,
      });
      expect(typeof payload.dashboards[0].attachment_dimensions.width).toBe("number");
      expect(typeof payload.dashboards[0].attachment_dimensions.height).toBe("number");
    });

    it("submits in cron mode with a valid cron + timezone", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);
      setField(wrapper, "frequencyType", "cron");
      setField(wrapper, "timezone", "UTC");
      setField(wrapper, "cron", "0 0 12 * * ?");
      await flushPromises();

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(true);
      expect(reports.createReportV2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Restored BEFORE-baseline rules (title / emails required when !cached) ──

  describe("restored dropped validations", () => {
    it("requires a title when the report is NOT cached", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);
      setField(wrapper, "title", "");
      await flushPromises();

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect(reports.createReportV2).not.toHaveBeenCalled();
    });

    it("requires valid emails when the report is NOT cached", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);
      setField(wrapper, "emails", "not-an-email");
      await flushPromises();

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect(reports.createReportV2).not.toHaveBeenCalled();
    });

    it("does NOT require title/emails for a cached report", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      // Cached report: only dashboard + name required.
      setField(wrapper, "dashboards[0].folder", "folder-1");
      setField(wrapper, "dashboards[0].dashboard", "dash-1");
      setField(wrapper, "dashboards[0].tabs", "tab-1");
      setField(wrapper, "name", "cached-report");
      setField(wrapper, "isCachedReport", true);
      setField(wrapper, "title", "");
      setField(wrapper, "emails", "");
      await flushPromises();

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(true);
      expect(reports.createReportV2).toHaveBeenCalledTimes(1);
      // Cached reports persist no destinations.
      const payload = vi.mocked(reports.createReportV2).mock.calls[0][1] as any;
      expect(payload.destinations).toEqual([]);
    });

    it("blocks submit in Schedule Later mode when date/time are empty", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);
      setField(wrapper, "selectedTimeTab", "scheduleLater");
      setField(wrapper, "timezone", "UTC");
      // Start Date + Start Time left empty → the restored rule blocks the save.
      await flushPromises();

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect(reports.createReportV2).not.toHaveBeenCalled();
    });

    it("submits in Schedule Later mode with a valid date + time", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);
      setField(wrapper, "selectedTimeTab", "scheduleLater");
      setField(wrapper, "timezone", "UTC");
      setField(wrapper, "date", "2027-12-29"); // ISO YYYY-MM-DD (ODate value)
      setField(wrapper, "time", "10:30"); // HH:MM (OTime value)
      await flushPromises();

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(true);
      expect(reports.createReportV2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Step error jump ───────────────────────────────────────────────────────

  describe("OStepper error jump", () => {
    it("jumps to step 1 when a dashboard field is missing on submit", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      (wrapper.vm as any).step = 2;
      // Leave the dashboard fields empty → first error is on step 1.
      await submitForm(wrapper);
      expect((wrapper.vm as any).step).toBe(1);
    });

    it("reveals the dashboard-folder field error only after the first submit", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      const form = (wrapper.vm as any).form;
      // Before any submit → the OFormSelect field has no error (submit-then-change).
      expect((form.getFieldMeta("dashboards[0].folder")?.errors ?? []).length).toBe(0);
      await submitForm(wrapper);
      // After submit with an empty folder → the field's error is populated, so
      // the OFormSelect renders it.
      expect((form.getFieldMeta("dashboards[0].folder")?.errors ?? []).length).toBeGreaterThan(0);
    });
  });

  // ── Cascade through the REAL OSelect (@update merge — the flagged risk) ────
  // These drive the actual rendered OSelect (not the handler directly), proving
  // that selecting an option both updates the form value (field binding) AND runs
  // the folder→dashboard→tabs cascade (the consumer @update handler). If the
  // $attrs event-merge dropped either handler, these fail.

  describe("dashboard cascade through the real OSelect", () => {
    it("picking a folder updates the form value AND loads dashboards + clears dependents", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      // Stale dependents that the cascade must clear.
      setField(wrapper, "dashboards[0].dashboard", "stale-dash");
      setField(wrapper, "dashboards[0].tabs", "stale-tab");
      await flushPromises();

      await pickFromSelect(wrapper, "dashboards[0].folder", "folder-1");

      const row = (wrapper.vm as any).form.state.values.dashboards[0];
      // field.handleChange fired (the merge kept the form binding):
      expect(row.folder).toBe("folder-1");
      // onFolderSelection fired (cascade): options loaded + dependents cleared:
      expect(vi.mocked(dashboardService.list)).toHaveBeenCalledWith(
        0,
        10000,
        "name",
        false,
        "",
        "test-org",
        "folder-1",
        "",
      );
      expect(row.dashboard).toBe("");
      expect(row.tabs).toBe("");
    });

    it("picking a dashboard updates the form value AND clears tabs", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await pickFromSelect(wrapper, "dashboards[0].folder", "folder-1");
      setField(wrapper, "dashboards[0].tabs", "stale-tab");
      await flushPromises();

      await pickFromSelect(wrapper, "dashboards[0].dashboard", "dash-1");

      const row = (wrapper.vm as any).form.state.values.dashboards[0];
      expect(row.dashboard).toBe("dash-1");
      expect(row.tabs).toBe("");
      // tab options were populated for the picked dashboard
      expect((wrapper.vm as any).dashboardTabOptions).toEqual([{ label: "Tab 1", value: "tab-1" }]);
    });
  });

  // ── Edit mode ────────────────────────────────────────────────────────────

  describe("edit mode (route has name query param)", () => {
    beforeEach(async () => {
      ({ wrapper, mockRouter } = mountComponent({
        name: "existing-report",
        org_identifier: "test-org",
      }));
      await flushPromises();
    });

    it("should show 'Update Report' title when editing", () => {
      const title = wrapper.find('[data-test="add-report-title"]');
      expect(title.text()).toContain(i18n.global.t("reports.update"));
    });

    it("should call getReport API with correct args", () => {
      expect(vi.mocked(reports.getReport)).toHaveBeenCalledWith("test-org", "existing-report");
    });

    it("should set isEditingReport to true", () => {
      expect((wrapper.vm as any).isEditingReport).toBe(true);
    });

    it("should prefill the form-owned name from the fetched report", () => {
      expect((wrapper.vm as any).form.state.values.name).toBe(MOCK_REPORT.name);
    });

    it("should prefill the dashboard row without the cascade wiping it", () => {
      // The cascade (@update) must NOT fire on programmatic reset/prefill — so
      // the resolved folder/dashboard/tabs survive into the form.
      const row = (wrapper.vm as any).form.state.values.dashboards[0];
      expect(row.folder).toBe("folder-1");
      expect(row.dashboard).toBe("dash-1");
      expect(row.tabs).toBe("tab-1");
      expect(row.timerange).toMatchObject({ type: "relative", period: "30m" });
    });

    it("should call updateReport when submitting a valid edit", async () => {
      await submitForm(wrapper);
      expect(vi.mocked(reports.updateReport)).toHaveBeenCalled();
    });

    it("should handle getReport non-403 error without crashing", async () => {
      vi.mocked(reports.getReport).mockRejectedValueOnce({
        response: { status: 500, data: { message: "error" } },
      });
      const { wrapper: w } = mountComponent({ name: "bad-report" });
      await flushPromises();
      expect((w.vm as any).isFetchingReport).toBe(false);
      w.unmount();
    });

    it("should handle getReport 403 error silently", async () => {
      vi.mocked(reports.getReport).mockRejectedValueOnce({
        response: { status: 403 },
      });
      const { wrapper: w } = mountComponent({ name: "forbidden-report" });
      await flushPromises();
      expect((w.vm as any).isFetchingReport).toBe(false);
      w.unmount();
    });
  });

  // ── Back navigation ──────────────────────────────────────────────────────

  describe("back button", () => {
    it("should call router.back() when back button is clicked", async () => {
      ({ wrapper, mockRouter } = mountComponent());
      await flushPromises();
      await wrapper.find('[data-test="add-report-back-btn"]').trigger("click");
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cached report toggle ─────────────────────────────────────────────────

  describe("cached report toggle", () => {
    it("should set isCachedReport=true when query param type=cached", async () => {
      ({ wrapper } = mountComponent({ type: "cached" }));
      await flushPromises();
      expect((wrapper.vm as any).form.state.values.isCachedReport).toBe(true);
    });

    // Reactivity guard (the OWNER pattern fix): the Share step is driven by a
    // form.useStore view of isCachedReport, so toggling it must reactively hide
    // the step. A non-reactive form.state computed (the pre-fix code) would not.
    it("reactively hides the Share step when isCachedReport is toggled on", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(wrapper.find('[data-test="add-report-share-step"]').exists()).toBe(true);

      setField(wrapper, "isCachedReport", true);
      await flushPromises();

      expect((wrapper.vm as any).isCachedReportValue).toBe(true);
      expect(wrapper.find('[data-test="add-report-share-step"]').exists()).toBe(false);
    });

    // Regression: enabling "Cached Report" AFTER a Continue click must not leave
    // the report unsavable. A Continue click validates via validateField("submit");
    // because the schema is form-level, that run records EVERY failing path —
    // including the still-empty, out-of-step title/emails — into the form-level
    // errorMap.onDynamic. Enabling Cached Report drops those requirements, but
    // handleSubmit() re-validates only fields, never re-running/clearing that
    // form-level result, so in the real browser Save stayed silently blocked
    // (isFormValid stayed false). The values watcher now clears the form-level
    // error SYNCHRONOUSLY once the schema passes.
    //
    // Timing note: assert after nextTick, NOT flushPromises. Without the fix,
    // jsdom's async onDynamicAsync validator eventually re-runs and clears the
    // stale error on the next flush — which masks the bug — but that async clear
    // does not happen in the real browser. The fix's watcher clears it on the
    // same tick as the value change, so the nextTick assertion is what actually
    // distinguishes fixed from unfixed.
    it("clears the stale form-level error synchronously when cached is enabled after a Continue click", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();

      // Step 1 & 2 valid; NOT cached; Share (title/emails) left empty.
      setField(wrapper, "dashboards[0].folder", "folder-1");
      setField(wrapper, "dashboards[0].dashboard", "dash-1");
      setField(wrapper, "dashboards[0].tabs", "tab-1");
      setField(wrapper, "name", "continue-then-cache");
      await flushPromises();

      // Click "Continue" on step 1 → the form-level schema runs and stamps the
      // out-of-step title/emails errors onto the form's errorMap.onDynamic.
      await wrapper.find('[data-test="add-report-step1-continue-btn"]').trigger("click");
      await flushPromises();
      const form = (wrapper.vm as any).form;
      expect(form.state.errorMap?.onDynamic).toBeTruthy();
      expect(form.state.isValid).toBe(false);

      // Enable Cached Report → title/emails become irrelevant. The watcher must
      // clear the stale form-level error on THIS tick (no async round-trip).
      setField(wrapper, "isCachedReport", true);
      await nextTick();
      expect(form.state.errorMap?.onDynamic ?? null).toBe(null);
      expect(form.state.isValid).toBe(true);
      expect(form.state.canSubmit).toBe(true);

      // Save now goes through (regressed: the stale form-level error blocked it).
      await submitForm(wrapper);
      expect(reports.createReportV2).toHaveBeenCalledTimes(1);
      const payload = vi.mocked(reports.createReportV2).mock.calls[0][1] as any;
      expect(payload.destinations).toEqual([]);
    });
  });

  // ── Folder loading ───────────────────────────────────────────────────────

  describe("getDashboardFolders", () => {
    it("should fetch folders on mount", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect(vi.mocked(dashboardService.list_Folders)).toHaveBeenCalledWith("test-org");
    });

    it("should populate folderOptions after fetch", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect((wrapper.vm as any).folderOptions).toHaveLength(MOCK_FOLDERS.length);
      expect((wrapper.vm as any).folderOptions[0].label).toBe("Default");
    });
  });

  // ── Dashboard loading ────────────────────────────────────────────────────

  describe("onFolderSelection", () => {
    it("should load dashboards when a folder is selected", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await (wrapper.vm as any).onFolderSelection("folder-1");
      expect(vi.mocked(dashboardService.list)).toHaveBeenCalledWith(
        0,
        10000,
        "name",
        false,
        "",
        "test-org",
        "folder-1",
        "",
      );
    });

    it("should clear dashboard and tabs selection when folder changes", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      setField(wrapper, "dashboards[0].dashboard", "dash-old");
      setField(wrapper, "dashboards[0].tabs", "tab-old");
      await (wrapper.vm as any).onFolderSelection("folder-1");
      const row = (wrapper.vm as any).form.state.values.dashboards[0];
      expect(row.dashboard).toBe("");
      expect(row.tabs).toBe("");
    });
  });

  // ── Dashboard tab options ────────────────────────────────────────────────

  describe("onDashboardSelection", () => {
    it("should clear tabs when dashboard changes", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await (wrapper.vm as any).onFolderSelection("folder-1");
      setField(wrapper, "dashboards[0].tabs", "tab-old");
      (wrapper.vm as any).onDashboardSelection("dash-1");
      expect((wrapper.vm as any).form.state.values.dashboards[0].tabs).toBe("");
    });
  });

  // ── Form-owned timerange + toggle groups (OFormDateTimeRange/OFormToggleGroup) ──

  describe("form-owned composites", () => {
    it("seeds a default timerange into the form (OFormDateTimeRange)", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      const tr = (wrapper.vm as any).form.state.values.dashboards[0].timerange;
      expect(tr).toMatchObject({ type: "relative", period: "30m" });
    });

    it("exposes frequencyType + selectedTimeTab from the form (OFormToggleGroup)", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      // Defaults.
      expect((wrapper.vm as any).frequencyType).toBe("once");
      expect((wrapper.vm as any).selectedTimeTab).toBe("scheduleNow");
      // Driven by the form field (what OFormToggleGroup writes).
      setField(wrapper, "frequencyType", "custom");
      setField(wrapper, "selectedTimeTab", "scheduleLater");
      await flushPromises();
      expect((wrapper.vm as any).frequencyType).toBe("custom");
      expect((wrapper.vm as any).selectedTimeTab).toBe("scheduleLater");
    });

    it("carries the form timerange into the save payload", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);
      setField(wrapper, "dashboards[0].timerange", {
        type: "absolute",
        from: 111,
        to: 222,
        period: "30m",
      });
      await flushPromises();

      await submitForm(wrapper);

      expect(reports.createReportV2).toHaveBeenCalledTimes(1);
      const payload = vi.mocked(reports.createReportV2).mock.calls[0][1] as any;
      expect(payload.dashboards[0].timerange).toMatchObject({
        type: "absolute",
        from: 111,
        to: 222,
      });
    });
  });

  // ── Dashboard variables ──────────────────────────────────────────────────

  // `variables` are now form-owned (VariablesInput renders in form mode,
  // name-prefix="variables"). The old component-owned add/remove handlers are
  // gone — coverage now proves the form owns the value and it reaches the
  // saved dashboards[0].variables payload in the {key,value} shape (Rule ④).
  describe("dashboard variables (form-owned)", () => {
    it("defaults variables to an empty array on the form", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      expect((wrapper.vm as any).form.state.values.variables).toEqual([]);
    });

    it("includes form-owned variables in the saved dashboards[0].variables payload", async () => {
      ({ wrapper } = mountComponent());
      await flushPromises();
      await fillValidForm(wrapper);
      setField(wrapper, "variables", [{ key: "env", value: "prod" }]);
      await submitForm(wrapper);

      expect(reports.createReportV2).toHaveBeenCalledTimes(1);
      const payload = vi.mocked(reports.createReportV2).mock.calls[0][1] as any;
      expect(payload.dashboards[0].variables).toEqual([{ key: "env", value: "prod" }]);
    });
  });
});
