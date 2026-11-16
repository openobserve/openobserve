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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import OrganizationSettings from "./OrganizationSettings.vue";
import i18n from "@/locales";
import { nextTick, reactive } from "vue";
import store from "@/test/unit/helpers/store";

// Mock toast from @/lib/feedback/Toast/useToast
const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
import analytics from "@/services/product_analytics";

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "false" },
}));

// Mock organizations service
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      post_organization_settings: vi.fn(),
      get_organization_settings: vi.fn(),
    },
  });
});

import config from "@/aws-exports";
import organizations from "@/services/organizations";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { confirmLeave } from "@/lib/forms/SaveBar/useLeaveGuard";
const mockPostOrganizationSettings = organizations.post_organization_settings as any;
const mockGetOrganizationSettings = organizations.get_organization_settings as any;

// Mock useStore to return our test store
vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Use reactive() so watchers in the component can observe state changes
const mockStore = reactive({
  ...store,
  dispatch: vi.fn(),
  state: {
    ...store.state,
    selectedOrganization: {
      identifier: "test-org-123",
      label: "Test Organization",
      id: 123,
    },
    organizationData: {
      ...store.state.organizationData,
      organizationSettings: {
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
        toggle_ingestion_logs: false,
      },
    },
  },
}) as any;

const createWrapper = (props = {}, options = {}) => {
  return mount(OrganizationSettings, {
    props: { ...props },
    global: {
      plugins: [i18n],
      provide: { store: mockStore },
      // NOTE: OForm / OFormInput / OFormSwitch are intentionally NOT stubbed so
      // the real schema validation runs (per the migration playbook: at least
      // one path must mount the real <OForm>).
      stubs: {
        teleport: true,
        OButton: {
          template: `<button
            data-test-stub='o-btn'
            :data-test='$attrs["data-test"]'
            :type='type || "button"'
            @click='$emit("click", $event)'
          ><slot></slot></button>`,
          props: ["variant", "size", "type", "loading"],
          emits: ["click"],
        },
        OSeparator: { template: '<hr data-test-stub="o-separator" />' },
        ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
        ODropdownItem: {
          template: `<button type="button" @click="$emit('select', $event)"><slot /></button>`,
          emits: ["select"],
        },
        CrossLinkManager: {
          template: '<div data-test="cross-link-manager">CrossLinkManager</div>',
          props: ["modelValue", "title", "subtitle"],
          emits: ["update:modelValue", "change"],
        },
      },
    },
    attachTo: document.body,
    ...options,
  });
};

const getForm = (wrapper: any) => wrapper.findComponent({ name: "OForm" });

