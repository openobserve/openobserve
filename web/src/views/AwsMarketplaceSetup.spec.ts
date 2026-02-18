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
import AwsMarketplaceSetup from "./AwsMarketplaceSetup.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";

installQuasar();

describe("AwsMarketplaceSetup", () => {
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

    // Clear cookies before each test
    document.cookie = "";
  });

  afterEach(() => {
    document.cookie = "";
    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find(".aws-marketplace-setup").exists()).toBe(true);
  });

  it("should display logo", () => {
    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    const logo = wrapper.find(".appLogo");
    expect(logo.exists()).toBe(true);
  });

  it("should show no_token state when no token is present", async () => {
    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    await flushPromises();

    expect(wrapper.vm.state).toBe("no_token");
    expect(wrapper.text()).toContain("No Marketplace Token Found");
  });

  it("should show select_org state when token is present", async () => {
    // Set token cookie
    document.cookie = "aws_marketplace_token=test_token; path=/";

    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    await flushPromises();

    expect(wrapper.vm.token).toBe("test_token");
  });

  it("should display org selection UI in select_org state", async () => {
    document.cookie = "aws_marketplace_token=test_token; path=/";

    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "select_org";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Complete AWS Marketplace Setup");
    expect(wrapper.text()).toContain("Create New Organization");
  });

  it("should enable create button when org name is provided", async () => {
    document.cookie = "aws_marketplace_token=test_token; path=/";

    const wrapper = mount(AwsMarketplaceSetup, {
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

  it("should display processing state", async () => {
    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "processing";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Setting up your subscription");
  });

  it("should display pending activation state", async () => {
    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "pending_activation";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Waiting for AWS Confirmation");
  });

  it("should display success state", async () => {
    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "success";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Subscription Activated");
    expect(wrapper.find('[name="check_circle"]').exists()).toBe(true);
  });

  it("should display error state with message", async () => {
    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "error";
    wrapper.vm.errorMessage = "Test error message";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Test error message");
    expect(wrapper.find('[name="error"]').exists()).toBe(true);
  });

  it("should display payment failed state", async () => {
    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.state = "payment_failed";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Payment Failed");
  });

  it("should reset state when resetAndRetry is called", async () => {
    const wrapper = mount(AwsMarketplaceSetup, {
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

    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    await wrapper.vm.goToDashboard();

    expect(routerPushSpy).toHaveBeenCalledWith({
      path: "/",
      query: undefined,
    });
  });

  it("should navigate to dashboard with org_identifier when activated", async () => {
    const routerPushSpy = vi.spyOn(router, "push");

    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router],
      },
    });

    wrapper.vm.activatedOrgId = "org123";
    await wrapper.vm.goToDashboard();

    expect(routerPushSpy).toHaveBeenCalledWith({
      path: "/",
      query: { org_identifier: "org123" },
    });
  });

  it("should show eligible organizations when available", async () => {
    document.cookie = "aws_marketplace_token=test_token; path=/";

    const wrapper = mount(AwsMarketplaceSetup, {
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

  it("should enable link button when org is selected", async () => {
    document.cookie = "aws_marketplace_token=test_token; path=/";

    const wrapper = mount(AwsMarketplaceSetup, {
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
      btn.text().includes("Link AWS Billing")
    );
    expect(linkBtn).toBeTruthy();
  });

  it("should use correct theme logo", async () => {
    const wrapper = mount(AwsMarketplaceSetup, {
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

    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [darkStore, router],
      },
    });

    const logo = wrapper.find(".appLogo");
    expect(logo.attributes("src")).toContain("dark");
  });
});
