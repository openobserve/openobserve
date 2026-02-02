// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import AlertWizardRightColumn from "./AlertWizardRightColumn.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock child components with proper props exposure
vi.mock("./PreviewAlert.vue", () => ({
  default: {
    name: "PreviewAlert",
    template: "<div data-test='mock-preview-alert'></div>",
    props: [
      "formData",
      "query",
      "selectedTab",
      "isAggregationEnabled",
      "isUsingBackendSql",
    ],
    methods: {
      refreshData: vi.fn(),
    },
  },
}));

vi.mock("./AlertSummary.vue", () => ({
  default: {
    name: "AlertSummary",
    template: "<div data-test='mock-alert-summary'></div>",
    props: [
      "formData",
      "destinations",
      "focusManager",
      "wizardStep",
      "previewQuery",
      "generatedSqlQuery",
    ],
  },
}));

// Mock store
const createMockStore = (overrides = {}) => ({
  state: {
    theme: "light",
    zoConfig: {
      timestamp_column: "_timestamp",
    },
    selectedOrganization: {
      identifier: "test-org",
    },
    ...overrides,
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
});

describe("AlertWizardRightColumn.vue", () => {
  let wrapper: VueWrapper<any>;
  let mockStore: any;
  let mockFormData: any;

  beforeEach(() => {
    mockStore = createMockStore();
    mockFormData = {
      name: "Test Alert",
      stream_type: "logs",
      stream_name: "test-stream",
      is_real_time: "false",
      query_condition: {
        type: "custom",
        aggregation: {
          group_by: [""],
          function: "avg",
          having: {
            column: "",
            operator: ">=",
            value: 1,
          },
        },
      },
      trigger_condition: {
        period: 10,
      },
      destinations: [],
    };

    // Clear localStorage before each test
    localStorage.clear();

    wrapper = mount(AlertWizardRightColumn, {
      global: {
        mocks: {
          $store: mockStore,
        },
        provide: {
          store: mockStore,
        },
        plugins: [i18n],
      },
      props: {
        formData: mockFormData,
        previewQuery: "SELECT * FROM test",
        generatedSqlQuery: "",
        selectedTab: "custom",
        isAggregationEnabled: false,
        destinations: [],
        focusManager: {},
        wizardStep: 1,
        isUsingBackendSql: false,
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    localStorage.clear();
  });

  describe("Initialization", () => {
    it("should mount component successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render preview section", () => {
      expect(wrapper.find('[data-test="mock-preview-alert"]').exists()).toBe(
        true
      );
    });

    it("should render summary section", () => {
      expect(wrapper.find('[data-test="mock-alert-summary"]').exists()).toBe(
        true
      );
    });

    it("should render both section headers", () => {
      const headers = wrapper.findAll(".section-header");
      expect(headers.length).toBe(2);
      expect(headers[0].text()).toContain("Preview");
      expect(headers[1].text()).toContain("Summary");
    });

    it("should have expand toggle buttons", () => {
      const toggleButtons = wrapper.findAll(".expand-toggle-btn");
      expect(toggleButtons.length).toBe(2);
    });

    it("should initialize with default expand state when no localStorage", () => {
      expect(wrapper.vm.expandState.preview).toBe(true);
      expect(wrapper.vm.expandState.summary).toBe(true);
    });

    it("should load expand state from localStorage if available", () => {
      const savedState = { preview: false, summary: true };
      localStorage.setItem(
        "alertWizardExpandState",
        JSON.stringify(savedState)
      );

      const newWrapper = mount(AlertWizardRightColumn, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          formData: mockFormData,
          previewQuery: "",
          wizardStep: 1,
        },
      });

      expect(newWrapper.vm.expandState.preview).toBe(false);
      expect(newWrapper.vm.expandState.summary).toBe(true);

      newWrapper.unmount();
    });

    it("should handle corrupted localStorage gracefully", () => {
      localStorage.setItem("alertWizardExpandState", "invalid json");

      const newWrapper = mount(AlertWizardRightColumn, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          formData: mockFormData,
          previewQuery: "",
          wizardStep: 1,
        },
      });

      // Should fall back to defaults
      expect(newWrapper.vm.expandState.preview).toBe(true);
      expect(newWrapper.vm.expandState.summary).toBe(true);

      newWrapper.unmount();
    });
  });

  describe("Props", () => {
    it("should accept all required props", () => {
      expect(wrapper.props().formData).toBeDefined();
      expect(wrapper.props().previewQuery).toBe("SELECT * FROM test");
      expect(wrapper.props().selectedTab).toBe("custom");
      expect(wrapper.props().wizardStep).toBe(1);
    });

    it("should have default values for optional props", () => {
      const minimalWrapper = mount(AlertWizardRightColumn, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          formData: mockFormData,
        },
      });

      expect(minimalWrapper.props().previewQuery).toBe("");
      expect(minimalWrapper.props().generatedSqlQuery).toBe("");
      expect(minimalWrapper.props().selectedTab).toBe("custom");
      expect(minimalWrapper.props().isAggregationEnabled).toBe(false);
      expect(minimalWrapper.props().destinations).toEqual([]);
      expect(minimalWrapper.props().wizardStep).toBe(1);
      expect(minimalWrapper.props().isUsingBackendSql).toBe(false);

      minimalWrapper.unmount();
    });

    it("should pass formData to PreviewAlert", () => {
      const previewAlert = wrapper.findComponent({ name: "PreviewAlert" });
      expect(previewAlert.props("formData")).toEqual(mockFormData);
    });

    it("should pass previewQuery to PreviewAlert", () => {
      const previewAlert = wrapper.findComponent({ name: "PreviewAlert" });
      expect(previewAlert.props("query")).toBe("SELECT * FROM test");
    });

    it("should pass isUsingBackendSql to PreviewAlert", () => {
      const previewAlert = wrapper.findComponent({ name: "PreviewAlert" });
      expect(previewAlert.props("isUsingBackendSql")).toBe(false);
    });

    it("should pass formData to AlertSummary", () => {
      const alertSummary = wrapper.findComponent({ name: "AlertSummary" });
      expect(alertSummary.props("formData")).toEqual(mockFormData);
    });

    it("should pass generatedSqlQuery to AlertSummary", () => {
      const alertSummary = wrapper.findComponent({ name: "AlertSummary" });
      expect(alertSummary.props("generatedSqlQuery")).toBe("");
    });
  });

  describe("Toggle Functions", () => {
    it("should toggle preview section on click", async () => {
      const initialState = wrapper.vm.expandState.preview;
      const previewHeader = wrapper
        .findAll(".section-header")
        .find((h) => h.text().includes("Preview"));

      await previewHeader?.trigger("click");
      await nextTick();

      expect(wrapper.vm.expandState.preview).toBe(!initialState);
    });

    it("should toggle summary section on click", async () => {
      const initialState = wrapper.vm.expandState.summary;
      const summaryHeader = wrapper
        .findAll(".section-header")
        .find((h) => h.text().includes("Summary"));

      await summaryHeader?.trigger("click");
      await nextTick();

      expect(wrapper.vm.expandState.summary).toBe(!initialState);
    });

    it("should toggle preview to collapsed", async () => {
      wrapper.vm.expandState.preview = true;
      await wrapper.vm.togglePreview();
      expect(wrapper.vm.expandState.preview).toBe(false);
    });

    it("should toggle preview to expanded", async () => {
      wrapper.vm.expandState.preview = false;
      await wrapper.vm.togglePreview();
      expect(wrapper.vm.expandState.preview).toBe(true);
    });

    it("should toggle summary to collapsed", async () => {
      wrapper.vm.expandState.summary = true;
      await wrapper.vm.toggleSummary();
      expect(wrapper.vm.expandState.summary).toBe(false);
    });

    it("should toggle summary to expanded", async () => {
      wrapper.vm.expandState.summary = false;
      await wrapper.vm.toggleSummary();
      expect(wrapper.vm.expandState.summary).toBe(true);
    });

    it("should save state to localStorage when preview toggled", async () => {
      await wrapper.vm.togglePreview();
      const saved = JSON.parse(
        localStorage.getItem("alertWizardExpandState") || "{}"
      );
      expect(saved.preview).toBe(wrapper.vm.expandState.preview);
    });

    it("should save state to localStorage when summary toggled", async () => {
      await wrapper.vm.toggleSummary();
      const saved = JSON.parse(
        localStorage.getItem("alertWizardExpandState") || "{}"
      );
      expect(saved.summary).toBe(wrapper.vm.expandState.summary);
    });

    it("should handle localStorage save errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Mock localStorage to throw error
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = vi.fn(() => {
        throw new Error("Storage full");
      });

      wrapper.vm.togglePreview();

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to save expand state:",
        expect.any(Error)
      );

      // Restore
      Storage.prototype.setItem = originalSetItem;
      consoleSpy.mockRestore();
    });
  });

  describe("Expand State Management", () => {
    it("should independently toggle each section", async () => {
      wrapper.vm.expandState.preview = true;
      wrapper.vm.expandState.summary = true;

      await wrapper.vm.togglePreview();
      expect(wrapper.vm.expandState.preview).toBe(false);
      expect(wrapper.vm.expandState.summary).toBe(true);

      await wrapper.vm.toggleSummary();
      expect(wrapper.vm.expandState.preview).toBe(false);
      expect(wrapper.vm.expandState.summary).toBe(false);
    });

    it("should allow both sections to be collapsed", async () => {
      wrapper.vm.expandState.preview = true;
      wrapper.vm.expandState.summary = true;

      await wrapper.vm.togglePreview();
      await wrapper.vm.toggleSummary();

      expect(wrapper.vm.expandState.preview).toBe(false);
      expect(wrapper.vm.expandState.summary).toBe(false);
    });

    it("should allow both sections to be expanded", async () => {
      wrapper.vm.expandState.preview = false;
      wrapper.vm.expandState.summary = false;

      await wrapper.vm.togglePreview();
      await wrapper.vm.toggleSummary();

      expect(wrapper.vm.expandState.preview).toBe(true);
      expect(wrapper.vm.expandState.summary).toBe(true);
    });

    it("should show preview content when expanded", async () => {
      wrapper.vm.expandState.preview = true;
      await nextTick();

      const previewSection = wrapper
        .findAll(".collapsible-section")
        .find((s) => s.text().includes("Preview"));
      const content = previewSection?.find(".section-content");

      expect(content?.isVisible()).toBe(true);
    });

    it("should hide preview content when collapsed", async () => {
      wrapper.vm.expandState.preview = false;
      await nextTick();

      const previewSection = wrapper
        .findAll(".collapsible-section")
        .find((s) => s.text().includes("Preview"));
      const content = previewSection?.find(".section-content");

      expect(content?.isVisible()).toBe(false);
    });

    it("should show summary content when expanded", async () => {
      wrapper.vm.expandState.summary = true;
      await nextTick();

      const summarySection = wrapper
        .findAll(".collapsible-section")
        .find((s) => s.text().includes("Summary"));
      const content = summarySection?.find(".section-content");

      expect(content?.isVisible()).toBe(true);
    });

    it("should hide summary content when collapsed", async () => {
      wrapper.vm.expandState.summary = false;
      await nextTick();

      const summarySection = wrapper
        .findAll(".collapsible-section")
        .find((s) => s.text().includes("Summary"));
      const content = summarySection?.find(".section-content");

      expect(content?.isVisible()).toBe(false);
    });
  });

  describe("Computed Styles", () => {
    it("should calculate previewSectionStyle when both expanded", () => {
      wrapper.vm.expandState.preview = true;
      wrapper.vm.expandState.summary = true;

      const style = wrapper.vm.previewSectionStyle;
      expect(style.flex).toBe("1");
      expect(style.minHeight).toBe("0");
    });

    it("should calculate previewSectionStyle when preview collapsed", () => {
      wrapper.vm.expandState.preview = false;
      wrapper.vm.expandState.summary = true;

      const style = wrapper.vm.previewSectionStyle;
      expect(style.flex).toBe("0 0 auto");
    });

    it("should calculate previewSectionStyle when preview expanded and summary collapsed", () => {
      wrapper.vm.expandState.preview = true;
      wrapper.vm.expandState.summary = false;

      const style = wrapper.vm.previewSectionStyle;
      expect(style.flex).toBe("1");
      expect(style.minHeight).toBe("0");
    });

    it("should calculate summarySectionStyle when both expanded", () => {
      wrapper.vm.expandState.preview = true;
      wrapper.vm.expandState.summary = true;

      const style = wrapper.vm.summarySectionStyle;
      expect(style.flex).toBe("1");
      expect(style.minHeight).toBe("0");
    });

    it("should calculate summarySectionStyle when summary collapsed", () => {
      wrapper.vm.expandState.preview = true;
      wrapper.vm.expandState.summary = false;

      const style = wrapper.vm.summarySectionStyle;
      expect(style.flex).toBe("0 0 auto");
    });

    it("should calculate summarySectionStyle when summary expanded and preview collapsed", () => {
      wrapper.vm.expandState.preview = false;
      wrapper.vm.expandState.summary = true;

      const style = wrapper.vm.summarySectionStyle;
      expect(style.flex).toBe("1");
      expect(style.minHeight).toBe("0");
    });

    it("should have auto flex for both when both collapsed", () => {
      wrapper.vm.expandState.preview = false;
      wrapper.vm.expandState.summary = false;

      const previewStyle = wrapper.vm.previewSectionStyle;
      const summaryStyle = wrapper.vm.summarySectionStyle;

      expect(previewStyle.flex).toBe("0 0 auto");
      expect(summaryStyle.flex).toBe("0 0 auto");
    });
  });

  describe("Manual Expand/Collapse Behavior", () => {
    it("should NOT auto-expand preview when navigating to step 2 with custom tab", async () => {
      wrapper.vm.expandState.preview = false;

      await wrapper.setProps({ wizardStep: 2, selectedTab: "custom" });
      await nextTick();

      // Preview should remain collapsed - user controls expand/collapse
      expect(wrapper.vm.expandState.preview).toBe(false);
    });

    it("should not auto-expand preview on step 2 with SQL tab", async () => {
      wrapper.vm.expandState.preview = false;

      await wrapper.setProps({ wizardStep: 2, selectedTab: "sql" });
      await nextTick();

      expect(wrapper.vm.expandState.preview).toBe(false);
    });

    it("should not auto-expand preview on step 2 with promql tab", async () => {
      wrapper.vm.expandState.preview = false;

      await wrapper.setProps({ wizardStep: 2, selectedTab: "promql" });
      await nextTick();

      expect(wrapper.vm.expandState.preview).toBe(false);
    });

    it("should not auto-expand preview when already expanded", async () => {
      wrapper.vm.expandState.preview = true;

      await wrapper.setProps({ wizardStep: 2, selectedTab: "custom" });
      await nextTick();

      // Should remain expanded
      expect(wrapper.vm.expandState.preview).toBe(true);
    });

    it("should not auto-expand preview on step 1", async () => {
      wrapper.vm.expandState.preview = false;

      await wrapper.setProps({ wizardStep: 1, selectedTab: "custom" });
      await nextTick();

      expect(wrapper.vm.expandState.preview).toBe(false);
    });

    it("should not auto-expand preview on step 3", async () => {
      wrapper.vm.expandState.preview = false;

      await wrapper.setProps({ wizardStep: 3, selectedTab: "custom" });
      await nextTick();

      expect(wrapper.vm.expandState.preview).toBe(false);
    });

    it("should NOT save to localStorage when navigating to step 2 (no auto-expand)", async () => {
      wrapper.vm.expandState.preview = false;
      // Clear localStorage first
      localStorage.removeItem("alertWizardExpandState");

      await wrapper.setProps({ wizardStep: 2, selectedTab: "custom" });
      await nextTick();

      // Since we don't auto-expand anymore, localStorage should not be updated
      const saved = localStorage.getItem("alertWizardExpandState");
      expect(saved).toBeNull();
    });

    it("should respect localStorage state on mount (no auto-expand)", async () => {
      // Set preview to collapsed in localStorage
      localStorage.setItem(
        "alertWizardExpandState",
        JSON.stringify({ preview: false, summary: true })
      );

      // Create a new wrapper with preview collapsed and on step 2 with custom tab
      const newWrapper = mount(AlertWizardRightColumn, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          formData: mockFormData,
          previewQuery: "",
          wizardStep: 2,
          selectedTab: "custom",
        },
      });

      await nextTick();
      await flushPromises();

      // Should remain collapsed as per localStorage (no auto-expand)
      expect(newWrapper.vm.expandState.preview).toBe(false);

      newWrapper.unmount();
    });
  });

  describe("Exposed Methods", () => {
    it("should expose refreshData method", () => {
      expect(wrapper.vm.refreshData).toBeDefined();
      expect(typeof wrapper.vm.refreshData).toBe("function");
    });

    it("should call previewAlertRef refreshData when exposed method is called", () => {
      const mockRefreshData = vi.fn();
      wrapper.vm.previewAlertRef = {
        refreshData: mockRefreshData,
      };

      wrapper.vm.refreshData();

      expect(mockRefreshData).toHaveBeenCalled();
    });

    it("should handle null previewAlertRef gracefully", () => {
      wrapper.vm.previewAlertRef = null;

      expect(() => wrapper.vm.refreshData()).not.toThrow();
    });

    it("should handle undefined previewAlertRef gracefully", () => {
      wrapper.vm.previewAlertRef = undefined;

      expect(() => wrapper.vm.refreshData()).not.toThrow();
    });
  });

  describe("Visual Indicators", () => {
    it("should show expand_more icon when section is collapsed", async () => {
      wrapper.vm.expandState.preview = false;
      await nextTick();

      const previewSection = wrapper
        .findAll(".collapsible-section")
        .find((s) => s.text().includes("Preview"));
      const toggleBtn = previewSection?.find(".expand-toggle-btn");

      // Check the actual rendered icon attribute or HTML
      expect(toggleBtn?.html()).toContain("expand_more");
    });

    it("should show expand_less icon when section is expanded", async () => {
      wrapper.vm.expandState.preview = true;
      await nextTick();

      const previewSection = wrapper
        .findAll(".collapsible-section")
        .find((s) => s.text().includes("Preview"));
      const toggleBtn = previewSection?.find(".expand-toggle-btn");

      // Check the actual rendered icon attribute or HTML
      expect(toggleBtn?.html()).toContain("expand_less");
    });

    it("should update icon when toggling preview", async () => {
      wrapper.vm.expandState.preview = true;
      await nextTick();

      let previewSection = wrapper
        .findAll(".collapsible-section")
        .find((s) => s.text().includes("Preview"));
      let toggleBtn = previewSection?.find(".expand-toggle-btn");
      expect(toggleBtn?.html()).toContain("expand_less");

      await wrapper.vm.togglePreview();
      await nextTick();

      previewSection = wrapper
        .findAll(".collapsible-section")
        .find((s) => s.text().includes("Preview"));
      toggleBtn = previewSection?.find(".expand-toggle-btn");
      expect(toggleBtn?.html()).toContain("expand_more");
    });

    it("should update icon when toggling summary", async () => {
      wrapper.vm.expandState.summary = true;
      await nextTick();

      let summarySection = wrapper
        .findAll(".collapsible-section")
        .find((s) => s.text().includes("Summary"));
      let toggleBtn = summarySection?.find(".expand-toggle-btn");
      expect(toggleBtn?.html()).toContain("expand_less");

      await wrapper.vm.toggleSummary();
      await nextTick();

      summarySection = wrapper
        .findAll(".collapsible-section")
        .find((s) => s.text().includes("Summary"));
      toggleBtn = summarySection?.find(".expand-toggle-btn");
      expect(toggleBtn?.html()).toContain("expand_more");
    });
  });

  describe("Edge Cases", () => {
    it("should handle rapid toggling", async () => {
      const initialState = wrapper.vm.expandState.preview;

      await wrapper.vm.togglePreview();
      await wrapper.vm.togglePreview();
      await wrapper.vm.togglePreview();

      expect(wrapper.vm.expandState.preview).toBe(!initialState);
    });

    it("should maintain state across prop updates", async () => {
      wrapper.vm.expandState.preview = false;
      wrapper.vm.expandState.summary = false;

      await wrapper.setProps({ previewQuery: "NEW QUERY" });
      await nextTick();

      expect(wrapper.vm.expandState.preview).toBe(false);
      expect(wrapper.vm.expandState.summary).toBe(false);
    });

    it("should handle formData changes without affecting expand state", async () => {
      wrapper.vm.expandState.preview = false;

      await wrapper.setProps({
        formData: {
          ...mockFormData,
          name: "Updated Alert",
        },
      });
      await nextTick();

      expect(wrapper.vm.expandState.preview).toBe(false);
    });

    it("should handle wizardStep changes to non-query steps", async () => {
      wrapper.vm.expandState.preview = false;

      await wrapper.setProps({ wizardStep: 4 });
      await nextTick();

      expect(wrapper.vm.expandState.preview).toBe(false);
    });

    it("should handle undefined wizardStep", async () => {
      await wrapper.setProps({ wizardStep: undefined });
      await nextTick();

      expect(() => wrapper.vm.expandState).not.toThrow();
    });

    it("should handle undefined selectedTab", async () => {
      await wrapper.setProps({ selectedTab: undefined });
      await nextTick();

      expect(() => wrapper.vm.expandState).not.toThrow();
    });
  });

  describe("LocalStorage Persistence", () => {
    it("should persist expanded state", async () => {
      wrapper.vm.expandState.preview = true;
      wrapper.vm.expandState.summary = true;

      // Trigger save by toggling
      await wrapper.vm.togglePreview();
      await wrapper.vm.togglePreview(); // Toggle back

      const saved = JSON.parse(
        localStorage.getItem("alertWizardExpandState") || "{}"
      );
      expect(saved.preview).toBe(true);
      expect(saved.summary).toBe(true);
    });

    it("should persist collapsed state", async () => {
      wrapper.vm.expandState.preview = false;
      wrapper.vm.expandState.summary = false;

      // Trigger save by toggling
      await wrapper.vm.togglePreview();
      await wrapper.vm.togglePreview(); // Toggle back

      const saved = JSON.parse(
        localStorage.getItem("alertWizardExpandState") || "{}"
      );
      expect(saved.preview).toBe(false);
      expect(saved.summary).toBe(false);
    });

    it("should persist mixed state", async () => {
      wrapper.vm.expandState.preview = true;
      wrapper.vm.expandState.summary = false;

      // Trigger save by toggling
      await wrapper.vm.togglePreview();
      await wrapper.vm.togglePreview(); // Toggle back

      const saved = JSON.parse(
        localStorage.getItem("alertWizardExpandState") || "{}"
      );
      expect(saved.preview).toBe(true);
      expect(saved.summary).toBe(false);
    });

    it("should restore state on component remount", async () => {
      wrapper.vm.expandState.preview = false;
      wrapper.vm.expandState.summary = true;

      // Save by toggling
      await wrapper.vm.togglePreview();
      await wrapper.vm.togglePreview(); // Back to false

      wrapper.unmount();

      const newWrapper = mount(AlertWizardRightColumn, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          formData: mockFormData,
          previewQuery: "",
          wizardStep: 1,
        },
      });

      expect(newWrapper.vm.expandState.preview).toBe(false);
      expect(newWrapper.vm.expandState.summary).toBe(true);

      newWrapper.unmount();
    });
  });
});
