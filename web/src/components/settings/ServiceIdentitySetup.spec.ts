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
import enLocaleFull from "@/locales/languages/en-US.json";
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
    getServicesList: vi.fn().mockResolvedValue({ data: [] }),
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

vi.mock("@/lib/forms/TagInput/OTagInput.vue", () => ({
  default: {
    name: "OTagInput",
    template: '<div data-test="tag-input" :data-model-value="JSON.stringify(modelValue)" />',
    props: ["modelValue", "placeholder", "label"],
    emits: ["update:modelValue"],
  },
}));

import ServiceIdentitySetup from "./ServiceIdentitySetup.vue";
import serviceStreamsService from "@/services/service_streams";
import { serviceStreamKeys } from "@/services/service_streams.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { labelRows } from "@/components/shared/ServiceNameLabel.fixtures";
import stage8 from "@/test/unit/fixtures/serviceVersions/stage8.json";

// ─── Test setup ──────────────────────────────────────────────────────────────

// This spec asserts on these specific correlation strings, so they must win
// over the real app locale.
const inlineOverrides = {
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
      foundInProfiles: "Found in Profiles",
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
};

// Base = full app locale (so all migrated t() keys resolve); then the inline
// overrides above win for the keys this spec asserts on.
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: enLocaleFull },
});
i18n.global.mergeLocaleMessage("en", inlineOverrides);

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
      expect(serviceStreamsService.getDimensionAnalytics).toHaveBeenCalledWith("test-org");
      expect(serviceStreamsService.getIdentityConfig).toHaveBeenCalledWith("test-org");
    });
  });

  describe("loading state", () => {
    it("should hide main content while loading is true", () => {
      // Before flushPromises the component is in loading=true state; the v-else
      // block containing the main content should not be present yet.
      wrapper = mountComponent();
      // The save button and the add-distinguish-btn are both inside the v-else block
      expect(wrapper.find('[data-test="service-identity-save-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="service-identity-add-distinguish-btn"]').exists()).toBe(
        false,
      );
    });

    it("should show main content after data loads", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // Once loading=false, the v-else block with main content is rendered.
      // The add-distinguish-btn is the empty-state btn visible when no fields are configured.
      expect(wrapper.find('[data-test="service-identity-add-distinguish-btn"]').exists()).toBe(
        true,
      );
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
      expect(wrapper.find('[data-test="service-identity-save-btn"]').exists()).toBe(true);
    });

    it("should not render save button while data is still loading", () => {
      wrapper = mountComponent();
      // loading=true: v-else branch (which contains the save btn) is hidden
      expect(wrapper.find('[data-test="service-identity-save-btn"]').exists()).toBe(false);
    });
  });

  // The server builds the discovered-services list from this config, so a save expires the whole scope.
  describe("saving", () => {
    const scope = { queryKey: serviceStreamKeys.all("test-org") };
    const oneSet = {
      data: {
        sets: [{ id: "k8s", label: "Kubernetes", distinguish_by: ["k8s-namespace"] }],
        tracked_alias_ids: ["k8s-namespace"],
      },
    };

    it("expires the service-correlation cache after a successful save", async () => {
      vi.mocked(serviceStreamsService.getIdentityConfig).mockResolvedValueOnce(oneSet as any);
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      wrapper = mountComponent();
      await flushPromises();
      await (wrapper.vm as any).saveConfig();
      await flushPromises();

      expect(serviceStreamsService.saveIdentityConfig).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith(scope);
      spy.mockRestore();
    });

    it("leaves the cache alone when the save fails", async () => {
      vi.mocked(serviceStreamsService.getIdentityConfig).mockResolvedValueOnce(oneSet as any);
      vi.mocked(serviceStreamsService.saveIdentityConfig).mockRejectedValueOnce(new Error("boom"));
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      wrapper = mountComponent();
      await flushPromises();
      await (wrapper.vm as any).saveConfig();
      await flushPromises();

      expect(serviceStreamsService.saveIdentityConfig).toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalledWith(scope);
      spy.mockRestore();
    });
  });

  describe("warnings banner", () => {
    it("should not show the warnings banner when there are no warnings", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="service-identity-warnings-banner"]').exists()).toBe(false);
    });

    it("should show the warnings banner when warnings are present", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // Directly set warnings via vm — no public API exists to reach this state

      (wrapper.vm as any).warnings = ["Service name field not configured"];
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="service-identity-warnings-banner"]').exists()).toBe(true);
    });

    it("should display the warning text inside the banner", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const warningText = "Ambiguous service names detected";

      (wrapper.vm as any).warnings = [warningText];
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="service-identity-warnings-banner"]').text()).toContain(
        warningText,
      );
    });
  });

  describe("emits", () => {
    it("should emit navigate-to-aliases with 'service' when the alias config link is clicked", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // The "Customize Field Mappings" link is inside the expanded service name
      // section (v-if="serviceNameExpanded"). Expand it first by clicking the
      // collapsed header row, then find and click the link.
      const collapsedRow = wrapper.find('[data-test="service-identity-service-name-header"]');
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
      vi.mocked(serviceStreamsService.getDimensionAnalytics).mockResolvedValueOnce({
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

  describe("service display names", () => {
    const row = labelRows.differs;
    const analytics = (valueDisplay?: Record<string, string>) => ({
      data: {
        org_id: "test-org",
        total_dimensions: 1,
        by_cardinality: { service: 2 },
        recommended_priority_dimensions: [],
        dimensions: [
          {
            dimension_name: "service",
            cardinality: 2,
            service_count: 2,
            cardinality_class: "Low",
            first_seen: 0,
            last_updated: 0,
            sample_values: {},
            value_children: { [row.service_name]: {}, nats: {} },
          },
        ],
        available_groups: [
          { group_id: "service", display: "Service", stream_types: ["traces"], aliases: {} },
        ],
        service_field_sources: [],
        generated_at: 0,
        ...(valueDisplay ? { value_display: valueDisplay } : {}),
      },
    });
    const serviceSet = {
      data: {
        sets: [{ id: "k8s", label: "Kubernetes", distinguish_by: ["service"] }],
        tracked_alias_ids: [],
      },
    };

    beforeEach(() => {
      vi.mocked(serviceStreamsService.getIdentityConfig).mockResolvedValue(serviceSet as any);
    });

    it("labels service value pills with the display name, keyed by the value", async () => {
      vi.mocked(serviceStreamsService.getDimensionAnalytics).mockResolvedValue(
        analytics({ [row.service_name]: row.display_name, nats: "nats" }) as any,
      );
      wrapper = mountComponent();
      await flushPromises();

      const pill = wrapper.get(
        `[data-test="service-identity-setup-value-pill-${row.service_name}"]`,
      );
      expect(pill.text()).toContain(row.display_name);
      expect(pill.text()).not.toContain(row.service_name);
      expect(pill.find('[data-test="svcver-service-name"]').exists()).toBe(true);
      expect(wrapper.get('[data-test="service-identity-setup-value-pill-nats"]').text()).toContain(
        "nats",
      );
    });

    it("titles the insight drawer with the display name and the detected key under it", async () => {
      vi.mocked(serviceStreamsService.getDimensionAnalytics).mockResolvedValue(
        analytics({ [row.service_name]: row.display_name }) as any,
      );
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).openInsightDialog(row.service_name, "primary");
      await flushPromises();

      expect(wrapper.get('[data-test="service-identity-setup-insight-title"]').text()).toBe(
        row.display_name,
      );
      expect(wrapper.get('[data-test="service-identity-setup-insight-detected"]').text()).toBe(
        `detected as ${row.service_name}`,
      );
    });

    it("orders the signal slices Logs, Metrics, Traces whatever order the response used", async () => {
      const response = analytics();
      response.data.dimensions[0].sample_values = {
        traces: { "traces/default": [row.service_name] },
        metrics: { "metrics/default": [row.service_name] },
        logs: { "logs/default": [row.service_name] },
      } as any;
      vi.mocked(serviceStreamsService.getDimensionAnalytics).mockResolvedValue(response as any);
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).openInsightDialog(row.service_name, "primary");
      await flushPromises();
      const slices = (wrapper.vm as any).insightChartData.options.series[0].data;
      expect(slices.map((slice: { name: string }) => slice.name)).toEqual([
        "Logs",
        "Metrics",
        "Traces",
      ]);
    });

    it("counts the service card out of the discovered services, by display name", async () => {
      queryClient.clear();
      const response = analytics();
      Object.assign(response.data.dimensions[0], {
        service_count: 16,
        value_counts: { [row.service_name]: 1 },
      });
      vi.mocked(serviceStreamsService.getDimensionAnalytics).mockResolvedValue(response as any);
      vi.mocked(serviceStreamsService.getServicesList).mockResolvedValueOnce({
        data: [
          { service_name: row.service_name, display_name: row.display_name },
          { service_name: "legacy-key", display_name: row.display_name },
          { service_name: "nats" },
        ],
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).openInsightDialog(row.service_name, "primary");
      await flushPromises();
      expect((wrapper.vm as any).insightData.total).toBe(2);
      expect((wrapper.vm as any).insightData.coverage).toBe(50);
      queryClient.clear();
    });

    describe("service card denominator while the discovered count is not in", () => {
      const openServiceInsight = async (list: Promise<unknown>) => {
        queryClient.clear();
        const response = analytics();
        Object.assign(response.data.dimensions[0], {
          service_count: 16,
          value_counts: { [row.service_name]: 1 },
        });
        vi.mocked(serviceStreamsService.getDimensionAnalytics).mockResolvedValue(response as any);
        vi.mocked(serviceStreamsService.getServicesList).mockReturnValueOnce(list as any);
        wrapper = mountComponent();
        await flushPromises();
        (wrapper.vm as any).openInsightDialog(row.service_name, "primary");
        await flushPromises();
      };
      const line = () => wrapper.find('[data-test="service-identity-setup-insight-coverage"]');
      afterEach(() => queryClient.clear());

      it("says the count could not load, in red, when the read fails", async () => {
        await openServiceInsight(Promise.reject(new Error("list failed")));
        expect((wrapper.vm as any).insightData.total).toBeNull();
        const failed = wrapper.find('[data-test="service-identity-setup-insight-coverage-failed"]');
        expect(failed.exists()).toBe(true);
        expect(failed.text()).toBe("Couldn't load the service count");
        expect(failed.attributes("role")).toBe("alert");
        expect(failed.classes()).toContain("text-status-error-text");
        expect(line().exists()).toBe(false);
        expect(wrapper.text()).not.toContain("/16");
        expect(wrapper.text()).not.toContain("% of services");
      });

      it("counts a real zero as zero, not as a missing count", async () => {
        await openServiceInsight(Promise.resolve({ data: [] }));
        expect((wrapper.vm as any).insightData.total).toBe(0);
        expect(line().text()).toContain("(0/0)");
        expect(line().text()).not.toContain("/16");
      });
    });
    it("opens the clicked Service pill's own insight when Service ranks fourth", async () => {
      const key = row.service_name;
      const dimension = (
        name: string,
        cardinality: number,
        valueChildren: Record<string, Record<string, string[]>>,
        valueCounts: Record<string, number>,
      ) => ({
        dimension_name: name,
        cardinality,
        service_count: 2,
        cardinality_class: "Low",
        first_seen: 0,
        last_updated: 0,
        sample_values: { logs: { default: Object.keys(valueChildren) } },
        value_children: valueChildren,
        value_counts: valueCounts,
      });
      const group = (group_id: string, display: string) => ({
        group_id,
        display,
        stream_types: ["logs", "traces"],
        aliases: {},
      });
      vi.mocked(serviceStreamsService.getIdentityConfig).mockResolvedValue({
        data: {
          sets: [
            {
              id: "k8s",
              label: "Kubernetes",
              distinguish_by: ["k8s-cluster", "k8s-namespace", "k8s-deployment", "service"],
            },
          ],
          tracked_alias_ids: [],
        },
      } as any);
      vi.mocked(serviceStreamsService.getDimensionAnalytics).mockResolvedValue({
        data: {
          org_id: "test-org",
          total_dimensions: 4,
          by_cardinality: {},
          recommended_priority_dimensions: [],
          dimensions: [
            dimension("k8s-cluster", 1, { c1: { "k8s-namespace": ["c1"] } }, { c1: 2 }),
            dimension(
              "k8s-namespace",
              1,
              { c1: { "k8s-deployment": [key, "checkout"] } },
              { c1: 2 },
            ),
            dimension(
              "k8s-deployment",
              2,
              { [key]: { service: [key] }, checkout: { service: ["checkoutservice"] } },
              { [key]: 1, checkout: 1 },
            ),
            dimension(
              "service",
              3,
              {
                [key]: {
                  "k8s-deployment": [key],
                  "k8s-namespace": ["c1"],
                  "k8s-cluster": ["c1"],
                },
                checkoutservice: { "k8s-deployment": ["checkout"] },
                nats: {},
              },
              { [key]: 1, checkoutservice: 1, nats: 1 },
            ),
          ],
          available_groups: [
            group("k8s-cluster", "K8s Cluster"),
            group("k8s-namespace", "K8s Namespace"),
            group("k8s-deployment", "K8s Deployment"),
            group("service", "Service"),
          ],
          service_field_sources: [],
          generated_at: 0,
          value_display: stage8.analytics_value_display,
        },
      } as any);
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.get(`[data-test="service-identity-setup-value-pill-${key}"]`).trigger("click");
      await flushPromises();

      const header = wrapper.get('[data-test="service-identity-setup-insight-header"]').text();
      expect(header).toContain("Service");
      expect(header).not.toContain("K8s Deployment");
      expect(wrapper.get('[data-test="service-identity-setup-insight-title"]').text()).toBe(
        row.display_name,
      );
      expect(wrapper.get('[data-test="service-identity-setup-insight-detected"]').text()).toBe(
        `detected as ${key}`,
      );
      expect(wrapper.find('[data-test="service-identity-setup-insight-sources"]').exists()).toBe(
        true,
      );
      const related = wrapper.get('[data-test="service-identity-setup-insight-related"]').text();
      expect(related).toContain("K8s Deployment");
      expect(related).toContain(key);
      expect(related).toContain("c1");
      const notice = wrapper.get('[data-test="service-identity-setup-insight-notice"]');
      expect(notice.classes()).toContain("bg-surface-panel");
      expect(notice.classes()).not.toContain("bg-status-info-bg");
      const donut = wrapper.findComponent({ name: "CustomChartRenderer" }).props("data");
      expect(donut.animation).toBe(false);
      expect(donut.series[0]).toMatchObject({ type: "pie", radius: ["50%", "78%"] });
      const explain = wrapper.get('[data-test="service-identity-setup-insight-explain"]').text();
      expect(explain).toMatch(new RegExp(`co-occurring with\\s+${row.display_name}\\s*\\.$`));
    });
  });

  // ─── Migrated dialog/drawer coverage ──────────────────────────────────────

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
      vi.mocked(serviceStreamsService.getDimensionAnalytics).mockResolvedValue(
        workloadAnalytics as any,
      );
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

    it("names the drawer after its visible title for assistive tech", async () => {
      wrapper = mountComponent();
      await flushPromises();
      (wrapper.vm as any).openInsightDialog("shop", "primary");
      await flushPromises();
      expect(wrapper.findComponent({ name: "ODrawer" }).props("title")).toBe("K8s Namespace shop");
    });

    it("should close the ODrawer when update:open=false is emitted (header close)", async () => {
      wrapper = mountComponent();
      await flushPromises();

      (wrapper.vm as any).openInsightDialog("k8s-namespace", "primary");
      await flushPromises();
      expect(wrapper.find('[data-test="o-drawer-stub"]').attributes("data-open")).toBe("true");

      await wrapper.find('[data-test="o-drawer-stub-close"]').trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="o-drawer-stub"]').attributes("data-open")).toBe("false");
    });
  });

  describe("Field Details ODialog", () => {
    it("should render the field-details ODialog closed by default with size md", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      // The field-details dialog is the only md-sized ODialog in the template.
      const detailsDialog = dialogs.find((d) => d.attributes("data-size") === "md");
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
      await detailsDialog!.find('[data-test="o-dialog-stub-close"]').trigger("click");
      await wrapper.vm.$nextTick();

      expect(vm.detailsDialogVisible).toBe(false);
      expect(vm.preselectedValue).toBe("");
      expect(vm.popupPrimaryValue).toBe("");
      expect(vm.popupColumnSelections).toEqual([]);
    });
  });
});
