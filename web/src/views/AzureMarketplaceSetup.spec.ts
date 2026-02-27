// Copyright 2025 OpenObserve Inc.
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

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AzureMarketplaceSetup from "./AzureMarketplaceSetup.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";

installQuasar();

describe("AzureMarketplaceSetup", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setSelectedOrganization: vi.fn(),
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", name: "home", component: { template: "<div>Home</div>" } },
      ],
    });

    document.cookie = "";
  });

  afterEach(() => {
    document.cookie = "";
    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find(".azure-marketplace-setup").exists()).toBe(true);
  });

  it("should display logo", () => {
    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    const logo = wrapper.find(".appLogo");
    expect(logo.exists()).toBe(true);
  });

  it("should show no_token state when no token is present", async () => {
    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    await flushPromises();

    expect(wrapper.vm.state).toBe("no_token");
    expect(wrapper.text()).toContain("No Marketplace Token Found");
    expect(wrapper.text()).toContain("Azure Marketplace");
  });

  it("should show select_org state when token is present", async () => {
    sessionStorage.setItem("azure_marketplace_token", "test_token");

    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    await flushPromises();

    expect(wrapper.vm.state).toBe("select_org");
  });

  it("should display org selection UI in select_org state", async () => {
    sessionStorage.setItem("azure_marketplace_token", "test_token");

    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "select_org";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Complete Azure Marketplace Setup");
    expect(wrapper.text()).toContain("Create New Organization");
  });

  it("should display processing state", async () => {
    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "processing";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Setting up your subscription");
  });

  it("should display processing state correctly", async () => {
    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "processing";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Setting up your subscription");
  });

  it("should display success state", async () => {
    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "success";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Subscription Activated");
  });

  it("should display error state with message", async () => {
    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "error";
    wrapper.vm.errorMessage = "Test error message";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Test error message");
  });

  it("should display payment failed state", async () => {
    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "payment_failed";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Payment Failed");
  });

  it("should reset state when resetAndRetry is called", async () => {
    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "error";
    wrapper.vm.errorMessage = "Test error";
    wrapper.vm.isProcessing = true;

    await wrapper.vm.resetAndRetry();

    expect(wrapper.vm.state).toBe("select_org");
    expect(wrapper.vm.errorMessage).toBe("");
    expect(wrapper.vm.isProcessing).toBe(false);
  });

  it("should navigate to dashboard on goToDashboard", async () => {
    const routerPushSpy = vi.spyOn(router, "push");

    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    await wrapper.vm.goToDashboard();

    expect(routerPushSpy).toHaveBeenCalled();
  });

  it("should show eligible organizations when available", async () => {
    sessionStorage.setItem("azure_marketplace_token", "test_token");

    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "select_org";
    wrapper.vm.eligibleOrganizations = [
      { identifier: "org1", name: "Org 1" },
      { identifier: "org2", name: "Org 2" },
    ];
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Link to Existing Organization");
  });

  it("should enable create button when org name is provided", async () => {
    sessionStorage.setItem("azure_marketplace_token", "test_token");

    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "select_org";
    await wrapper.vm.$nextTick();

    wrapper.vm.newOrgName = "Test Org";
    await wrapper.vm.$nextTick();

    const createBtn = wrapper.findAll('button').find(btn =>
      btn.text().includes("Create & Link")
    );
    expect(createBtn).toBeTruthy();
  });

  it("should use correct theme logo", async () => {
    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    const logo = wrapper.find(".appLogo");
    expect(logo.attributes("src")).toContain("light");
  });

  it("should use dark theme logo when theme is dark", async () => {
    const darkStore = createStore({
      state: {
        theme: "dark",
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setSelectedOrganization: vi.fn(),
      },
    });

    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [darkStore, router],
      },
    });

    const logo = wrapper.find(".appLogo");
    expect(logo.attributes("src")).toContain("dark");
  });

  it("should enable link button when org is selected", async () => {
    sessionStorage.setItem("azure_marketplace_token", "test_token");

    const wrapper = mount(AzureMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "select_org";
    wrapper.vm.eligibleOrganizations = [
      { identifier: "org1", name: "Org 1" },
    ];
    wrapper.vm.selectedOrg = { identifier: "org1", name: "Org 1" };
    await wrapper.vm.$nextTick();

    const linkBtn = wrapper.findAll('button').find(btn =>
      btn.text().includes("Link Azure Billing")
    );
    expect(linkBtn).toBeTruthy();
  });
});
