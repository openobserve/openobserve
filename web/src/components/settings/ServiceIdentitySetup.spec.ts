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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock("@/services/service_streams", () => ({
  default: {
    getDimensionAnalytics: vi.fn().mockResolvedValue({
      data: {
        org_id: "test-org",
        total_dimensions: 0,
        by_cardinality: {},
        recommended_priority_dimensions: [],
        dimensions: [],
        available_groups: [],
        service_field_sources: [],
        generated_at: 0,
      },
    }),
    getIdentityConfig: vi.fn().mockResolvedValue({
      data: {
        sets: [],
        tracked_alias_ids: [],
      },
    }),
    saveIdentityConfig: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock("@/utils/serviceStreamEnvs", () => ({
  ENV_SEGMENTS: {},
  groupEnvKey: vi.fn().mockReturnValue("all"),
}));

vi.mock("@/components/dashboards/panels/CustomChartRenderer.vue", () => ({
  default: {
    name: "CustomChartRenderer",
    template: '<div data-test="custom-chart-renderer" />',
    props: ["data"],
  },
}));

vi.mock("@/components/alerts/TagInput.vue", () => ({
  default: {
    name: "TagInput",
    template:
      '<div data-test="tag-input" :data-model-value="JSON.stringify(modelValue)" />',
    props: ["modelValue", "placeholder", "label"],
    emits: ["update:modelValue"],
  },
}));

import ServiceIdentitySetup from "./ServiceIdentitySetup.vue";
import serviceStreamsService from "@/services/service_streams";

// ─── Test setup ──────────────────────────────────────────────────────────────

installQuasar();

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      settings: {
        correlation: {
          serviceNameNotDetected: "Service name not detected",
          serviceNameExpandedHelp: "Configure service name fields",
          serviceNameConfiguredNotSeen: "Configured but not seen",
          distinguishByLabel: "Distinguish By",
          distinguishByHelp: "Fields used to distinguish services",
          addField: "Add Field",
          addGroup: "Add Group",
          addGroupTooltip: "Add a new identity group",
          addFieldTooltip: "Add a field to this group",
          selectField: "Select field",
          saveIdentityConfig: "Save Configuration",
          customizeFieldMappings: "Customize Field Mappings",
          fieldMappingDialogHelp: "Map fields to service names",
          fieldMappingPlaceholder: "Enter field names",
          foundInLogs: "Found in Logs",
          foundInTraces: "Found in Traces",
          foundInMetrics: "Found in Metrics",
          autoSuggestedBanner: "Auto suggested",
          identityConfigSaved: "Configuration saved",
          identityConfigSaveFailed: "Failed to save configuration",
          identityConfigNoSets: "Configure at least one identity set",
          loadRecommendationsFailed: "Failed to load recommendations",
        },
      },
      common: {
        cancel: "Cancel",
        save: "Save",
      },
    },
  },
});