describe("OrganizationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.state.selectedOrganization = {
      identifier: "test-org-123",
      label: "Test Organization",
      id: 123,
    };
    mockStore.state.organizationData.organizationSettings = {
      trace_id_field_name: "trace_id",
      span_id_field_name: "span_id",
      toggle_ingestion_logs: false,
    };
    mockPostOrganizationSettings.mockResolvedValue({ status: 200 });
    mockGetOrganizationSettings.mockResolvedValue({ data: { data: {} } });
    mockStore.dispatch.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component mounting and rendering", () => {
    it("should mount successfully", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render trace and span ID field inputs (data-tests preserved)", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="settings-org-trace-id-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="settings-org-span-id-input"]').exists()).toBe(true);
    });

    it("should render the ingestion + usage stream toggles (data-tests preserved)", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="add-toggle-ingestion"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-toggle-ingestion-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-toggle-usage-stream"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-toggle-usage-stream-btn"]').exists()).toBe(true);
    });

    it("shows no saved value and a loading bar until the settings exist", async () => {
      mockStore.state.organizationData.organizationSettings = undefined;
      const wrapper = createWrapper();
      // Looked up per read: the teleport stub re-creates its content when the page re-renders.
      const bar = () => wrapper.get('[data-test="organization-settings-save-bar"]');

      expect(wrapper.find('[data-test="settings-org-trace-id-input-field"]').exists()).toBe(false);
      expect(bar().attributes("data-state")).toBe("loading");

      mockStore.state.organizationData.organizationSettings = {
        trace_id_field_name: "tid",
        span_id_field_name: "sid",
      };
      await flushPromises();

      const input = wrapper.get('[data-test="settings-org-trace-id-input-field"]');
      expect((input.element as HTMLInputElement).value).toBe("tid");
      expect(bar().attributes("data-state")).toBe("clean");
    });

    it("counts a field edit and a cross-link edit, and Discard restores both", async () => {
      mockStore.state.zoConfig.enable_cross_linking = true;
      const wrapper = createWrapper();
      // Looked up per read: the teleport stub re-creates its content when the page re-renders.
      const bar = () => wrapper.get('[data-test="organization-settings-save-bar"]');
      const input = wrapper.get('[data-test="settings-org-trace-id-input-field"]');

      await input.setValue("other_trace");
      wrapper.vm.crossLinks = [{ name: "a" }];
      await flushPromises();
      expect(bar().attributes("data-state")).toBe("changed");
      expect(wrapper.findComponent({ name: "OSaveBar" }).props("changeCount")).toBe(2);

      await wrapper.get('[data-test="organization-settings-save-bar-discard"]').trigger("click");
      await flushPromises();

      expect((input.element as HTMLInputElement).value).toBe("trace_id");
      expect(wrapper.vm.crossLinks).toEqual([]);
      expect(bar().attributes("data-state")).toBe("clean");
      mockStore.state.zoConfig.enable_cross_linking = undefined;
    });

    it("saves from the bar and returns to clean on the saved values", async () => {
      const wrapper = createWrapper();
      // Looked up per read: the teleport stub re-creates its content when the page re-renders.
      const bar = () => wrapper.get('[data-test="organization-settings-save-bar"]');

      await wrapper.get('[data-test="settings-org-trace-id-input-field"]').setValue("other_trace");
      await wrapper.get('[data-test="add-alert-submit-btn"]').trigger("click");
      await vi.waitFor(() => expect(mockPostOrganizationSettings).toHaveBeenCalled());
      await flushPromises();

      expect(mockPostOrganizationSettings.mock.calls[0][1].trace_id_field_name).toBe("other_trace");
      expect(bar().attributes("data-state")).toBe("clean");
    });

    it("a save that completes late keeps later edits and never writes into another organization", async () => {
      let finish = () => {};
      const holdSave = () =>
        mockPostOrganizationSettings.mockImplementationOnce(
          () => new Promise((resolve) => (finish = () => resolve({ status: 200 }))),
        );
      const wrapper = createWrapper();
      const input = wrapper.get('[data-test="settings-org-trace-id-input-field"]');
      const save = () => wrapper.get('[data-test="add-alert-submit-btn"]').trigger("click");

      holdSave();
      await input.setValue("first_trace");
      await save();
      await vi.waitFor(() => expect(mockPostOrganizationSettings).toHaveBeenCalled());
      await input.setValue("later_trace");
      wrapper.vm.crossLinks = [{ name: "later" }];
      finish();
      await flushPromises();

      expect(mockStore.dispatch.mock.calls[0][1]).toMatchObject({
        trace_id_field_name: "first_trace",
        cross_links: [],
      });
      expect((input.element as HTMLInputElement).value).toBe("later_trace");
      expect(wrapper.findComponent({ name: "OSaveBar" }).props("changeCount")).toBe(2);

      holdSave();
      await save();
      await vi.waitFor(() => expect(mockPostOrganizationSettings).toHaveBeenCalledTimes(2));
      mockStore.state.selectedOrganization = { identifier: "other-org" };
      finish();
      await flushPromises();

      expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
    });

    it("a Discard confirmed on leaving while the save is open stays discarded when the save lands", async () => {
      let finish = () => {};
      mockPostOrganizationSettings.mockImplementationOnce(
        () => new Promise((resolve) => (finish = () => resolve({ status: 200 }))),
      );
      const wrapper = createWrapper();
      const input = wrapper.get('[data-test="settings-org-trace-id-input-field"]');
      const dialog = useConfirmDialog();

      await input.setValue("new_trace");
      await wrapper.get('[data-test="add-alert-submit-btn"]').trigger("click");
      await vi.waitFor(() => expect(mockPostOrganizationSettings).toHaveBeenCalled());
      let left = false;
      void confirmLeave().then((leave) => (left = leave));
      // Pages left mounted by earlier cases are asked too, one dialog each.
      await vi.waitFor(() => {
        dialog.handleConfirm();
        expect(left).toBe(true);
      });
      finish();
      await flushPromises();

      expect((input.element as HTMLInputElement).value).toBe("new_trace");
      expect(wrapper.findComponent({ name: "OSaveBar" }).props("changeCount")).toBe(0);
    });

    it("should seed the form defaults from the store", () => {
      const wrapper = createWrapper();
      const form = getForm(wrapper);
      expect(form.vm.form.state.values).toMatchObject({
        traceIdFieldName: "trace_id",
        spanIdFieldName: "span_id",
        toggleIngestionLogs: false,
        usageStreamEnabled: false,
      });
    });
  });

  describe("Schema validation (real OForm)", () => {
    it("blocks submit and does NOT call the service when field names are empty", async () => {
      mockStore.state.organizationData.organizationSettings = {
        trace_id_field_name: "",
        span_id_field_name: "",
      };
      const wrapper = createWrapper();
      const form = getForm(wrapper);

      await form.vm.form.handleSubmit();
      await flushPromises();

      expect(form.vm.form.state.isValid).toBe(false);
      expect(mockPostOrganizationSettings).not.toHaveBeenCalled();
    });

    it("blocks submit when a field name has invalid characters (restored regex rule)", async () => {
      mockStore.state.organizationData.organizationSettings = {
        trace_id_field_name: "invalid trace",
        span_id_field_name: "valid_span",
      };
      const wrapper = createWrapper();
      const form = getForm(wrapper);

      await form.vm.form.handleSubmit();
      await flushPromises();

      expect(form.vm.form.state.isValid).toBe(false);
      expect(mockPostOrganizationSettings).not.toHaveBeenCalled();
    });

    it("blocks submit when a field name has trailing whitespace (regression: no schema .trim to mask it)", async () => {
      // Before the fix, .trim() validated a trimmed copy so "trace_id " passed
      // and was saved raw with the space. The regex must now reject it directly.
      mockStore.state.organizationData.organizationSettings = {
        trace_id_field_name: "trace_id ",
        span_id_field_name: "span_id",
      };
      const wrapper = createWrapper();
      const form = getForm(wrapper);

      await form.vm.form.handleSubmit();
      await flushPromises();

      expect(form.vm.form.state.isValid).toBe(false);
      expect(mockPostOrganizationSettings).not.toHaveBeenCalled();
    });

    it("submits when both field names are valid", async () => {
      const wrapper = createWrapper();
      const form = getForm(wrapper);

      await form.vm.form.handleSubmit();
      await flushPromises();

      expect(mockPostOrganizationSettings).toHaveBeenCalledWith("test-org-123", {
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
        toggle_ingestion_logs: false,
        cross_links: [],
        usage_stream_enabled: false,
      });
    });

    it("submits the toggled switch values", async () => {
      const wrapper = createWrapper();
      const form = getForm(wrapper);
      form.vm.form.setFieldValue("toggleIngestionLogs", true);
      form.vm.form.setFieldValue("usageStreamEnabled", true);

      await form.vm.form.handleSubmit();
      await flushPromises();

      expect(mockPostOrganizationSettings).toHaveBeenCalledWith(
        "test-org-123",
        expect.objectContaining({
          toggle_ingestion_logs: true,
          usage_stream_enabled: true,
        }),
      );
    });
  });

  describe("saveOrgSettings handler", () => {
    const validValue = {
      traceIdFieldName: "custom_trace_id",
      spanIdFieldName: "custom_span_id",
      toggleIngestionLogs: true,
      usageStreamEnabled: false,
    };

    it("should call post_organization_settings with the correct payload", async () => {
      const wrapper = createWrapper();
      await wrapper.vm.saveOrgSettings(validValue);

      expect(mockPostOrganizationSettings).toHaveBeenCalledWith("test-org-123", {
        trace_id_field_name: "custom_trace_id",
        span_id_field_name: "custom_span_id",
        toggle_ingestion_logs: true,
        cross_links: [],
        usage_stream_enabled: false,
      });
    });

    it("should dispatch setOrganizationSettings after a successful save", async () => {
      const wrapper = createWrapper();
      await wrapper.vm.saveOrgSettings(validValue);

      expect(mockStore.dispatch).toHaveBeenCalledWith("setOrganizationSettings", {
        ...mockStore.state.organizationData.organizationSettings,
        trace_id_field_name: "custom_trace_id",
        span_id_field_name: "custom_span_id",
        toggle_ingestion_logs: true,
        cross_links: [],
        usage_stream_enabled: false,
      });
    });

    it("should show a success notification", async () => {
      const wrapper = createWrapper();
      await wrapper.vm.saveOrgSettings(validValue);

      expect(mockToast).toHaveBeenCalledWith({
        message: "Organization settings updated successfully",
        variant: "success",
      });
    });

    it("should handle an API error with a message", async () => {
      const wrapper = createWrapper();
      mockPostOrganizationSettings.mockRejectedValue({ message: "Invalid field names" });

      await wrapper.vm.saveOrgSettings(validValue);

      expect(mockToast).toHaveBeenCalledWith({
        message: "Invalid field names",
        variant: "error",
      });
    });

    it("should prefer the server's response message over the HTTP status text", async () => {
      const wrapper = createWrapper();
      mockPostOrganizationSettings.mockRejectedValue({
        message: "Request failed with status code 400",
        response: { data: { message: "No org with org id abc found" } },
      });

      await wrapper.vm.saveOrgSettings(validValue);

      expect(mockToast).toHaveBeenCalledWith({
        message: "No org with org id abc found",
        variant: "error",
      });
    });

    it("should fall back to a default message when the API error has none", async () => {
      const wrapper = createWrapper();
      mockPostOrganizationSettings.mockRejectedValue({});

      await wrapper.vm.saveOrgSettings(validValue);

      expect(mockToast).toHaveBeenCalledWith({
        message: "Error saving organization settings",
        variant: "error",
      });
    });

    it("should not dispatch setOrganizationSettings on error", async () => {
      const wrapper = createWrapper();
      mockPostOrganizationSettings.mockRejectedValue({ message: "Error" });

      await wrapper.vm.saveOrgSettings(validValue);

      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("RED insights setting", () => {
    afterEach(() => {
      config.isEnterprise = "false";
      config.isCloud = "false";
    });

    it("hides the switch outside enterprise and does not post the field", async () => {
      config.isEnterprise = "false";
      config.isCloud = "false";
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="settings-red-insights"]').exists()).toBe(false);

      await getForm(wrapper).vm.form.handleSubmit();
      await flushPromises();

      expect(mockPostOrganizationSettings.mock.calls[0][1]).not.toHaveProperty(
        "red_insights_enabled",
      );
    });

    it("shows the switch in enterprise, seeded from the store, and posts the field", async () => {
      config.isEnterprise = "true";
      config.isCloud = "false";
      mockStore.state.organizationData.organizationSettings = {
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
        red_insights_enabled: true,
      };
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="settings-red-insights-btn"]').exists()).toBe(true);
      const form = getForm(wrapper);
      expect(form.vm.form.state.values.redInsightsEnabled).toBe(true);

      form.vm.form.setFieldValue("redInsightsEnabled", false);
      await form.vm.form.handleSubmit();
      await flushPromises();

      expect(mockPostOrganizationSettings).toHaveBeenCalledWith(
        "test-org-123",
        expect.objectContaining({ red_insights_enabled: false }),
      );
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        "setOrganizationSettings",
        expect.objectContaining({ red_insights_enabled: false }),
      );
    });
    it("prefills the switch off when the server value is false", () => {
      config.isEnterprise = "true";
      mockStore.state.organizationData.organizationSettings = {
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
        red_insights_enabled: false,
      };
      const wrapper = createWrapper();
      expect(getForm(wrapper).vm.form.state.values.redInsightsEnabled).toBe(false);
    });

    it("prefills the switch off when the settings carry no value", () => {
      config.isEnterprise = "true";
      mockStore.state.organizationData.organizationSettings = {
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
      };
      const wrapper = createWrapper();
      expect(getForm(wrapper).vm.form.state.values.redInsightsEnabled).toBe(false);
    });
  });

  describe("RCA thread tool output setting (02 TH34)", () => {
    afterEach(() => {
      config.isEnterprise = "false";
      config.isCloud = "false";
    });

    it("hides the switch outside enterprise and does not post the field", async () => {
      config.isEnterprise = "false";
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="settings-ai-rca-thread-tool-output"]').exists()).toBe(false);

      await getForm(wrapper).vm.form.handleSubmit();
      await flushPromises();

      expect(mockPostOrganizationSettings.mock.calls[0][1]).not.toHaveProperty(
        "ai_rca_thread_tool_output",
      );
    });

    it("seeds the switch from the store (default off) and posts the field", async () => {
      config.isEnterprise = "true";
      const wrapper = createWrapper();
      const form = getForm(wrapper);
      expect(form.vm.form.state.values.aiRcaThreadToolOutput).toBe(false);

      form.vm.form.setFieldValue("aiRcaThreadToolOutput", true);
      await form.vm.form.handleSubmit();
      await flushPromises();

      expect(mockPostOrganizationSettings).toHaveBeenCalledWith(
        "test-org-123",
        expect.objectContaining({ ai_rca_thread_tool_output: true }),
      );
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        "setOrganizationSettings",
        expect.objectContaining({ ai_rca_thread_tool_output: true }),
      );
    });

    it("prefills the switch on when the server value is true", () => {
      config.isEnterprise = "true";
      mockStore.state.organizationData.organizationSettings = {
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
        ai_rca_thread_tool_output: true,
      };
      const wrapper = createWrapper();
      expect(getForm(wrapper).vm.form.state.values.aiRcaThreadToolOutput).toBe(true);
    });
  });

  describe("Data retention defaults", () => {
    const bar = (wrapper: any) => wrapper.findComponent({ name: "OSaveBar" });
    const field = (wrapper: any, name: string) =>
      wrapper.get(`[data-test="settings-data-retention-${name}-field"]`);

    beforeEach(() => {
      config.isEnterprise = "true";
      mockStore.state.organizationData.organizationSettings = {
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
        data_retention: { default: 30, logs: 14 },
      };
    });

    afterEach(() => {
      config.isEnterprise = "false";
    });

    it("is part of the page form: checked on leave, counted by the bar, restored by Discard", async () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="settings-data-retention-save"]').exists()).toBe(false);
      expect(bar(wrapper).props("changeCount")).toBe(0);

      await field(wrapper, "default").setValue("1");
      await field(wrapper, "default").trigger("blur");
      await flushPromises();
      expect(wrapper.find('[data-test="settings-data-retention-default-error"]').exists()).toBe(
        true,
      );
      expect(bar(wrapper).props("changeCount")).toBe(1);

      await wrapper.get('[data-test="settings-data-retention-remove-0"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="settings-data-retention-row-0"]').exists()).toBe(false);
      expect(bar(wrapper).props("changeCount")).toBe(2);

      await wrapper.get('[data-test="organization-settings-save-bar-discard"]').trigger("click");
      await flushPromises();
      expect((field(wrapper, "default").element as HTMLInputElement).value).toBe("30");
      expect((field(wrapper, "days-0").element as HTMLInputElement).value).toBe("14");
      expect(bar(wrapper).props("changeCount")).toBe(0);
    });

    it("offers only the unused stream types, counts an added one as one change, and blocks the save until it has days", async () => {
      const wrapper = createWrapper();
      const offered = () =>
        wrapper
          .findAll('[data-test^="settings-data-retention-add-"]')
          .map((item) => item.attributes("data-test")?.split("-").pop());
      expect(offered()).toEqual(["metrics", "traces", "profiles"]);

      await wrapper.get('[data-test="settings-data-retention-add-traces"]').trigger("click");
      await flushPromises();
      expect(offered()).toEqual(["metrics", "profiles"]);
      expect(getForm(wrapper).vm.form.state.values.types[1].type).toBe("traces");
      expect(bar(wrapper).props("changeCount")).toBe(1);
      await field(wrapper, "days-1").setValue("90");
      expect(bar(wrapper).props("changeCount")).toBe(1);
      await field(wrapper, "days-1").setValue("");

      await getForm(wrapper).vm.form.handleSubmit();
      await flushPromises();
      expect(mockPostOrganizationSettings).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="settings-data-retention-days-1-error"]').exists()).toBe(
        true,
      );
    });

    it("saves with the other settings in one request and stores what the server resolved", async () => {
      const resolved = { default: 45, logs: 7, metrics: 45, traces: 45, profiles: 45 };
      mockGetOrganizationSettings.mockResolvedValue({
        data: {
          data: { data_retention: { default: 45, logs: 7 } },
          resolved_data_retention: resolved,
        },
      });
      const wrapper = createWrapper();

      await field(wrapper, "default").setValue("45");
      await field(wrapper, "days-0").setValue("7");
      await wrapper.get('[data-test="add-alert-submit-btn"]').trigger("click");
      await vi.waitFor(() => expect(mockStore.dispatch).toHaveBeenCalled());
      await flushPromises();

      expect(mockPostOrganizationSettings).toHaveBeenCalledTimes(1);
      expect(mockPostOrganizationSettings.mock.calls[0][1]).toMatchObject({
        trace_id_field_name: "trace_id",
        data_retention: { default: 45, logs: 7 },
      });
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        "setOrganizationSettings",
        expect.objectContaining({
          data_retention: { default: 45, logs: 7 },
          resolved_data_retention: resolved,
        }),
      );
      expect(bar(wrapper).props("changeCount")).toBe(0);
    });

    it("leaves retention out of a save that did not edit it, so an unread value cannot wipe the stored one", async () => {
      for (const stored of [{ default: 30, logs: 14 }, undefined]) {
        mockPostOrganizationSettings.mockClear();
        mockStore.state.organizationData.organizationSettings = {
          trace_id_field_name: "trace_id",
          span_id_field_name: "span_id",
          data_retention: stored,
        };
        const wrapper = createWrapper();
        await wrapper.get('[data-test="settings-org-trace-id-input-field"]').setValue("traceid");
        await getForm(wrapper).vm.form.handleSubmit();
        await flushPromises();
        expect(mockPostOrganizationSettings).toHaveBeenCalledTimes(1);
        expect(mockPostOrganizationSettings.mock.calls[0][1]).not.toHaveProperty("data_retention");
        wrapper.unmount();
      }
    });

    it("leaves the block and its payload out outside enterprise", async () => {
      config.isEnterprise = "false";
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="settings-data-retention-defaults"]').exists()).toBe(false);

      await getForm(wrapper).vm.form.handleSubmit();
      await flushPromises();
      expect(mockPostOrganizationSettings.mock.calls[0][1]).not.toHaveProperty("data_retention");
    });
  });

  describe("Usage stream settings", () => {
    it("should seed usageStreamEnabled from the store", () => {
      mockStore.state.organizationData.organizationSettings.usage_stream_enabled = true;
      const wrapper = createWrapper();
      const form = getForm(wrapper);
      expect(form.vm.form.state.values.usageStreamEnabled).toBe(true);
    });
  });

  describe("Cross-linking", () => {
    beforeEach(() => {
      mockStore.state.zoConfig.enable_cross_linking = true;
    });

    afterEach(() => {
      mockStore.state.zoConfig.enable_cross_linking = undefined;
    });

    it("should render CrossLinkManager when cross-linking is enabled", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="cross-link-manager"]').exists()).toBe(true);
    });

    it("should update crossLinks when the store watch triggers", async () => {
      const wrapper = createWrapper();

      mockStore.state.organizationData.organizationSettings = {
        ...mockStore.state.organizationData.organizationSettings,
        cross_links: [{ sourceField: "trace_id", targetOrg: "other-org" }],
      };
      await nextTick();

      expect(wrapper.vm.crossLinks).toEqual([{ sourceField: "trace_id", targetOrg: "other-org" }]);
    });

    it("should include crossLinks in the submit payload", async () => {
      mockStore.state.organizationData.organizationSettings = {
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
        toggle_ingestion_logs: false,
        cross_links: [{ sourceField: "trace_id", targetOrg: "other-org" }],
      };
      const wrapper = createWrapper();
      const form = getForm(wrapper);

      await form.vm.form.handleSubmit();
      await flushPromises();

      expect(mockPostOrganizationSettings).toHaveBeenCalledWith(
        "test-org-123",
        expect.objectContaining({
          cross_links: [{ sourceField: "trace_id", targetOrg: "other-org" }],
        }),
      );
    });

    describe("cross_link_saved", () => {
      const value = {
        traceIdFieldName: "trace_id",
        spanIdFieldName: "span_id",
        toggleIngestionLogs: false,
        usageStreamEnabled: false,
      };
      const link = { sourceField: "trace_id", targetOrg: "other-org" };

      it("tracks once a save with changed cross-links succeeds", async () => {
        const wrapper = createWrapper();
        wrapper.vm.crossLinks = [link];

        await wrapper.vm.saveOrgSettings(value);

        expect(analytics.track).toHaveBeenCalledWith("cross_link_saved", { scope: "org" });
      });

      it("does not track when the cross-links are unchanged", async () => {
        mockStore.state.organizationData.organizationSettings = {
          ...mockStore.state.organizationData.organizationSettings,
          cross_links: [link],
        };
        const wrapper = createWrapper();

        await wrapper.vm.saveOrgSettings(value);

        expect(mockPostOrganizationSettings).toHaveBeenCalled();
        expect(analytics.track).not.toHaveBeenCalled();
      });

      it("does not track when the save fails", async () => {
        mockPostOrganizationSettings.mockRejectedValue({ message: "Error" });
        const wrapper = createWrapper();
        wrapper.vm.crossLinks = [link];

        await wrapper.vm.saveOrgSettings(value);

        expect(analytics.track).not.toHaveBeenCalled();
      });
    });
  });
});
