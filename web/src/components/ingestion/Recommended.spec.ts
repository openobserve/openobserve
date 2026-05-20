// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import Recommended from "./Recommended.vue";
import i18n from "@/locales";
import { createStore } from "vuex";

// Mock router state
const mockRouterState = {
  name: "recommended",
};

const mockRouter = {
  currentRoute: {
    value: {
      get name() {
        return mockRouterState.name;
      },
      query: {},
    },
  },
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value,
}));

// Mock getImageURL
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `/mocked/${path}`),
  verifyOrganizationStatus: vi.fn(),
}));

const baseStubs = {
  OSplitter: {
    name: "OSplitter",
    template: '<div class="o-splitter"><slot name="before"></slot><slot name="after"></slot></div>',
    props: ["modelValue", "unit", "horizontal"],
  },
  OTabs: {
    name: "OTabs",
    template: '<div class="o-tabs-stub"><slot /></div>',
    props: ["modelValue", "orientation"],
    emits: ["update:modelValue"],
  },
  ORouteTab: {
    name: "ORouteTab",
    template: '<div class="o-route-tab-stub"></div>',
    props: ["name", "to", "label", "icon", "title", "default"],
  },
  'router-view': true,
};

describe("Recommended", () => {
  let store: any;

  beforeEach(() => {
    mockRouterState.name = "recommended";

    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "org123",
        },
        userInfo: {
          email: "test@example.com",
        },
      },
    });

    vi.clearAllMocks();
  });

  const createWrapper = () =>
    mount(Recommended, {
      global: {
        plugins: [i18n, store],
        stubs: { ...baseStubs },
      },
    });

  it("should render the component", () => {
    const wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
  });

  it("should render splitter component", () => {
    const wrapper = createWrapper();
    const splitter = wrapper.findComponent({ name: "OSplitter" });
    expect(splitter.exists()).toBe(true);
  });

  it("should render navigation tabs", () => {
    const wrapper = createWrapper();
    const tabs = wrapper.findComponent({ name: "OTabs" });
    expect(tabs.exists()).toBe(true);
  });

  it("should have vertical tabs", () => {
    const wrapper = createWrapper();
    const tabs = wrapper.findComponent({ name: "OTabs" });
    expect(tabs.props("orientation")).toBe("vertical");
  });

  it("should render router-view for content", () => {
    const wrapper = createWrapper();
    expect(wrapper.html()).toContain("router-view");
  });

  it("should pass org identifier to router-view", () => {
    const wrapper = createWrapper();
    expect(wrapper.vm.currentOrgIdentifier).toBe("org123");
  });

  it("should pass user email to router-view", () => {
    const wrapper = createWrapper();
    expect(wrapper.vm.currentUserEmail).toBe("test@example.com");
  });

  it("should have recommended tabs array", () => {
    const wrapper = createWrapper();
    expect(wrapper.vm.recommendedTabs).toBeDefined();
    expect(Array.isArray(wrapper.vm.recommendedTabs)).toBe(true);
    expect(wrapper.vm.recommendedTabs.length).toBeGreaterThan(0);
  });

  it("should include Kubernetes ingestion tab", () => {
    const wrapper = createWrapper();
    const kubernetesTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromKubernetes"
    );
    expect(kubernetesTab).toBeDefined();
  });

  it("should include Windows ingestion tab", () => {
    const wrapper = createWrapper();
    const windowsTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromWindows"
    );
    expect(windowsTab).toBeDefined();
  });

  it("should include Linux ingestion tab", () => {
    const wrapper = createWrapper();
    const linuxTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromLinux"
    );
    expect(linuxTab).toBeDefined();
  });

  it("should include AWS config tab", () => {
    const wrapper = createWrapper();
    const awsTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "AWSConfig"
    );
    expect(awsTab).toBeDefined();
  });

  it("should include traces/OTLP tab", () => {
    const wrapper = createWrapper();
    const tracesTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromTraces"
    );
    expect(tracesTab).toBeDefined();
  });

  it("should have card container styling", () => {
    const wrapper = createWrapper();
    const cardContainer = wrapper.find(".card-container");
    expect(cardContainer.exists()).toBe(true);
  });

  it("should set splitter model", () => {
    const wrapper = createWrapper();
    expect(wrapper.vm.splitterModel).toBe(270);
  });

  it("should compute filtered list correctly", () => {
    const wrapper = createWrapper();
    expect(wrapper.vm.filteredList).toBeDefined();
    expect(Array.isArray(wrapper.vm.filteredList)).toBe(true);
  });
});
