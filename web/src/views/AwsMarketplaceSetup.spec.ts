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

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import AwsMarketplaceSetup from "./AwsMarketplaceSetup.vue";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import organizationsService from "@/services/organizations";
import awsMarketplace from "@/services/awsMarketplace";

// The component calls useI18n() to i18n-drive its schema messages, so the mount
// needs an i18n plugin. Messages are irrelevant here (these tests assert
// validity, not error text), so an empty message bag is enough.
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
  missingWarn: false,
  fallbackWarn: false,
});

// Mock the services the two card-forms drive on submit.
vi.mock("@/services/organizations", () => ({
  default: {
    list: vi.fn(),
    create: vi.fn(),
  },
}));
vi.mock("@/services/awsMarketplace", () => ({
  default: {
    linkSubscription: vi.fn(),
    getActivationStatus: vi.fn(),
  },
}));

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
      routes: [{ path: "/", name: "home", component: { template: "<div>Home</div>" } }],
    });

    // Default: no orgs returned by list() unless a test overrides it.
    (organizationsService.list as any).mockResolvedValue({
      data: { data: [] },
    });

    // Clear cookies before each test
    document.cookie = "";
  });

  afterEach(() => {
    document.cookie = "";
    vi.clearAllMocks();
  });

  const mountSetup = () =>
    mount(AwsMarketplaceSetup, {
      global: {
        plugins: [store, router, i18n],
      },
    });

  it("should render the component", () => {
    const wrapper = mountSetup();

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find(".aws-marketplace-setup").exists()).toBe(true);
  });

  it("should display logo", () => {
    const wrapper = mountSetup();

    const logo = wrapper.find('[data-test="aws-marketplace-setup-logo"]');
    expect(logo.exists()).toBe(true);
  });

  it("should show no_token state when no token is present", async () => {
    const wrapper = mountSetup();

    await flushPromises();

    expect(wrapper.vm.state).toBe("no_token");
    expect(wrapper.text()).toContain("No Marketplace Token Found");
  });

  it("should show select_org state when token is present", async () => {
    document.cookie = "aws_marketplace_token=test_token; path=/";

    const wrapper = mountSetup();

    await flushPromises();

    expect(wrapper.vm.state).toBe("select_org");
  });

  it("should display org selection UI in select_org state", async () => {
    document.cookie = "aws_marketplace_token=test_token; path=/";

    const wrapper = mountSetup();
    await flushPromises();

    expect(wrapper.text()).toContain("Complete AWS Marketplace Setup");
    expect(wrapper.text()).toContain("Create New Organization");
  });

  it("should render the create-org input and submit button", async () => {
    document.cookie = "aws_marketplace_token=test_token; path=/";

    const wrapper = mountSetup();
    await flushPromises();

    expect(wrapper.find('[data-test="aws-marketplace-org-name"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="aws-marketplace-create-link-btn"]').exists()).toBe(true);
  });

  it("should display processing state", async () => {
    const wrapper = mountSetup();

    wrapper.vm.state = "processing";
    await nextTick();

    expect(wrapper.text()).toContain("Setting up your subscription");
  });

  it("should display pending activation state", async () => {
    const wrapper = mountSetup();

    wrapper.vm.state = "pending_activation";
    await nextTick();

    expect(wrapper.text()).toContain("Waiting for AWS Confirmation");
  });

  it("should display success state", async () => {
    const wrapper = mountSetup();

    wrapper.vm.state = "success";
    await nextTick();

    expect(wrapper.text()).toContain("Subscription Activated");
    const icon = wrapper.findComponent({ name: "OIcon" });
    expect(icon.exists()).toBe(true);
    expect(icon.props("name")).toBe("check-circle");
  });

  it("should display error state with message", async () => {
    const wrapper = mountSetup();

    wrapper.vm.state = "error";
    wrapper.vm.errorMessage = "Test error message";
    await nextTick();

    expect(wrapper.text()).toContain("Test error message");
    const icon = wrapper.findComponent({ name: "OIcon" });
    expect(icon.exists()).toBe(true);
    expect(icon.props("name")).toBe("error");
  });

  it("should display payment failed state", async () => {
    const wrapper = mountSetup();

    wrapper.vm.state = "payment_failed";
    await nextTick();

    expect(wrapper.text()).toContain("Payment Failed");
  });

  it("should reset state when resetAndRetry is called", async () => {
    const wrapper = mountSetup();

    wrapper.vm.state = "error";
    wrapper.vm.errorMessage = "Test error";

    await wrapper.vm.resetAndRetry();

    expect(wrapper.vm.state).toBe("select_org");
    expect(wrapper.vm.errorMessage).toBe("");
  });

  it("should navigate to dashboard on goToDashboard", async () => {
    const routerPushSpy = vi.spyOn(router, "push");

    const wrapper = mountSetup();

    await wrapper.vm.goToDashboard();

    expect(routerPushSpy).toHaveBeenCalledWith({
      path: "/",
      query: undefined,
    });
  });

  it("should show eligible organizations when available", async () => {
    document.cookie = "aws_marketplace_token=test_token; path=/";
    (organizationsService.list as any).mockResolvedValue({
      data: {
        data: [
          { identifier: "org1", name: "Org 1" },
          { identifier: "org2", name: "Org 2" },
        ],
      },
    });

    const wrapper = mountSetup();
    await flushPromises();

    expect(wrapper.text()).toContain("Link to Existing Organization");
  });

  it("should use correct theme logo", async () => {
    const wrapper = mountSetup();

    const logo = wrapper.find('[data-test="aws-marketplace-setup-logo"]');
    expect(logo.attributes("src")).toContain("light");
  });

  it("should use dark theme logo when theme is dark", async () => {
    const darkStore = createStore({
      state: {
        theme: "dark",
        userInfo: { email: "test@example.com" },
      },
      actions: {
        setSelectedOrganization: vi.fn(),
      },
    });

    const wrapper = mount(AwsMarketplaceSetup, {
      global: {
        plugins: [darkStore, router, i18n],
      },
    });

    const logo = wrapper.find('[data-test="aws-marketplace-setup-logo"]');
    expect(logo.attributes("src")).toContain("dark");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Real-OForm validation wiring (playbook §5 / R22): mount the real OForm and
  // prove the Zod schema — not a button-disabled gate — blocks an empty submit.
  // This also guards the Options-API "schema returned from setup()" requirement
  // (an unwired `:schema` would resolve to undefined → always valid).
  describe("OForm schema validation (real forms)", () => {
    const mountSelectOrg = async (orgs: { identifier: string; name: string }[] = []) => {
      document.cookie = "aws_marketplace_token=test_token; path=/";
      (organizationsService.list as any).mockResolvedValue({
        data: { data: orgs },
      });
      const wrapper = mountSetup();
      await flushPromises();
      return wrapper;
    };

    it("create form: blocks submit + does NOT create an org when newOrgName is empty", async () => {
      const wrapper = await mountSelectOrg();
      const createForm = wrapper.findAllComponents({ name: "OForm" })[0];

      await (createForm.vm as any).form.handleSubmit();
      await flushPromises();

      expect((createForm.vm as any).form.state.isValid).toBe(false);
      expect(organizationsService.create).not.toHaveBeenCalled();
    });

    it("create form: submits + creates the org when newOrgName is provided", async () => {
      (organizationsService.create as any).mockResolvedValue({
        data: { identifier: "new-org" },
      });
      (awsMarketplace.linkSubscription as any).mockResolvedValue({
        data: { success: true, customer_identifier: "cust-1" },
      });

      const wrapper = await mountSelectOrg();
      const createForm = wrapper.findAllComponents({ name: "OForm" })[0];

      (createForm.vm as any).form.setFieldValue("newOrgName", "My New Org");
      await (createForm.vm as any).form.handleSubmit();
      await flushPromises();

      expect((createForm.vm as any).form.state.isValid).toBe(true);
      expect(organizationsService.create).toHaveBeenCalledWith({
        name: "My New Org",
      });
    });

    it("link form: blocks submit + does NOT link when no org is selected", async () => {
      const wrapper = await mountSelectOrg([{ identifier: "org1", name: "Org 1" }]);
      const linkForm = wrapper.findAllComponents({ name: "OForm" })[1];

      await (linkForm.vm as any).form.handleSubmit();
      await flushPromises();

      expect((linkForm.vm as any).form.state.isValid).toBe(false);
      expect(awsMarketplace.linkSubscription).not.toHaveBeenCalled();
    });

    it("link form: submits + links when an org is selected", async () => {
      (awsMarketplace.linkSubscription as any).mockResolvedValue({
        data: { success: true, customer_identifier: "cust-1" },
      });

      const wrapper = await mountSelectOrg([{ identifier: "org1", name: "Org 1" }]);
      const linkForm = wrapper.findAllComponents({ name: "OForm" })[1];

      (linkForm.vm as any).form.setFieldValue("selectedOrg", "org1");
      await (linkForm.vm as any).form.handleSubmit();
      await flushPromises();

      expect((linkForm.vm as any).form.state.isValid).toBe(true);
      expect(awsMarketplace.linkSubscription).toHaveBeenCalledWith("org1", "test_token");
    });
  });
});