// ODialog stub mirrors the migrated API: open/title/size + primary/secondary/
// neutral button props, default/header/footer/trigger slots, and emits
// update:open + click:primary/secondary/neutral.
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: {
    open: { type: Boolean, default: false },
    persistent: { type: Boolean, default: false },
    size: { type: String, default: undefined },
    title: { type: String, default: undefined },
    subTitle: { type: String, default: undefined },
    showClose: { type: Boolean, default: true },
    width: { type: [String, Number], default: undefined },
    primaryButtonLabel: { type: String, default: undefined },
    secondaryButtonLabel: { type: String, default: undefined },
    neutralButtonLabel: { type: String, default: undefined },
    primaryButtonVariant: { type: String, default: undefined },
    secondaryButtonVariant: { type: String, default: undefined },
    neutralButtonVariant: { type: String, default: undefined },
    primaryButtonDisabled: { type: Boolean, default: false },
    secondaryButtonDisabled: { type: Boolean, default: false },
    neutralButtonDisabled: { type: Boolean, default: false },
    primaryButtonLoading: { type: Boolean, default: false },
    secondaryButtonLoading: { type: Boolean, default: false },
    neutralButtonLoading: { type: Boolean, default: false },
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-sub-title="subTitle"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
      :data-primary-loading="String(primaryButtonLoading)"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        @click="$emit('click:primary')"
      >primary</button>
      <button
        data-test="o-dialog-stub-secondary"
        @click="$emit('click:secondary')"
      >secondary</button>
      <button
        data-test="o-dialog-stub-close"
        @click="$emit('update:open', false)"
      >close</button>
    </div>
  `,
};

// ODrawer stub mirrors the migrated API: open/width + default/header slots
// and update:open emit.
const ODrawerStub = {
  name: "ODrawer",
  inheritAttrs: false,
  props: {
    open: { type: Boolean, default: false },
    persistent: { type: Boolean, default: false },
    size: { type: String, default: undefined },
    title: { type: String, default: undefined },
    subTitle: { type: String, default: undefined },
    showClose: { type: Boolean, default: true },
    width: { type: [String, Number], default: undefined },
    primaryButtonLabel: { type: String, default: undefined },
    secondaryButtonLabel: { type: String, default: undefined },
    neutralButtonLabel: { type: String, default: undefined },
    primaryButtonVariant: { type: String, default: undefined },
    secondaryButtonVariant: { type: String, default: undefined },
    neutralButtonVariant: { type: String, default: undefined },
    primaryButtonDisabled: { type: Boolean, default: false },
    secondaryButtonDisabled: { type: Boolean, default: false },
    neutralButtonDisabled: { type: Boolean, default: false },
    primaryButtonLoading: { type: Boolean, default: false },
    secondaryButtonLoading: { type: Boolean, default: false },
    neutralButtonLoading: { type: Boolean, default: false },
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-drawer-stub"
      :data-open="String(open)"
      :data-width="String(width)"
    >
      <slot name="header" />
      <slot />
      <button
        data-test="o-drawer-stub-close"
        @click="$emit('update:open', false)"
      >close</button>
    </div>
  `,
};

