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

import { describe, expect, it, vi } from "vitest";
import { RouterLinkStub, shallowMount } from "@vue/test-utils";
import i18n from "@/locales";
import AppSidebar from "@/components/AppSidebar.vue";

vi.mock("@/utils/zincutils", async () => {
  const actual =
    await vi.importActual<typeof import("@/utils/zincutils")>(
      "@/utils/zincutils",
    );

  return {
    ...actual,
    getImageURL: vi.fn((path: string) => `/mock/${path}`),
  };
});

const dropdownStub = {
  template: `
    <div>
      <slot name="trigger" />
      <div data-test="dropdown-content"><slot /></div>
    </div>
  `,
};

const tableStub = {
  props: ["data"],
  template: `
    <div>
      <slot name="top" />
      <div v-for="row in data" :key="row.identifier">
        <slot name="cell-label" :row="row" :value="row.label" />
      </div>
      <slot name="bottom" />
    </div>
  `,
};

describe("AppSidebar", () => {
  const createWrapper = (overrides: any = {}) => {
    const buildType = overrides.buildType ?? "enterprise";
    const isEnterprise = overrides.isEnterprise ?? "true";
    const aiEnabled = overrides.aiEnabled ?? true;

    const store = {
      dispatch: vi.fn(),
      state: {
        theme: "light",
        isAiChatEnabled: false,
        selectedOrganization: {
          identifier: "default",
          label: "default",
        },
        organizationData: {
          quotaThresholdMsg: "",
        },
        zoConfig: {
          ai_enabled: aiEnabled,
          build_type: buildType,
          custom_hide_self_logo: false,
          custom_hide_menus: "",
          custom_logo_text: "",
          custom_logo_img: "",
          custom_logo_dark_img: "",
          ingestion_quota_used: 0,
        },
      },
      ...overrides.store,
    };

    const router = {
      currentRoute: {
        value: {
          path: "/logs",
          name: "logs",
        },
      },
      push: vi.fn(),
      ...overrides.router,
    };

    return shallowMount(AppSidebar, {
      global: {
        plugins: [i18n],
        stubs: {
          OButton: {
            template: '<button v-bind="$attrs"><slot /></button>',
          },
          OIcon: {
            props: ["name"],
            template: '<span :data-icon="name" />',
          },
          OTooltip: true,
          ODropdown: dropdownStub,
          ODropdownItem: {
            template:
              '<button v-bind="$attrs"><slot name="icon-left" /><slot /></button>',
          },
          ODropdownSeparator: true,
          OSearchInput: {
            template: "<input />",
          },
          OTable: tableStub,
          EnterpriseUpgradeDialog: true,
          RouterLink: RouterLinkStub,
        },
      },
      props: {
        store,
        router,
        config: {
          isEnterprise,
          isCloud: overrides.isCloud ?? "false",
        },
        user: {
          email: "root@example.com",
          given_name: "Root",
          family_name: "",
        },
        slackIcon: {
          template: "<span />",
        },
        zoBackendUrl: "http://localhost:5080",
        langList: [{ code: "en-gb", label: "English" }],
        selectedLanguage: { code: "en-gb", label: "English" },
        selectedOrg: {
          identifier: "default",
          label: "default",
        },
        userClickedOrg: {
          identifier: "default",
          label: "default",
        },
        organizations: [
          {
            identifier: "default",
            label: "default",
          },
        ],
        linksList: [
          {
            title: "Logs",
            icon: "search",
            link: "/logs",
            name: "logs",
          },
          {
            title: "Streams",
            icon: "window",
            link: "/streams",
            name: "streams",
          },
          {
            title: "Management",
            icon: "settings",
            link: "/settings",
            name: "settings",
          },
        ],
        isHovered: false,
        getBtnLogo: "/mock/ai.svg",
        collapsed: overrides.collapsed ?? false,
      },
    });
  };

  it("uses backend enterprise build_type for edition and AI visibility", () => {
    const wrapper = createWrapper();

    expect(wrapper.text()).toContain("Enterprise");
    expect(wrapper.find('[data-test="menu-link-ai-item"]').exists()).toBe(true);
  });

  it("keeps the sidebar AI icon wired to the shared animation class", () => {
    const wrapper = createWrapper();
    const aiIcon = wrapper.find('[data-test="menu-link-ai-item"] img');

    expect(aiIcon.classes()).toContain("app-sidebar__ai-icon");
    expect(aiIcon.classes()).toContain("ai-icon");
    expect(aiIcon.attributes("src")).toBe(
      "/mock/images/common/ai_icon_gradient.svg",
    );
  });

  it("does not swap the sidebar AI icon asset on hover", async () => {
    const wrapper = createWrapper();
    const aiButton = wrapper.find('[data-test="menu-link-ai-item"]');

    await aiButton.trigger("mouseenter");

    expect(wrapper.emitted("update:isHovered")).toBeUndefined();
  });

  it("uses backend opensource build_type even when the frontend flag is enterprise", () => {
    const wrapper = createWrapper({
      buildType: "opensource",
      isEnterprise: "true",
      aiEnabled: true,
    });

    const orgButton = wrapper.find(
      '[data-test="navbar-organizations-select-trigger"]',
    );

    expect(wrapper.text()).toContain("OSS");
    expect(wrapper.text()).toContain("Get OpenObserve Enterprise (Free)");
    expect(orgButton.attributes("aria-label")).not.toContain(
      "Get OpenObserve Enterprise (Free)",
    );
    expect(wrapper.find('[data-test="menu-link-ai-item"]').exists()).toBe(
      false,
    );
  });

  it("keeps collapsed navigation icon-only while preserving accessible labels", () => {
    const wrapper = createWrapper({ collapsed: true });
    const navLinks = wrapper.findAll("[data-sidebar-nav-link]");

    expect(wrapper.classes()).toContain("app-sidebar--collapsed");
    expect(wrapper.text()).toContain("ENT");
    expect(wrapper.find(".app-sidebar__nav-label").exists()).toBe(false);
    expect(navLinks[0].attributes("aria-label")).toBe("Logs - Current page");
  });

  it("keeps collapsed context controls icon-only while preserving accessible labels", () => {
    const wrapper = createWrapper({ collapsed: true });
    const orgButton = wrapper.find(
      '[data-test="navbar-organizations-select-trigger"]',
    );
    const aiButton = wrapper.find('[data-test="menu-link-ai-item"]');

    expect(orgButton.find(".app-sidebar__org-copy").exists()).toBe(false);
    expect(orgButton.find(".app-sidebar__org-chevron").exists()).toBe(false);
    expect(orgButton.attributes("aria-label")).toBe(
      "Organization: default, default",
    );
    expect(aiButton.find(".app-sidebar__ai-label").exists()).toBe(false);
    expect(aiButton.attributes("aria-label")).toBe("Ask O2 AI");
  });

  it("shows only the organization name in the expanded selector", () => {
    const wrapper = createWrapper();
    const orgButton = wrapper.find(
      '[data-test="navbar-organizations-select-trigger"]',
    );

    expect(orgButton.find(".app-sidebar__org-name").text()).toBe("default");
    expect(orgButton.find(".app-sidebar__org-id").exists()).toBe(false);
    expect(orgButton.attributes("aria-label")).toBe(
      "Organization: default, default",
    );
  });

  it("keeps the collapse control inside the brand block without a separate row", () => {
    const wrapper = createWrapper();
    const brand = wrapper.find(".app-sidebar__brand");
    const collapseButton = wrapper.find('[data-test="app-sidebar-collapse-btn"]');

    expect(collapseButton.exists()).toBe(true);
    expect(brand.find('[data-test="app-sidebar-collapse-btn"]').exists()).toBe(
      true,
    );
    expect(wrapper.find(".app-sidebar__collapse-row").exists()).toBe(false);
  });

  it("renders a shared delayed accent bar while the active item owns the selected surface", () => {
    const wrapper = createWrapper();
    const indicator = wrapper.find(".app-sidebar__nav-active-indicator");
    const activeLink = wrapper.find(".app-sidebar__nav-link--active");

    expect(indicator.exists()).toBe(true);
    expect(indicator.attributes("aria-hidden")).toBe("true");
    expect(activeLink.exists()).toBe(true);
  });

  it("marks the main Management navigation item active for settings routes", () => {
    const wrapper = createWrapper({
      router: {
        currentRoute: {
          value: {
            path: "/settings/general",
            name: "general",
          },
        },
        push: vi.fn(),
      },
    });

    const managementNavLink = wrapper.find(
      '[data-test="menu-link-/settings-item"]',
    );

    expect(managementNavLink.classes()).toContain(
      "app-sidebar__nav-link--active",
    );
    expect(managementNavLink.attributes("aria-current")).toBe("page");
    expect(managementNavLink.attributes("aria-label")).toContain(
      "Current page",
    );
    expect(wrapper.find('[data-test="menu-link-settings-item"]').exists()).toBe(
      false,
    );
  });

  it("emits stateful sidebar and AI actions", async () => {
    const wrapper = createWrapper();

    await wrapper
      .find('[data-test="app-sidebar-collapse-btn"]')
      .trigger("click");
    await wrapper.find('[data-test="menu-link-ai-item"]').trigger("click");

    expect(wrapper.emitted("update:collapsed")?.[0]).toEqual([true]);
    expect(wrapper.emitted("toggleAIChat")).toHaveLength(1);
  });
});
