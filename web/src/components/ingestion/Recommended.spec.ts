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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import Recommended from "./Recommended.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

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
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", name: "recommended", component: { template: "<div>Recommended</div>" } },
        { path: "/kubernetes", name: "ingestFromKubernetes", component: { template: "<div>Kubernetes</div>" } },
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
          'router-view': true,
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
          'router-view': true,
        },
      },
    });

    const splitter = wrapper.findComponent({ name: "QSplitter" });
    expect(splitter.exists()).toBe(true);
  });

  it("should render navigation tabs", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'router-view': true,
        },
      },
    });

    const tabs = wrapper.findComponent({ name: "QTabs" });
    expect(tabs.exists()).toBe(true);
  });

  it("should have vertical tabs", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'router-view': true,
        },
      },
    });

    const tabs = wrapper.findComponent({ name: "QTabs" });
    expect(tabs.props("vertical")).toBe(true);
  });

  it("should render router-view for content", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'router-view': true,
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
          'router-view': true,
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
          'router-view': true,
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
          'router-view': true,
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
          'router-view': true,
        },
      },
    });

    const kubernetesTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromKubernetes"
    );
    expect(kubernetesTab).toBeDefined();
  });

  it("should include Windows ingestion tab", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'router-view': true,
        },
      },
    });

    const windowsTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromWindows"
    );
    expect(windowsTab).toBeDefined();
  });

  it("should include Linux ingestion tab", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'router-view': true,
        },
      },
    });

    const linuxTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromLinux"
    );
    expect(linuxTab).toBeDefined();
  });

  it("should include AWS config tab", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'router-view': true,
        },
      },
    });

    const awsTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "AWSConfig"
    );
    expect(awsTab).toBeDefined();
  });

  it("should include traces/OTLP tab", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'router-view': true,
        },
      },
    });

    const tracesTab = wrapper.vm.recommendedTabs.find(
      (tab: any) => tab.name === "ingestFromTraces"
    );
    expect(tracesTab).toBeDefined();
  });

  it("should have card container styling", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'router-view': true,
        },
      },
    });

    const cardContainer = wrapper.find(".card-container");
    expect(cardContainer.exists()).toBe(true);
  });

  it("should set splitter model", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'router-view': true,
        },
      },
    });

    expect(wrapper.vm.splitterModel).toBe(270);
  });

  it("should compute filtered list correctly", () => {
    const wrapper = mount(Recommended, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'router-view': true,
        },
      },
    });

    expect(wrapper.vm.filteredList).toBeDefined();
    expect(Array.isArray(wrapper.vm.filteredList)).toBe(true);
  });
});
