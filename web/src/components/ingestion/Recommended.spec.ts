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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import Recommended from "./Recommended.vue";
import i18n from "@/locales";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";

// Mock getImageURL
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `/mocked/${path}`),
  verifyOrganizationStatus: vi.fn(),
}));

describe("Recommended", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "org123",
        },
        userInfo: {
          email: "test@example.com",
        },
        zoConfig: {
          ai_enabled: false,
        },
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", name: "recommended", component: { template: "<div>Recommended</div>" } },
        {
          path: "/kubernetes",
          name: "ingestFromKubernetes",
          component: { template: "<div>Kubernetes</div>" },
        },
      ],
    });

    router.push("/");

    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render splitter component", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    const splitter = wrapper.findComponent({ name: "OSplitter" });
    expect(splitter.exists()).toBe(true);
  });

  it("should render navigation tabs", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    const tabs = wrapper.findComponent({ name: "OTabs" });
    expect(tabs.exists()).toBe(true);
  });

  it("should have vertical tabs", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    const tabs = wrapper.findComponent({ name: "OTabs" });
    expect(tabs.props("orientation")).toBe("vertical");
  });

  it("should render router-view for content", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    expect(wrapper.html()).toContain("router-view");
  });

  it("should pass org identifier to router-view", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    expect(wrapper.vm.currentOrgIdentifier).toBe("org123");
  });

  it("should pass user email to router-view", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    expect(wrapper.vm.currentUserEmail).toBe("test@example.com");
  });

  it("should have recommended tabs array", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    expect(wrapper.vm.recommendedTabs).toBeDefined();
    expect(Array.isArray(wrapper.vm.recommendedTabs)).toBe(true);
    expect(wrapper.vm.recommendedTabs.length).toBeGreaterThan(0);
  });

  it("should include Kubernetes ingestion tab", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    const kubernetesTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromKubernetes",
    );
    expect(kubernetesTab).toBeDefined();
  });

  it("should include Windows ingestion tab", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    const windowsTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromWindows",
    );
    expect(windowsTab).toBeDefined();
  });

  it("should include Linux ingestion tab", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    const linuxTab = wrapper.vm.recommendedTabs.find((tab: any) => tab.name === "ingestFromLinux");
    expect(linuxTab).toBeDefined();
  });

  it("should include AWS config tab", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    const awsTab = wrapper.vm.recommendedTabs.find((tab: any) => tab.name === "AWSConfig");
    expect(awsTab).toBeDefined();
  });

  it("should include traces/OTLP tab", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    const tracesTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromTraces",
    );
    expect(tracesTab).toBeDefined();
  });

  // MCP is served by every edition, so the tab is not build- or ai_enabled-gated.
  it("should include the MCP tab regardless of edition", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    const mcpTab = wrapper.vm.recommendedTabs.find((tab: any) => tab.name === "recommendedMcp");
    expect(mcpTab).toBeDefined();
  });

  it("should have card container styling", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          "router-view": true,
        },
      },
    });

    const cardContainer = wrapper.find(".bg-card-glass-bg");
    expect(cardContainer.exists()).toBe(true);
  });
});

describe("Recommended: Get started pick", () => {
  const ORG = "org123";
  const guides = [
    "recommended",
    "ingestFromKubernetes",
    "ingestFromWindows",
    "ingestFromLinux",
    "ingestFromMacOS",
    "ingestFromGpu",
    "AWSConfig",
    "GCPConfig",
    "AzureConfig",
    "ingestFromTraces",
    "frontendMonitoring",
    "recommendedMcp",
    "nginx",
    "curl",
  ];

  const mountRail = async () => {
    const store = createStore({
      state: {
        selectedOrganization: { identifier: ORG },
        userInfo: { email: "test@example.com" },
        zoConfig: { ai_enabled: false },
      },
    });
    const router = createRouter({
      history: createWebHistory(),
      routes: guides.map((name) => ({
        path: `/${name}`,
        name,
        component: { template: "<div />" },
      })),
    });
    await router.push("/ingestFromLinux");
    await router.isReady();
    const wrapper = mount(Recommended, {
      global: { plugins: [i18n, store, router], stubs: { "router-view": true } },
    });
    await flushPromises();
    return wrapper;
  };

  const railNames = (wrapper: ReturnType<typeof mount>) =>
    wrapper
      .findAll('[data-test^="ingestion-recommended-"]')
      .map((el) => el.attributes("data-test"))
      .filter((id) => id !== "ingestion-recommended-tab-" && !id?.endsWith("-group"));

  beforeEach(() => {
    localStorage.clear();
  });

  it("renders today's rail, with no groups, when there is no pick", async () => {
    const wrapper = await mountRail();
    expect(wrapper.find('[data-test="ingestion-recommended-pick-group"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="ingestion-recommended-tab-ingestFromKubernetes"]').exists(),
    ).toBe(true);
    wrapper.unmount();
  });

  it("pins a recommended pick under Your pick and drops it from the list below", async () => {
    localStorage.setItem(`o2.onboarding.firstSource.${ORG}`, "kubernetes");
    const wrapper = await mountRail();
    expect(wrapper.find('[data-test="ingestion-recommended-pick-group"]').text()).toBe("Your pick");
    expect(wrapper.find('[data-test="ingestion-recommended-rest-group"]').text()).toBe(
      "Recommended",
    );
    const ids = railNames(wrapper);
    expect(ids[0]).toBe("ingestion-recommended-pick-tab-ingestFromKubernetes");
    expect(ids).not.toContain("ingestion-recommended-tab-ingestFromKubernetes");
    expect(ids).toContain("ingestion-recommended-tab-ingestFromLinux");
    wrapper.unmount();
  });

  it("pins a pick from another category, linking across to its guide", async () => {
    localStorage.setItem(`o2.onboarding.firstSource.${ORG}`, "webserver");
    const wrapper = await mountRail();
    const pin = wrapper.find('[data-test="ingestion-recommended-pick-tab-nginx"]');
    expect(pin.exists()).toBe(true);
    expect(pin.text()).toContain("Web server logs");
    expect(railNames(wrapper)).toContain("ingestion-recommended-tab-ingestFromKubernetes");
    wrapper.unmount();
  });

  it("pins nothing for Not sure yet or a pick stored for another org", async () => {
    localStorage.setItem(`o2.onboarding.firstSource.${ORG}`, "unsure");
    localStorage.setItem("o2.onboarding.firstSource.other", "kubernetes");
    const wrapper = await mountRail();
    expect(wrapper.find('[data-test="ingestion-recommended-pick-group"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
