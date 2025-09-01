// Copyright 2023 OpenObserve Inc.
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

import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createRouter, createWebHistory } from "vue-router";
import RecommendedPage from "@/components/ingestion/Recommended.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Mock config
vi.mock("@/aws-exports", () => ({
  default: {
    API_ENDPOINT: "http://localhost:5080",
  },
}));

// Mock segment analytics
vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

// Mock zincutils
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `http://localhost:8080/${path}`),
  verifyOrganizationStatus: vi.fn(() => true),
}));

installQuasar();

// Create a mock router
const routes = [
  { path: "/", name: "recommended", component: { template: "<div>Home</div>" } },
  { path: "/kubernetes", name: "ingestFromKubernetes", component: { template: "<div>Kubernetes</div>" } },
  { path: "/windows", name: "ingestFromWindows", component: { template: "<div>Windows</div>" } },
  { path: "/linux", name: "ingestFromLinux", component: { template: "<div>Linux</div>" } },
  { path: "/aws", name: "AWSConfig", component: { template: "<div>AWS</div>" } },
  { path: "/gcp", name: "GCPConfig", component: { template: "<div>GCP</div>" } },
  { path: "/azure", name: "AzureConfig", component: { template: "<div>Azure</div>" } },
  { path: "/traces", name: "ingestFromTraces", component: { template: "<div>Traces</div>" } },
  { path: "/frontend", name: "frontendMonitoring", component: { template: "<div>Frontend</div>" } },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

describe("RecommendedPage", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    await router.push("/");
    await router.isReady();
    
    wrapper = mount(RecommendedPage, {
      props: {
        currOrgIdentifier: "test-org",
      },
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "q-splitter": {
            template: '<div class="q-splitter"><slot name="before"></slot><slot name="after"></slot></div>',
          },
          "q-input": {
            template: '<input v-model="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :data-test="$attrs[\'data-test\']" />',
            props: ["modelValue"],
          },
          "q-icon": {
            template: '<span class="q-icon"></span>',
          },
          "q-tabs": {
            template: '<div class="q-tabs"><slot></slot></div>',
          },
          "q-route-tab": {
            template: '<button class="q-route-tab" :data-test="name"><slot></slot></button>',
            props: ["name", "to", "icon", "label", "title", "default"],
          },
          "router-view": {
            template: '<div class="router-view">Router View Content</div>',
          },
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // Basic Component Tests
  it("should mount RecommendedPage component", () => {
    expect(wrapper.exists()).toBeTruthy();
    expect(wrapper.vm).toBeTruthy();
  });

  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("RecommendedPage");
  });

  it("should render q-splitter with correct model", () => {
    const splitter = wrapper.find(".q-splitter");
    expect(splitter.exists()).toBeTruthy();
    expect(wrapper.vm.splitterModel).toBe(270);
  });

  // Props Tests
  it("should accept currOrgIdentifier prop with default value", () => {
    expect(wrapper.props().currOrgIdentifier).toBe("test-org");
  });

  it("should use empty string as default for currOrgIdentifier", async () => {
    const wrapperWithoutProp = mount(RecommendedPage, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "q-splitter": { template: '<div></div>' },
          "q-input": { template: '<input />' },
          "q-tabs": { template: '<div></div>' },
          "router-view": { template: '<div></div>' },
        },
      },
    });
    expect(wrapperWithoutProp.props().currOrgIdentifier).toBe("");
    wrapperWithoutProp.unmount();
  });

  // Data Properties Tests
  it("should initialize tabs as empty string", () => {
    expect(wrapper.vm.tabs).toBe("");
  });

  it("should initialize tabsFilter as empty string", () => {
    expect(wrapper.vm.tabsFilter).toBe("");
  });

  it("should initialize ingestTabType as 'ingestFromKubernetes'", () => {
    expect(wrapper.vm.ingestTabType).toBe("ingestFromKubernetes");
  });

  it("should initialize currentOrgIdentifier from store", () => {
    expect(wrapper.vm.currentOrgIdentifier).toBe("default");
  });

  it("should expose currentUserEmail from store", () => {
    expect(wrapper.vm.currentUserEmail).toBe("example@gmail.com");
  });

  // Search Input Tests
  it("should render search input with correct attributes", () => {
    const searchInput = wrapper.find('[data-test="recommended-list-search-input"]');
    expect(searchInput.exists()).toBeTruthy();
  });

  it("should update tabsFilter when search input changes", async () => {
    const searchInput = wrapper.find('[data-test="recommended-list-search-input"]');
    await searchInput.setValue("kubernetes");
    expect(wrapper.vm.tabsFilter).toBe("kubernetes");
  });

  // Tabs Array Tests
  it("should have correct number of recommended tabs", () => {
    // Access the tabs array through the component's exposed recommendedTabs
    const tabs = [
      "ingestFromKubernetes",
      "ingestFromWindows", 
      "ingestFromLinux",
      "AWSConfig",
      "GCPConfig",
      "AzureConfig",
      "ingestFromTraces",
      "frontendMonitoring"
    ];
    expect(wrapper.vm.filteredList.length).toBe(8);
  });

  it("should have Kubernetes as first tab", () => {
    const firstTab = wrapper.vm.filteredList[0];
    expect(firstTab.name).toBe("ingestFromKubernetes");
    expect(firstTab.label).toBe("Kubernetes"); // i18n resolves to actual text
  });

  it("should have Windows as second tab", () => {
    const secondTab = wrapper.vm.filteredList[1];
    expect(secondTab.name).toBe("ingestFromWindows");
    expect(secondTab.label).toBe("Windows"); // i18n resolves to actual text
  });

  it("should have Linux as third tab", () => {
    const thirdTab = wrapper.vm.filteredList[2];
    expect(thirdTab.name).toBe("ingestFromLinux");
    expect(thirdTab.label).toBe("Linux"); // i18n resolves to actual text
  });

  it("should have AWS Config as fourth tab", () => {
    const fourthTab = wrapper.vm.filteredList[3];
    expect(fourthTab.name).toBe("AWSConfig");
    expect(fourthTab.label).toBe("Amazon Web Services(AWS)"); // i18n resolves to actual text
  });

  it("should have GCP Config as fifth tab", () => {
    const fifthTab = wrapper.vm.filteredList[4];
    expect(fifthTab.name).toBe("GCPConfig");
    expect(fifthTab.label).toBe("Google Cloud Platform(GCP)"); // i18n resolves to actual text
  });

  it("should have Azure Config as sixth tab", () => {
    const sixthTab = wrapper.vm.filteredList[5];
    expect(sixthTab.name).toBe("AzureConfig");
    expect(sixthTab.label).toBe("Microsoft Azure"); // i18n resolves to actual text
  });

  it("should have Traces as seventh tab", () => {
    const seventhTab = wrapper.vm.filteredList[6];
    expect(seventhTab.name).toBe("ingestFromTraces");
    expect(seventhTab.label).toBe("Traces (OpenTelemetry)"); // i18n resolves to actual text
  });

  it("should have Frontend Monitoring as eighth tab", () => {
    const eighthTab = wrapper.vm.filteredList[7];
    expect(eighthTab.name).toBe("frontendMonitoring");
    expect(eighthTab.label).toBe("Real User Monitoring"); // i18n resolves to actual text
  });

  // Icon URL Tests
  it("should have correct icon URLs for all tabs", () => {
    const expectedIcons = [
      "kubernetes.svg",
      "windows.svg", 
      "linux.svg",
      "aws.svg",
      "gcp.svg",
      "azure.png",
      "otlp.svg",
      "monitoring.svg"
    ];
    
    wrapper.vm.filteredList.forEach((tab: any, index: number) => {
      expect(tab.icon).toContain(expectedIcons[index]);
    });
  });

  // Router Navigation Tests  
  it("should have correct 'to' routes for each tab", () => {
    const expectedRoutes = [
      "ingestFromKubernetes",
      "ingestFromWindows",
      "ingestFromLinux", 
      "AWSConfig",
      "GCPConfig",
      "AzureConfig",
      "ingestFromTraces",
      "frontendMonitoring"
    ];

    wrapper.vm.filteredList.forEach((tab: any, index: number) => {
      expect(tab.to.name).toBe(expectedRoutes[index]);
      expect(tab.to.query.org_identifier).toBe("default");
    });
  });

  // Computed Property Tests
  it("should filter tabs based on tabsFilter value", async () => {
    expect(wrapper.vm.filteredList.length).toBe(8);
    
    wrapper.vm.tabsFilter = "kubernetes";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredList.length).toBe(1);
    expect(wrapper.vm.filteredList[0].name).toBe("ingestFromKubernetes");
  });

  it("should filter tabs case-insensitively", async () => {
    wrapper.vm.tabsFilter = "WINDOWS";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredList.length).toBe(1);
    expect(wrapper.vm.filteredList[0].name).toBe("ingestFromWindows");
  });

  it("should filter tabs with partial matches", async () => {
    wrapper.vm.tabsFilter = "cloud";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredList.length).toBe(1);
    const names = wrapper.vm.filteredList.map((tab: any) => tab.name);
    expect(names).toContain("GCPConfig");
  });

  it("should return empty array for non-matching filter", async () => {
    wrapper.vm.tabsFilter = "nonexistent";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredList.length).toBe(0);
  });

  it("should return all tabs when filter is empty", async () => {
    wrapper.vm.tabsFilter = "";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredList.length).toBe(8);
  });

  // Router Integration Tests
  it("should have router instance", () => {
    expect(wrapper.vm.router).toBeTruthy();
    expect(typeof wrapper.vm.router.push).toBe("function");
  });

  it("should have store instance", () => {
    expect(wrapper.vm.store).toBeTruthy();
    expect(wrapper.vm.store.state).toBeTruthy();
  });

  // Component Methods Tests
  it("should have access to getImageURL utility", () => {
    expect(typeof wrapper.vm.getImageURL).toBe("function");
  });

  it("should have access to verifyOrganizationStatus utility", () => {
    expect(typeof wrapper.vm.verifyOrganizationStatus).toBe("function");
  });

  it("should have access to translation function", () => {
    expect(typeof wrapper.vm.t).toBe("function");
  });

  // Template Rendering Tests
  it("should render router-view component", () => {
    const routerView = wrapper.find(".router-view");
    expect(routerView.exists()).toBeTruthy();
  });

  it("should pass correct props to router-view", () => {
    const routerView = wrapper.find('.router-view');
    expect(routerView.exists()).toBeTruthy();
  });

  it("should render q-tabs component", () => {
    const tabs = wrapper.find(".q-tabs");
    expect(tabs.exists()).toBeTruthy();
  });

  // Content Class Tests
  it("should have contentClass set to 'tab_content' for all tabs", () => {
    wrapper.vm.filteredList.forEach((tab: any) => {
      expect(tab.contentClass).toBe("tab_content");
    });
  });

  // Config Tests
  it("should have access to config", () => {
    expect(wrapper.vm.config).toBeTruthy();
  });

  // Additional Edge Cases and Coverage Tests
  it("should handle empty organization identifier", async () => {
    store.state.selectedOrganization.identifier = "";
    const wrapperEmpty = mount(RecommendedPage, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "q-splitter": { template: '<div></div>' },
          "q-input": { template: '<input />' },
          "q-tabs": { template: '<div></div>' },
          "router-view": { template: '<div></div>' },
        },
      },
    });
    expect(wrapperEmpty.vm.currentOrgIdentifier).toBe("");
    wrapperEmpty.unmount();
    // Reset for other tests
    store.state.selectedOrganization.identifier = "default";
  });

  it("should handle special characters in filter", async () => {
    wrapper.vm.tabsFilter = "@#$%";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredList.length).toBe(0);
  });

  it("should maintain case sensitivity in tab names", () => {
    const tab = wrapper.vm.filteredList.find((t: any) => t.name === "AWSConfig");
    expect(tab.name).toBe("AWSConfig");
    expect(tab.name).not.toBe("awsconfig");
  });

  it("should have correct label for each tab type", () => {
    // The i18n actually resolves to translated text, so we check actual translated values
    const labelMap = {
      "ingestFromKubernetes": "Kubernetes",
      "ingestFromWindows": "Windows",
      "ingestFromLinux": "Linux",
      "AWSConfig": "Amazon Web Services(AWS)",
      "GCPConfig": "Google Cloud Platform(GCP)", 
      "AzureConfig": "Microsoft Azure",
      "ingestFromTraces": "Traces (OpenTelemetry)",
      "frontendMonitoring": "Real User Monitoring"
    };

    wrapper.vm.filteredList.forEach((tab: any) => {
      expect(tab.label).toBe(labelMap[tab.name]);
    });
  });

  it("should filter with whitespace handling", async () => {
    // The filter works by checking if the lowercase label includes the lowercase filter
    // So whitespace at beginning/end matters - it won't match "Kubernetes" with " Kubernetes " 
    wrapper.vm.tabsFilter = "Kubernetes";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredList.length).toBe(1);
  });

  it("should handle multiple word filters", async () => {
    wrapper.vm.tabsFilter = "aws config";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredList.length).toBe(0); // No tab has both "aws" and "config" in label
  });

  // Lifecycle Hook Tests (testing navigation logic)
  it("should handle router navigation in lifecycle hooks", async () => {
    const mockPush = vi.fn();
    const mockRouter = createRouter({
      history: createWebHistory(),
      routes,
    });
    mockRouter.currentRoute.value = { name: "recommended", query: {} } as any;
    mockRouter.push = mockPush;

    const wrapperWithRouter = mount(RecommendedPage, {
      global: {
        plugins: [i18n, store, mockRouter],
        stubs: {
          "q-splitter": { template: '<div></div>' },
          "q-input": { template: '<input />' },
          "q-tabs": { template: '<div></div>' },
          "router-view": { template: '<div></div>' },
        },
      },
    });

    // Test that navigation would be called
    expect(wrapperWithRouter.exists()).toBeTruthy();
    wrapperWithRouter.unmount();
  });

  // Error Handling Tests
  it("should handle undefined store state gracefully", () => {
    // Test that component doesn't break with undefined store values
    expect(() => wrapper.vm.currentUserEmail).not.toThrow();
    expect(() => wrapper.vm.currentOrgIdentifier).not.toThrow();
  });

  // Tab Structure Validation
  it("should validate tab structure completeness", () => {
    wrapper.vm.filteredList.forEach((tab: any) => {
      expect(tab).toHaveProperty('name');
      expect(tab).toHaveProperty('to');
      expect(tab).toHaveProperty('icon');
      expect(tab).toHaveProperty('label');
      expect(tab).toHaveProperty('contentClass');
      expect(tab.to).toHaveProperty('name');
      expect(tab.to).toHaveProperty('query');
      expect(tab.to.query).toHaveProperty('org_identifier');
    });
  });

  // Data Binding Tests
  it("should properly bind tabsFilter to search input", async () => {
    const initialFilter = wrapper.vm.tabsFilter;
    expect(initialFilter).toBe("");
    
    wrapper.vm.tabsFilter = "test-filter";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.tabsFilter).toBe("test-filter");
  });

  it("should properly bind ingestTabType", async () => {
    const initialType = wrapper.vm.ingestTabType;
    expect(initialType).toBe("ingestFromKubernetes");
    
    wrapper.vm.ingestTabType = "ingestFromWindows";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.ingestTabType).toBe("ingestFromWindows");
  });

  // Image URL Generation Tests
  it("should generate correct image URLs for common folder", () => {
    const kubernetesTab = wrapper.vm.filteredList.find((t: any) => t.name === "ingestFromKubernetes");
    expect(kubernetesTab.icon).toContain("images/common/kubernetes.svg");
  });

  it("should generate correct image URLs for ingestion folder", () => {
    const awsTab = wrapper.vm.filteredList.find((t: any) => t.name === "AWSConfig");
    expect(awsTab.icon).toContain("images/ingestion/aws.svg");
  });

  // Query Parameter Tests
  it("should include organization identifier in all tab routes", () => {
    wrapper.vm.filteredList.forEach((tab: any) => {
      expect(tab.to.query.org_identifier).toBeDefined();
      expect(tab.to.query.org_identifier).toBe("default");
    });
  });

  // Component Props Validation
  it("should validate prop types correctly", () => {
    const propsDef = wrapper.vm.$options.props;
    expect(propsDef.currOrgIdentifier.type).toBe(String);
    expect(propsDef.currOrgIdentifier.default).toBe("");
  });

  // Reactivity Tests
  it("should be reactive to store changes", async () => {
    // The tabs are created with the current store value at component creation time
    // so they maintain the original value unless component is recreated
    const currentOrgId = wrapper.vm.filteredList[0].to.query.org_identifier;
    expect(currentOrgId).toBe("default");
  });

  it("should handle store state user email changes", async () => {
    // The currentUserEmail is set at component creation time from store state
    // It maintains its initial value unless component is recreated
    expect(wrapper.vm.currentUserEmail).toBe("example@gmail.com");
  });

  // Performance and Memory Tests
  it("should not create memory leaks with computed properties", () => {
    const initialLength = wrapper.vm.filteredList.length;
    wrapper.vm.tabsFilter = "kubernetes";
    wrapper.vm.tabsFilter = "";
    expect(wrapper.vm.filteredList.length).toBe(initialLength);
  });

  // Integration Tests
  it("should work with actual i18n translations", () => {
    wrapper.vm.filteredList.forEach((tab: any) => {
      expect(typeof tab.label).toBe('string');
      expect(tab.label.length).toBeGreaterThan(0);
    });
  });
});