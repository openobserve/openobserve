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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { Notify } from "quasar";
import ServiceIdentityConfig from "./ServiceIdentityConfig.vue";

installQuasar({ plugins: { Notify } });

vi.mock("@/services/alerts", () => ({
  default: {
    getSemanticGroups: vi.fn(),
  },
}));

vi.mock("@/services/settings", () => ({
  default: {
    getSetting: vi.fn(),
    setOrgSetting: vi.fn(),
  },
}));

vi.mock("@/components/alerts/SemanticFieldGroupsConfig.vue", () => ({
  default: {
    name: "SemanticFieldGroupsConfig",
    template: '<div data-test="semantic-field-groups-config" />',
    props: ["modelValue", "orgId"],
    emits: ["update:modelValue"],
  },
}));

vi.mock("@/components/common/GroupHeader.vue", () => ({
  default: {
    name: "GroupHeader",
    template: '<div class="group-header"><slot /></div>',
    props: ["title", "showIcon"],
  },
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({ notify: vi.fn() }),
  };
});

import alertsService from "@/services/alerts";
import settingsService from "@/services/settings";

const mockSemanticGroups = [
  {
    id: "k8s-cluster",
    display: "K8s Cluster",
    group: "Kubernetes",
    fields: ["k8s.cluster.name"],
    normalize: false,
    is_stable: true,
    is_scope: true,
  },
  {
    id: "k8s-deployment",
    display: "K8s Deployment",
    group: "Kubernetes",
    fields: ["k8s.deployment.name"],
    normalize: false,
    is_stable: true,
    is_scope: false,
  },
  {
    id: "service",
    display: "Service Name",
    group: "Common",
    fields: ["service.name"],
    normalize: true,
    is_stable: false,
    is_scope: false,
  },
];

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    theme: "light",
    zoConfig: {},
  },
});

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      settings: {
        correlation: {
          serviceIdentityTitle: "Service Identity Configuration",
          serviceIdentityDescription: "Configure how services are identified",
          howItWorksTitle: "How it works",
          serviceIdentityLabel: "Service Identity",
          howItWorksDescription: "...",
          exampleLabel: "Example",
          exampleText: "Dimensions {dim1} and {dim2} produce {value}",
          configSaveFailed: "Failed to save",
          fallbackGroup: "Fallback",
          otherGroup: "Other",
          emptyIdError: " has empty ID",
          semanticMappingsSaved: "Semantic mappings saved",
        },
      },
      common: {
        nameRequired: "Name is required",
      },
    },
  },
});

const globalStubs = {
  "q-spinner-hourglass": true,
  "OIcon": { template: "<span />", props: ["name", "size", "color"] },
  "q-btn": { template: '<button :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot /></button>', props: ["label", "flat", "dense", "loading", "disable"], emits: ["click"] },
  "q-expansion-item": { template: '<div class="expansion-item"><slot /><slot name="header" /></div>', props: ["label", "icon", "dense", "class", "modelValue"], emits: ["update:modelValue"] },
  "q-chip": { template: "<span class='q-chip'><slot /></span>", props: ["dense", "size", "color", "textColor", "removable"], emits: ["remove"] },
  "q-badge": { template: "<span><slot /></span>" },
  "q-input": { template: '<input />', props: ["modelValue", "dense", "filled", "clearable", "placeholder"] },
  "q-item": { template: "<div class='q-item' @click=\"$emit('click')\"><slot /></div>", emits: ["click"] },
  "q-item-section": { template: "<div><slot /></div>", props: ["side", "avatar"] },
  "q-item-label": { template: "<div><slot /></div>", props: ["caption"] },
  "q-list": { template: "<div><slot /></div>", props: ["dense", "bordered"] },
  "q-separator": true,
  "q-tooltip": { template: "<span><slot /></span>" },
  "q-card": { template: "<div><slot /></div>" },
  "q-card-section": { template: "<div><slot /></div>" },
  "q-tab-panels": { template: "<div><slot /></div>", props: ["modelValue"] },
  "q-tab-panel": { template: "<div><slot /></div>", props: ["name"] },
  "q-tabs": { template: "<div><slot /></div>", props: ["modelValue"], emits: ["update:modelValue"] },
  "q-tab": { template: "<div />", props: ["name", "label"] },
  "i18n-t": { template: "<span><slot /></span>", props: ["keypath", "tag"] },
};

function mountComponent(propsOverrides = {}) {
  return mount(ServiceIdentityConfig, {
    props: {
      orgId: "test-org",
      ...propsOverrides,
    },
    global: {
      plugins: [mockI18n],
      provide: { store: mockStore },
      stubs: globalStubs,
    },
  });
}

describe("ServiceIdentityConfig", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(settingsService.getSetting).mockRejectedValue(new Error("not found"));
    vi.mocked(alertsService.getSemanticGroups).mockResolvedValue({
      data: mockSemanticGroups,
    } as any);
    vi.mocked(settingsService.setOrgSetting).mockResolvedValue({ data: {} } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render without errors", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should call getSetting for semantic_field_groups on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(settingsService.getSetting).toHaveBeenCalledWith("test-org", "semantic_field_groups");
    });

    it("should load semantic groups from alertsService when settings not found", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(alertsService.getSemanticGroups).toHaveBeenCalledWith("test-org");
    });

    it("should set loading to false after config loads", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe("settings v2 semantic groups loading", () => {
    it("should use semantic groups from settings v2 when available", async () => {
      const customGroups = [mockSemanticGroups[0], mockSemanticGroups[1]];
      vi.mocked(settingsService.getSetting).mockImplementation(
        (_orgId: string, key: string) => {
          if (key === "semantic_field_groups") {
            return Promise.resolve({
              data: { setting_value: customGroups },
            } as any);
          }
          return Promise.reject(new Error("not found"));
        },
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.localSemanticGroups).toHaveLength(2);
      // alertsService should not be called since we got from settings
      expect(alertsService.getSemanticGroups).not.toHaveBeenCalled();
    });
  });

  describe("initial state", () => {
    it("should initialize semanticSectionExpanded to true", async () => {
      wrapper = mountComponent();
      expect(wrapper.vm.semanticSectionExpanded).toBe(true);
    });
  });
});
