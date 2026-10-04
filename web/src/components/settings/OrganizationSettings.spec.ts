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
    },
  });
});

import config from "@/aws-exports";
import organizations from "@/services/organizations";
const mockPostOrganizationSettings = organizations.post_organization_settings as any;

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
        OButton: {
          template: `<button
            data-test-stub='o-btn'
            :data-test='$attrs["data-test"]'
            @click='$emit("click", $event)'
          ><slot></slot></button>`,
          props: ["variant", "size", "type", "loading"],
          emits: ["click"],
        },
        OSeparator: { template: '<hr data-test-stub="o-separator" />' },
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

    it("should display the settings title", () => {
      const wrapper = createWrapper();
      const title = wrapper.get("div.text-base.font-bold");
      expect(title.text()).toContain("Log Details");
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

    it("should render the save button and keep it enabled (R3)", () => {
      const wrapper = createWrapper();
      const saveBtn = wrapper.find('[data-test="add-alert-submit-btn"]');
      expect(saveBtn.exists()).toBe(true);
      expect(saveBtn.attributes("disabled")).toBeFalsy();
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
    it("keeps the help text in a hover tooltip on the info icon, under a Traces heading", () => {
      config.isEnterprise = "true";
      config.isCloud = "false";
      const wrapper = createWrapper();
      const section = wrapper.find('[data-test="settings-red-insights"]');
      const help = String(i18n.global.t("settings.redInsightsEnabledHelp"));

      expect(section.find('[data-test="settings-red-insights-btn-info"]').exists()).toBe(true);
      expect(section.text()).not.toContain(help);
      expect(section.findComponent({ name: "OTooltip" }).props("content")).toBe(help);
      expect(section.find('[data-test="settings-traces-heading"]').text()).toBe(
        String(i18n.global.t("settings.tracesHeading")),
      );
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

  describe("Layout and styling", () => {
    it("should keep the trace/span field width wrappers", () => {
      const wrapper = createWrapper();
      const traceDiv = wrapper.find(".trace-id-field-name");
      const spanDiv = wrapper.find(".span-id-field-name");
      expect(traceDiv.exists()).toBe(true);
      expect(traceDiv.classes()).toContain("o2-input");
      expect(spanDiv.exists()).toBe(true);
      expect(spanDiv.classes()).toContain("o2-input");
    });
  });
});