function mountComponent(props: Record<string, unknown> = {}) {
  return mount(ServiceIdentitySetup, {
    global: {
      plugins: [i18n, store],
      stubs: {
        "q-menu": true,
        "q-tooltip": true,
        ODialog: ODialogStub,
        ODrawer: ODrawerStub,
      },
    },
    props: {
      orgIdentifier: "test-org",
      ...props,
    },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ServiceIdentitySetup", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should mount without errors", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should call getDimensionAnalytics and getIdentityConfig on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(serviceStreamsService.getDimensionAnalytics).toHaveBeenCalledWith(
        "test-org",
      );
      expect(serviceStreamsService.getIdentityConfig).toHaveBeenCalledWith(
        "test-org",
      );
    });
  });

  describe("loading state", () => {
    it("should hide main content while loading is true", () => {
      // Before flushPromises the component is in loading=true state; the v-else
      // block containing the main content should not be present yet.
      wrapper = mountComponent();
      // The save button and the add-distinguish-btn are both inside the v-else block
      expect(
        wrapper.find('[data-test="service-identity-save-btn"]').exists(),
      ).toBe(false);
      expect(
        wrapper
          .find('[data-test="service-identity-add-distinguish-btn"]')
          .exists(),
      ).toBe(false);
    });

    it("should show main content after data loads", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // Once loading=false, the v-else block with main content is rendered.
      // The add-distinguish-btn is the empty-state btn visible when no fields are configured.
      expect(
        wrapper
          .find('[data-test="service-identity-add-distinguish-btn"]')
          .exists(),
      ).toBe(true);
    });
  });

  describe("save button", () => {
    it("should render the save button when at least one identity set is configured", async () => {
      // The save button is inside the v-else block that renders when allConfiguredEnvs.length > 0
      vi.mocked(serviceStreamsService.getIdentityConfig).mockResolvedValueOnce({
        data: {
          sets: [
            {
              id: "k8s",
              label: "Kubernetes",
              distinguish_by: ["k8s-namespace"],
            },
          ],
          tracked_alias_ids: ["k8s-namespace"],
        },
      });
      wrapper = mountComponent();
      await flushPromises();
      expect(
        wrapper.find('[data-test="service-identity-save-btn"]').exists(),
      ).toBe(true);
    });

    it("should not render save button while data is still loading", () => {
      wrapper = mountComponent();
      // loading=true: v-else branch (which contains the save btn) is hidden
      expect(
        wrapper.find('[data-test="service-identity-save-btn"]').exists(),
      ).toBe(false);
    });
  });

  describe("warnings banner", () => {
    it("should not show the warnings banner when there are no warnings", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(
        wrapper
          .find('[data-test="service-identity-warnings-banner"]')
          .exists(),
      ).toBe(false);
    });

    it("should show the warnings banner when warnings are present", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // Directly set warnings via vm — no public API exists to reach this state
       
      (wrapper.vm as any).warnings = ["Service name field not configured"];
      await wrapper.vm.$nextTick();

      expect(
        wrapper
          .find('[data-test="service-identity-warnings-banner"]')
          .exists(),
      ).toBe(true);
    });

    it("should display the warning text inside the banner", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const warningText = "Ambiguous service names detected";
       
      (wrapper.vm as any).warnings = [warningText];
      await wrapper.vm.$nextTick();

      expect(
        wrapper
          .find('[data-test="service-identity-warnings-banner"]')
          .text(),
      ).toContain(warningText);
    });
  });

  describe("emits", () => {
    it("should emit navigate-to-aliases with 'service' when the alias config link is clicked", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // The "Customize Field Mappings" link is inside the expanded service name
      // section (v-if="serviceNameExpanded"). Expand it first by clicking the
      // collapsed header row, then find and click the link.
      const collapsedRow = wrapper.find(
        ".tw\\:cursor-pointer.hover\\:tw\\:opacity-80",
      );
      await collapsedRow.trigger("click");
      await wrapper.vm.$nextTick();

      const aliasLink = wrapper
        .findAll("a.config-link-btn")
        .find((el) => el.text().includes("Customize Field Mappings"));
      expect(aliasLink).toBeDefined();
      await aliasLink!.trigger("click");

      expect(wrapper.emitted("navigate-to-aliases")).toBeTruthy();
      expect(wrapper.emitted("navigate-to-aliases")![0]).toEqual(["service"]);
    });

    it("should emit navigate-to-services when the services link is clicked in the workload section", async () => {
      // Make availableGroups non-empty with dimension analytics so the workload detection section renders
      vi.mocked(
        serviceStreamsService.getDimensionAnalytics,
      ).mockResolvedValueOnce({
        data: {
          org_id: "test-org",
          total_dimensions: 1,
          by_cardinality: {
            "k8s-namespace": 5,
          },
          recommended_priority_dimensions: [],
          dimensions: [
            {
              dimension_name: "k8s-namespace",
              cardinality: 5,
              service_count: 3,
              cardinality_class: "Low",
              first_seen: 1640995200,
              last_updated: 1640995200,
              sample_values: {},
              value_children: {},
            },
          ],
          available_groups: [
            {
              group_id: "k8s-namespace",
              display: "K8s Namespace",
              stream_types: ["logs"],
              aliases: {},
              recommended: true,
            },
          ],
          service_field_sources: [],
          generated_at: 0,
        },
      });

      wrapper = mountComponent();
      await flushPromises();

      const servicesLink = wrapper
        .findAll("a.config-link-btn")
        .find((el) => el.text().includes("Go to Services"));
      expect(servicesLink).toBeDefined();
      await servicesLink!.trigger("click");

      expect(wrapper.emitted("navigate-to-services")).toBeTruthy();
    });
  });

  // ─── Migrated dialog/drawer coverage ──────────────────────────────────────

  describe("Field Mapping ODialog", () => {
    it("should render the field-mapping ODialog closed by default with the configured title and labels", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      // At least the field-mapping + field-details dialogs are rendered (closed).
      expect(dialogs.length).toBeGreaterThanOrEqual(2);

      const fieldMappingDialog = dialogs.find(
        (d) =>
          d.attributes("data-title") === "Customize Field Mappings",
      );
      expect(fieldMappingDialog).toBeDefined();
      expect(fieldMappingDialog!.attributes("data-open")).toBe("false");
      expect(fieldMappingDialog!.attributes("data-size")).toBe("sm");
      expect(fieldMappingDialog!.attributes("data-sub-title")).toBe(
        "Map fields to service names",
      );
      expect(fieldMappingDialog!.attributes("data-primary-label")).toBe(
        "Save",
      );
      expect(fieldMappingDialog!.attributes("data-secondary-label")).toBe(
        "Cancel",
      );
    });

    it("should open the field-mapping ODialog when openFieldMappingDialog() is called", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // No public DOM trigger exists in the empty-state layout, so call the
      // exposed component method directly.
       
      (wrapper.vm as any).openFieldMappingDialog();
      await wrapper.vm.$nextTick();

      const fieldMappingDialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find(
          (d) =>
            d.attributes("data-title") === "Customize Field Mappings",
        );
      expect(fieldMappingDialog).toBeDefined();
      expect(fieldMappingDialog!.attributes("data-open")).toBe("true");
    });

    it("should close the field-mapping ODialog when the secondary (Cancel) button is clicked", async () => {
      wrapper = mountComponent();
      await flushPromises();

       
      (wrapper.vm as any).openFieldMappingDialog();
      await wrapper.vm.$nextTick();

      let fieldMappingDialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find(
          (d) =>
            d.attributes("data-title") === "Customize Field Mappings",
        );
      expect(fieldMappingDialog!.attributes("data-open")).toBe("true");

      // Click the stub's secondary button → component should set showFieldMappingDialog=false
      await fieldMappingDialog!
        .find('[data-test="o-dialog-stub-secondary"]')
        .trigger("click");
      await wrapper.vm.$nextTick();

      fieldMappingDialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find(
          (d) =>
            d.attributes("data-title") === "Customize Field Mappings",
        );
      expect(fieldMappingDialog!.attributes("data-open")).toBe("false");
    });

    it("should emit update-service-fields and close when the primary (Save) button is clicked", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // Seed editableServiceFields via the public open-method so the saved
      // value reflects what the dialog would actually send.
       
      (wrapper.vm as any).openFieldMappingDialog();
      await wrapper.vm.$nextTick();

      // Drive the TagInput → editable list update through the v-model pipeline
      const tagInput = wrapper.find('[data-test="tag-input"]');
      expect(tagInput.exists()).toBe(true);
      await tagInput.findComponent({ name: "TagInput" }).vm.$emit(
        "update:modelValue",
        ["service.name", "k8s.deployment"],
      );
      await wrapper.vm.$nextTick();

      const fieldMappingDialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find(
          (d) =>
            d.attributes("data-title") === "Customize Field Mappings",
        );
      await fieldMappingDialog!
        .find('[data-test="o-dialog-stub-primary"]')
        .trigger("click");
      await flushPromises();

      expect(wrapper.emitted("update-service-fields")).toBeTruthy();
      expect(wrapper.emitted("update-service-fields")![0]).toEqual([
        ["service.name", "k8s.deployment"],
      ]);

      // After save the dialog closes
      const closedDialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find(
          (d) =>
            d.attributes("data-title") === "Customize Field Mappings",
        );
      expect(closedDialog!.attributes("data-open")).toBe("false");
    });

    it("should reflect savingFieldMappings as the primary-button-loading prop", async () => {
      wrapper = mountComponent();
      await flushPromises();

       
      const vm = wrapper.vm as any;
      vm.openFieldMappingDialog();
      vm.savingFieldMappings = true;
      await wrapper.vm.$nextTick();

      const fieldMappingDialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find(
          (d) =>
            d.attributes("data-title") === "Customize Field Mappings",
        );
      expect(fieldMappingDialog!.attributes("data-primary-loading")).toBe(
        "true",
      );
    });
  });

  describe("Workload Insight ODrawer", () => {
    // The ODrawer lives inside the Workload Detection section which is
    // v-if'd on workloadDetectedGroups.length > 0 — seed dimension analytics
    // with at least one available group so that section renders.
    const workloadAnalytics = {
      data: {
        org_id: "test-org",
        total_dimensions: 1,
        by_cardinality: { "k8s-namespace": 5 },
        recommended_priority_dimensions: [],
        dimensions: [
          {
            dimension_name: "k8s-namespace",
            cardinality: 5,
            service_count: 3,
            cardinality_class: "Low",
            first_seen: 1640995200,
            last_updated: 1640995200,
            sample_values: {},
            value_children: {},
          },
        ],
        available_groups: [
          {
            group_id: "k8s-namespace",
            display: "K8s Namespace",
            stream_types: ["logs"],
            aliases: {},
            recommended: true,
          },
        ],
        service_field_sources: [],
        generated_at: 0,
      },
    };

    beforeEach(() => {
      vi.mocked(
        serviceStreamsService.getDimensionAnalytics,
      ).mockResolvedValue(workloadAnalytics as any);
    });

    it("should render the workload insight ODrawer closed by default", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const drawer = wrapper.find('[data-test="o-drawer-stub"]');
      expect(drawer.exists()).toBe(true);
      expect(drawer.attributes("data-open")).toBe("false");
    });

    it("should open the ODrawer with the computed width when openInsightDialog() is invoked", async () => {
      wrapper = mountComponent();
      await flushPromises();

       
      const vm = wrapper.vm as any;
      vm.openInsightDialog("k8s-namespace", "primary");
      await flushPromises();

      const drawer = wrapper.find('[data-test="o-drawer-stub"]');
      expect(drawer.attributes("data-open")).toBe("true");
      // Default width when there are <= 2 related dimensions → 37 (percent)
      expect(drawer.attributes("data-width")).toBe("37");
    });

    it("should close the ODrawer when update:open=false is emitted (header close)", async () => {
      wrapper = mountComponent();
      await flushPromises();

       
      (wrapper.vm as any).openInsightDialog("k8s-namespace", "primary");
      await flushPromises();
      expect(
        wrapper.find('[data-test="o-drawer-stub"]').attributes("data-open"),
      ).toBe("true");

      await wrapper
        .find('[data-test="o-drawer-stub-close"]')
        .trigger("click");
      await wrapper.vm.$nextTick();

      expect(
        wrapper.find('[data-test="o-drawer-stub"]').attributes("data-open"),
      ).toBe("false");
    });
  });

  describe("Field Details ODialog", () => {
    it("should render the field-details ODialog closed by default with size md", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      // The field-details dialog is the only md-sized ODialog in the template.
      const detailsDialog = dialogs.find(
        (d) => d.attributes("data-size") === "md",
      );
      expect(detailsDialog).toBeDefined();
      expect(detailsDialog!.attributes("data-open")).toBe("false");
    });

    it("should clear preselected popup state when update:open=false is emitted", async () => {
      wrapper = mountComponent();
      await flushPromises();

       
      const vm = wrapper.vm as any;
      // Drive open + populate the values we expect to be cleared on close.
      vm.detailsDialogVisible = true;
      vm.preselectedValue = "some-value";
      vm.popupPrimaryValue = "primary-val";
      vm.popupColumnSelections = ["a", "b"];
      await wrapper.vm.$nextTick();

      // Trigger the close on the md-sized dialog (field-details)
      const detailsDialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find((d) => d.attributes("data-size") === "md");
      await detailsDialog!
        .find('[data-test="o-dialog-stub-close"]')
        .trigger("click");
      await wrapper.vm.$nextTick();

      expect(vm.detailsDialogVisible).toBe(false);
      expect(vm.preselectedValue).toBe("");
      expect(vm.popupPrimaryValue).toBe("");
      expect(vm.popupColumnSelections).toEqual([]);
    });
  });
});
