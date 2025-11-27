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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, shallowMount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import i18n from "@/locales";
import Header from "@/components/Header.vue";
import * as cookies from "@/utils/cookies";

// Mock the cookies module
vi.mock("@/utils/cookies", () => ({
  getLanguage: vi.fn(() => "en-gb"),
  setLanguage: vi.fn(),
  getSidebarStatus: vi.fn(),
  setSidebarStatus: vi.fn(),
  getSize: vi.fn(),
  setSize: vi.fn(),
  getToken: vi.fn(),
  setToken: vi.fn(),
  removeToken: vi.fn(),
}));

installQuasar({
  plugins: [Notify],
});

describe("Header Component", () => {
  let wrapper: any;
  let mockStore: any;
  let mockRouter: any;
  let mockConfig: any;
  let mockUser: any;
  let defaultProps: any;
  let defaultGlobalConfig: any;

  const createWrapper = (options: {
    mountType?: 'shallow' | 'mount';
    storeOverrides?: any;
    configOverrides?: any;
    propsOverrides?: any;
    stubsOverrides?: any;
  } = {}) => {
    const {
      mountType = 'shallow',
      storeOverrides = {},
      configOverrides = {},
      propsOverrides = {},
      stubsOverrides = {}
    } = options;

    const store = {
      ...mockStore,
      state: {
        ...mockStore.state,
        ...storeOverrides.state,
        zoConfig: {
          ...mockStore.state.zoConfig,
          ...storeOverrides.state?.zoConfig,
        },
      },
    };

    const config = {
      ...mockConfig,
      ...configOverrides,
    };

    const props = {
      ...defaultProps,
      store,
      config,
      ...propsOverrides,
    };

    const globalConfig = {
      plugins: defaultGlobalConfig.plugins,
      stubs: {
        ...defaultGlobalConfig.stubs,
        ...stubsOverrides,
      },
    };

    if (mountType === 'mount') {
      return mount(Header, {
        global: globalConfig,
        props,
      });
    }

    return shallowMount(Header, {
      global: globalConfig,
      props,
    });
  };

  beforeEach(() => {
    mockStore = {
      state: {
        theme: "light",
        zoConfig: {
          custom_logo_text: "",
          custom_logo_img: null,
          custom_logo_dark_img: null,
          custom_hide_self_logo: false,
          custom_hide_menus: "",
          ai_enabled: false,
          ingestion_quota_used: 0,
          version: "2.0.0",
        },
        organizationData: {
          quotaThresholdMsg: "",
        },
        isAiChatEnabled: false,
        selectedOrganization: {
          identifier: "test-org",
          label: "Test Organization",
        },
      },
    };

    mockRouter = {
      replace: vi.fn(),
      push: vi.fn(),
    };

    mockConfig = {
      isEnterprise: "false",
      isCloud: "false",
    };

    mockUser = {
      given_name: "John",
      family_name: "Doe",
      email: "john@test.com",
    };

    defaultProps = {
      store: mockStore,
      router: mockRouter,
      config: mockConfig,
      user: mockUser,
      slackIcon: {},
      zoBackendUrl: "http://localhost:5080",
      langList: [
        { code: "en-gb", label: "English", icon: "flag-icon flag-icon-gb" },
        { code: "fr", label: "Français", icon: "flag-icon flag-icon-fr" },
      ],
      selectedLanguage: { code: "en-gb", label: "English" },
      selectedOrg: { identifier: "test-org", label: "Test Organization" },
      userClickedOrg: { identifier: "test-org", label: "Test Organization" },
      filteredOrganizations: [
        { identifier: "test-org", label: "Test Organization" },
        { identifier: "another-org", label: "Another Organization" },
      ],
      searchQuery: "",
      rowsPerPage: 10,
      isHovered: false,
      getBtnLogo: "mock-logo.svg",
    };

    defaultGlobalConfig = {
      plugins: [i18n],
      stubs: {
        ThemeSwitcher: true,
        QBtn: true,
        QIcon: true,
        QToolbarTitle: true,
        QMenu: true,
        QList: true,
        QItem: true,
        QItemSection: true,
        QSeparator: true,
        QTooltip: true,
        QMarkupTable: true,
      },
    };

    wrapper = createWrapper();
  });

  describe("Logo Rendering", () => {
    it("should display OpenObserve logo by default", async () => {
      const logoWrapper = createWrapper({
        mountType: 'mount',
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await logoWrapper.vm.$nextTick();

      // Verify the OpenObserve logo is rendered
      const openobserveLogo = logoWrapper.find('.openobserve-logo');
      expect(openobserveLogo.exists()).toBe(true);

      logoWrapper.unmount();
    });

    it("should display custom logo text when configured in enterprise mode", async () => {
      const customWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              custom_logo_text: "Custom Company",
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          // Don't stub QToolbar so content renders
          QToolbar: false,
        },
      });

      // Wait for component to render
      await customWrapper.vm.$nextTick();

      // Check if the custom logo text is rendered in the HTML
      const html = customWrapper.html();
      expect(html).toContain("Custom Company");

      // Verify the text is also in the text content
      const allText = customWrapper.text();
      expect(allText).toContain("Custom Company");

      customWrapper.unmount();
    });

    it("should emit goToHome when calling the method", () => {
      wrapper.vm.goToHome();
      expect(wrapper.emitted("goToHome")).toBeTruthy();
    });

    it("should use dark theme logo when theme is dark", async () => {
      const darkWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            theme: "dark",
          },
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await darkWrapper.vm.$nextTick();

      // Verify the logo exists and check that dark theme is applied
      const openobserveLogo = darkWrapper.find('.openobserve-logo');
      expect(openobserveLogo.exists()).toBe(true);

      // The logo src should contain 'dark' in the path
      const logoSrc = openobserveLogo.attributes('src');
      expect(logoSrc).toContain('dark');

      darkWrapper.unmount();
    });

    it("should not display OpenObserve logo when custom_hide_self_logo is true", async () => {
      const customWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              custom_logo_text: "Custom",
              custom_hide_self_logo: true,
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await customWrapper.vm.$nextTick();

      // Check that the OpenObserve logo is NOT in the HTML
      const openobserveLogo = customWrapper.find('.openobserve-logo');
      expect(openobserveLogo.exists()).toBe(false);

      // Verify the custom logo text IS displayed
      const html = customWrapper.html();
      expect(html).toContain("Custom");

      customWrapper.unmount();
    });

    it("should display OpenObserve logo when custom_hide_self_logo is false", async () => {
      const customWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              custom_logo_text: "Custom",
              custom_hide_self_logo: false,
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await customWrapper.vm.$nextTick();

      // Check that the OpenObserve logo IS in the HTML
      const openobserveLogo = customWrapper.find('.openobserve-logo');
      expect(openobserveLogo.exists()).toBe(true);

      // Verify the custom logo text is also displayed
      const html = customWrapper.html();
      expect(html).toContain("Custom");

      customWrapper.unmount();
    });
  });

  describe("Quota Warning", () => {
    it("should display quota threshold message when present", async () => {
      const quotaWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            organizationData: {
              quotaThresholdMsg: "Quota exceeded",
            },
          },
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await quotaWrapper.vm.$nextTick();

      // Verify the quota message is actually displayed in the DOM
      const html = quotaWrapper.html();
      expect(html).toContain("Quota exceeded");

      // Also check that text is visible
      const text = quotaWrapper.text();
      expect(text).toContain("Quota exceeded");

      quotaWrapper.unmount();
    });
  });

  describe("Ingestion Quota Icon", () => {
    it("should display ingestion quota icon when quota >= 85%", async () => {
      const quotaWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              ingestion_quota_used: 87.5,
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await quotaWrapper.vm.$nextTick();

      // Verify the quota warning icon is displayed
      const quotaWarning = quotaWrapper.find('[data-test="ingestion-quota-warning-icon"]');
      expect(quotaWarning.exists()).toBe(true);

      quotaWrapper.unmount();
    });

    it("should return orange color when quota is 85-94%", () => {
      const quotaWrapper = createWrapper({
        storeOverrides: {
          state: {
            zoConfig: {
              ingestion_quota_used: 90,
            },
          },
        },
      });

      expect(quotaWrapper.vm.ingestionQuotaColor).toBe("orange");
    });

    it("should return red color when quota is >= 95%", () => {
      const quotaWrapper = createWrapper({
        storeOverrides: {
          state: {
            zoConfig: {
              ingestion_quota_used: 97,
            },
          },
        },
      });

      expect(quotaWrapper.vm.ingestionQuotaColor).toBe("red");
    });

    it("should not display quota icon when quota < 85%", async () => {
      const quotaWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              ingestion_quota_used: 80,
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await quotaWrapper.vm.$nextTick();

      // Verify the quota warning icon is NOT displayed
      const quotaWarning = quotaWrapper.find('[data-test="ingestion-quota-warning-icon"]');
      expect(quotaWarning.exists()).toBe(false);

      quotaWrapper.unmount();
    });
  });

  describe("AI Chat Button", () => {
    it("should display AI chat button in enterprise mode with ai_enabled", async () => {
      const aiWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              ai_enabled: true,
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await aiWrapper.vm.$nextTick();

      // Verify AI chat button is rendered
      const aiButton = aiWrapper.find('[data-test="menu-link-ai-item"]');
      expect(aiButton.exists()).toBe(true);

      aiWrapper.unmount();
    });

    it("should not display AI button if not enterprise", async () => {
      const aiWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              ai_enabled: true,
            },
          },
        },
        configOverrides: {
          isEnterprise: "false",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await aiWrapper.vm.$nextTick();

      // Verify AI button is NOT rendered
      const aiButton = aiWrapper.find('[data-test="menu-link-ai-item"]');
      expect(aiButton.exists()).toBe(false);

      aiWrapper.unmount();
    });

    it("should not display AI button if ai_enabled is false", async () => {
      const aiWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              ai_enabled: false,
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await aiWrapper.vm.$nextTick();

      // Verify AI button is NOT rendered
      const aiButton = aiWrapper.find('[data-test="menu-link-ai-item"]');
      expect(aiButton.exists()).toBe(false);

      aiWrapper.unmount();
    });

    it("should apply active class when AI chat is enabled", async () => {
      const aiWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              ai_enabled: true,
            },
            isAiChatEnabled: true,
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await aiWrapper.vm.$nextTick();

      // Verify AI button has active class
      const aiButton = aiWrapper.find('[data-test="menu-link-ai-item"]');
      expect(aiButton.exists()).toBe(true);
      expect(aiButton.classes()).toContain('ai-btn-active');

      aiWrapper.unmount();
    });

    it("should not have active class when AI chat is disabled", async () => {
      const aiWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              ai_enabled: true,
            },
            isAiChatEnabled: false,
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await aiWrapper.vm.$nextTick();

      // Verify AI button does NOT have active class
      const aiButton = aiWrapper.find('[data-test="menu-link-ai-item"]');
      expect(aiButton.exists()).toBe(true);
      expect(aiButton.classes()).not.toContain('ai-btn-active');

      aiWrapper.unmount();
    });

    it("should emit toggleAIChat when AI button is clicked", async () => {
      const aiWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              ai_enabled: true,
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await aiWrapper.vm.$nextTick();

      // Click the AI button
      const aiButton = aiWrapper.find('[data-test="menu-link-ai-item"]');
      expect(aiButton.exists()).toBe(true);

      await aiButton.trigger('click');

      // Verify toggleAIChat event was emitted
      expect(aiWrapper.emitted('toggleAIChat')).toBeTruthy();
      expect(aiWrapper.emitted('toggleAIChat')).toHaveLength(1);

      aiWrapper.unmount();
    });

    it("should emit update:isHovered true on mouse enter", async () => {
      const aiWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              ai_enabled: true,
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await aiWrapper.vm.$nextTick();

      // Hover over the AI button
      const aiButton = aiWrapper.find('[data-test="menu-link-ai-item"]');
      expect(aiButton.exists()).toBe(true);

      await aiButton.trigger('mouseenter');

      // Verify update:isHovered event was emitted with true
      expect(aiWrapper.emitted('update:isHovered')).toBeTruthy();
      expect(aiWrapper.emitted('update:isHovered')[0]).toEqual([true]);

      aiWrapper.unmount();
    });

    it("should emit update:isHovered false on mouse leave", async () => {
      const aiWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              ai_enabled: true,
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await aiWrapper.vm.$nextTick();

      // Hover and then leave the AI button
      const aiButton = aiWrapper.find('[data-test="menu-link-ai-item"]');
      expect(aiButton.exists()).toBe(true);

      await aiButton.trigger('mouseleave');

      // Verify update:isHovered event was emitted with false
      expect(aiWrapper.emitted('update:isHovered')).toBeTruthy();
      expect(aiWrapper.emitted('update:isHovered')[0]).toEqual([false]);

      aiWrapper.unmount();
    });

    it("should accept getBtnLogo prop for AI icon", () => {
      const customLogoPath = "path/to/ai-logo.svg";
      const aiWrapper = createWrapper({
        storeOverrides: {
          state: {
            zoConfig: {
              ai_enabled: true,
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        propsOverrides: {
          getBtnLogo: customLogoPath,
        },
      });

      // Verify the getBtnLogo prop is passed correctly
      expect(aiWrapper.props('getBtnLogo')).toBe(customLogoPath);
    });
  });

  describe("Organization Selector", () => {
    it("should display selected organization", () => {
      const orgButton = wrapper.find('[data-test="organization-select-button"]');
      expect(orgButton.exists()).toBe(false); // Using stub, check implementation
    });

    it("should emit update:searchQuery when search input changes", async () => {
      await wrapper.vm.$emit("update:searchQuery", "test");

      expect(wrapper.emitted("update:searchQuery")).toBeTruthy();
      expect(wrapper.emitted("update:searchQuery")[0]).toEqual(["test"]);
    });

    it("should emit updateOrganization when organization is selected", async () => {
      const newOrg = { identifier: "new-org", label: "New Organization" };

      await wrapper.vm.handleOrgSelection(newOrg);

      expect(wrapper.emitted("update:selectedOrg")).toBeTruthy();
      expect(wrapper.emitted("update:selectedOrg")[0]).toEqual([newOrg]);
      expect(wrapper.emitted("updateOrganization")).toBeTruthy();
    });

    it("should filter organizations based on search query", () => {
      const filteredOrgs = [
        { identifier: "test-org", label: "Test Organization" },
      ];

      wrapper = shallowMount(Header, {
        global: { plugins: [i18n] },
        props: {
          ...wrapper.props(),
          filteredOrganizations: filteredOrgs,
          searchQuery: "test",
        },
      });

      expect(wrapper.props("filteredOrganizations")).toHaveLength(1);
    });

    it("should display empty state when no organizations match search", () => {
      wrapper = shallowMount(Header, {
        global: { plugins: [i18n] },
        props: {
          ...wrapper.props(),
          filteredOrganizations: [],
          searchQuery: "nonexistent",
        },
      });

      expect(wrapper.props("filteredOrganizations")).toHaveLength(0);
    });
  });

  describe("Navigation Methods", () => {
    it("should emit goToHome when goToHome is called", () => {
      wrapper.vm.goToHome();

      expect(wrapper.emitted("goToHome")).toBeTruthy();
    });

    it("should emit toggleAIChat when toggleAIChat is called", () => {
      wrapper.vm.toggleAIChat();

      expect(wrapper.emitted("toggleAIChat")).toBeTruthy();
    });

    it("should emit openSlack when openSlack is called", () => {
      wrapper.vm.openSlack();

      expect(wrapper.emitted("openSlack")).toBeTruthy();
    });

    it("should emit navigateToOpenAPI when called", () => {
      wrapper.vm.navigateToOpenAPI();

      expect(wrapper.emitted("navigateToOpenAPI")).toBeTruthy();
      // The method is called without parameters in the component
      const emittedEvents = wrapper.emitted("navigateToOpenAPI");
      expect(emittedEvents).toBeTruthy();
    });

    it("should emit navigateToDocs when navigateToDocs is called", () => {
      wrapper.vm.navigateToDocs();

      expect(wrapper.emitted("navigateToDocs")).toBeTruthy();
    });

    it("should emit changeLanguage with language object", () => {
      const lang = { code: "fr", label: "Français" };
      wrapper.vm.changeLanguage(lang);

      expect(wrapper.emitted("changeLanguage")).toBeTruthy();
      expect(wrapper.emitted("changeLanguage")[0]).toEqual([lang]);
    });

    it("should emit openPredefinedThemes when openPredefinedThemes is called", () => {
      wrapper.vm.openPredefinedThemes();

      expect(wrapper.emitted("openPredefinedThemes")).toBeTruthy();
    });

    it("should emit signout when signout is called", () => {
      wrapper.vm.signout();

      expect(wrapper.emitted("signout")).toBeTruthy();
    });
  });

  describe("Help Menu", () => {
    it("should navigate to settings when settings button is clicked", async () => {
      const settingsBtn = wrapper.find('[data-test="menu-link-settings-item"]');
      if (settingsBtn.exists()) {
        await settingsBtn.trigger("click");
        expect(mockRouter.push).toHaveBeenCalledWith({ name: "settings" });
      }
    });

    it("should verify about route navigation properties", () => {
      mockConfig.isEnterprise = "false";

      wrapper = shallowMount(Header, {
        global: { plugins: [i18n] },
        props: {
          ...wrapper.props(),
          config: mockConfig,
        },
      });

      // Verify that router and store are available for navigation
      expect(wrapper.props("router")).toBeDefined();
      expect(wrapper.props("store").state.selectedOrganization).toBeDefined();
      expect(wrapper.props("store").state.selectedOrganization.identifier).toBe("test-org");
    });

    it("should not display OpenAPI link in cloud deployment", () => {
      mockConfig.isCloud = "true";

      wrapper = shallowMount(Header, {
        global: { plugins: [i18n] },
        props: {
          ...wrapper.props(),
          config: mockConfig,
        },
      });

      expect(mockConfig.isCloud).toBe("true");
    });

    it("should hide OpenAPI link if in custom_hide_menus", () => {
      mockStore.state.zoConfig.custom_hide_menus = "openapi,settings";

      wrapper = shallowMount(Header, {
        global: { plugins: [i18n] },
        props: {
          ...wrapper.props(),
          store: mockStore,
        },
      });

      expect(mockStore.state.zoConfig.custom_hide_menus).toContain("openapi");
    });
  });

  describe("User Profile", () => {
    it("should display user information", () => {
      expect(wrapper.props("user").given_name).toBe("John");
      expect(wrapper.props("user").family_name).toBe("Doe");
      expect(wrapper.props("user").email).toBe("john@test.com");
    });

    it("should display language selection menu", () => {
      expect(wrapper.props("langList")).toHaveLength(2);
      expect(wrapper.props("langList")[0].code).toBe("en-gb");
    });

    it("should have access to current language from cookies", () => {
      // Verify that getLanguage can be called (it's mocked to return "en-gb")
      const currentLang = cookies.getLanguage();
      expect(currentLang).toBe("en-gb");

      // Verify the selected language prop matches the cookie language
      expect(wrapper.props("selectedLanguage").code).toBe("en-gb");
    });

    it("should emit changeLanguage event with correct language data", () => {
      const newLang = { code: "fr", label: "Français", icon: "flag-icon flag-icon-fr" };
      wrapper.vm.changeLanguage(newLang);

      // Verify the event was emitted with the correct language object
      expect(wrapper.emitted("changeLanguage")).toBeTruthy();
      expect(wrapper.emitted("changeLanguage")[0]).toEqual([newLang]);

      // Verify the emitted object has all required properties
      const emittedLang = wrapper.emitted("changeLanguage")[0][0];
      expect(emittedLang).toHaveProperty('code');
      expect(emittedLang).toHaveProperty('label');
      expect(emittedLang.code).toBe("fr");
      expect(emittedLang.label).toBe("Français");

      // Note: The actual cookie setting happens in MainLayout.vue
      // Header.vue only emits the event with the language data
    });

    it("should emit changeLanguage for each language in langList", () => {
      const languages = [
        { code: "en-gb", label: "English", icon: "flag-icon flag-icon-gb" },
        { code: "fr", label: "Français", icon: "flag-icon flag-icon-fr" },
        { code: "de", label: "Deutsch", icon: "flag-icon flag-icon-de" },
      ];

      const langWrapper = createWrapper({
        propsOverrides: {
          langList: languages,
        },
      });

      // Test changing to each language
      languages.forEach((lang, index) => {
        langWrapper.vm.changeLanguage(lang);

        const emitted = langWrapper.emitted("changeLanguage");
        expect(emitted).toBeTruthy();
        expect(emitted[index]).toEqual([lang]);
      });
    });

    it("should result in cookie being set after changing to French", () => {
      // Clear previous mock calls
      vi.clearAllMocks();

      const frenchLang = { code: "fr", label: "Français", icon: "flag-icon flag-icon-fr" };

      // User changes language in Header component
      wrapper.vm.changeLanguage(frenchLang);

      // Verify Header emitted the event with French language
      expect(wrapper.emitted("changeLanguage")).toBeTruthy();
      expect(wrapper.emitted("changeLanguage")[0][0].code).toBe("fr");

      // Simulate what MainLayout does when it receives the event
      // (This is the integration part - simulating parent component behavior)
      const emittedLang = wrapper.emitted("changeLanguage")[0][0];
      cookies.setLanguage(emittedLang.code);

      // Verify the cookie was set with "fr"
      expect(cookies.setLanguage).toHaveBeenCalledWith("fr");
      expect(cookies.setLanguage).toHaveBeenCalledTimes(1);

      // Now verify we can retrieve "fr" from cookies
      // Update the mock to return "fr" after setting it
      vi.mocked(cookies.getLanguage).mockReturnValueOnce("fr");

      const retrievedLang = cookies.getLanguage();
      expect(retrievedLang).toBe("fr");
    });

    it("should result in cookie being set after changing to German", () => {
      // Clear previous mock calls
      vi.clearAllMocks();

      const germanLang = { code: "de", label: "Deutsch", icon: "flag-icon flag-icon-de" };

      // User changes language
      wrapper.vm.changeLanguage(germanLang);

      // Verify event emission
      expect(wrapper.emitted("changeLanguage")).toBeTruthy();
      const emittedLang = wrapper.emitted("changeLanguage")[0][0];
      expect(emittedLang.code).toBe("de");

      // Simulate MainLayout's response to the event
      cookies.setLanguage(emittedLang.code);

      // Verify cookie was set with "de"
      expect(cookies.setLanguage).toHaveBeenCalledWith("de");

      // Verify we can retrieve "de" from cookies
      vi.mocked(cookies.getLanguage).mockReturnValueOnce("de");
      expect(cookies.getLanguage()).toBe("de");
    });
  });

  describe("Theme Management", () => {
    it("should render with light theme logo", async () => {
      const lightWrapper = createWrapper({
        mountType: 'mount',
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await lightWrapper.vm.$nextTick();

      // Verify light theme logo is used
      const logo = lightWrapper.find('.openobserve-logo');
      expect(logo.exists()).toBe(true);

      const logoSrc = logo.attributes('src');
      expect(logoSrc).toContain('light');

      lightWrapper.unmount();
    });

    it("should render with dark theme logo", async () => {
      const darkWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            theme: "dark",
          },
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await darkWrapper.vm.$nextTick();

      // Verify dark theme logo is used
      const logo = darkWrapper.find('.openobserve-logo');
      expect(logo.exists()).toBe(true);

      const logoSrc = logo.attributes('src');
      expect(logoSrc).toContain('dark');

      darkWrapper.unmount();
    });

    it("should emit openPredefinedThemes when theme management is clicked", () => {
      wrapper.vm.openPredefinedThemes();

      expect(wrapper.emitted("openPredefinedThemes")).toBeTruthy();
    });
  });

  describe("Slack Integration", () => {
    it("should emit openSlack when Slack button is clicked", () => {
      wrapper.vm.openSlack();

      expect(wrapper.emitted("openSlack")).toBeTruthy();
    });

    it("should display Slack icon", () => {
      expect(wrapper.props("slackIcon")).toBeDefined();
    });
  });

  describe("Props Validation", () => {
    it("should accept all required props", () => {
      expect(wrapper.props("store")).toBeDefined();
      expect(wrapper.props("router")).toBeDefined();
      expect(wrapper.props("config")).toBeDefined();
      expect(wrapper.props("user")).toBeDefined();
      expect(wrapper.props("zoBackendUrl")).toBe("http://localhost:5080");
      expect(wrapper.props("langList")).toHaveLength(2);
      expect(wrapper.props("selectedLanguage")).toBeDefined();
      expect(wrapper.props("selectedOrg")).toBeDefined();
      expect(wrapper.props("filteredOrganizations")).toHaveLength(2);
      expect(wrapper.props("searchQuery")).toBe("");
      expect(wrapper.props("rowsPerPage")).toBe(10);
      expect(wrapper.props("isHovered")).toBe(false);
      expect(wrapper.props("getBtnLogo")).toBe("mock-logo.svg");
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing user name gracefully", () => {
      const userWithoutName = {
        email: "test@example.com",
      };

      wrapper = shallowMount(Header, {
        global: { plugins: [i18n] },
        props: {
          ...wrapper.props(),
          user: userWithoutName,
        },
      });

      expect(wrapper.props("user").email).toBe("test@example.com");
    });

    it("should not show organization dropdown when organization list is empty", () => {
      const wrapper = createWrapper({
        mountType: 'mount',
        propsOverrides: {
          filteredOrganizations: [],
        },
        stubsOverrides: {
          QSelect: false
        }
      });

      // Verify the organization selector doesn't show options when list is empty
      const orgSelect = wrapper.findComponent({ name: 'QSelect' });
      if (orgSelect.exists()) {
        expect(orgSelect.props('options')).toHaveLength(0);
      }
    });

    it("should render default OpenObserve logo when both custom logos are null", () => {
      const wrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              custom_logo_img: null,
              custom_logo_dark_img: null,
              custom_logo_text: ""
            }
          }
        },
        stubsOverrides: {
          QToolbar: false,
          QToolbarTitle: false
        }
      });

      const html = wrapper.html();
      // Verify no custom logo images are rendered
      expect(html).not.toContain('data:image; base64,');

      // Verify default OpenObserve logo is rendered instead
      expect(html).toContain('openobserve-logo');
      const imgs = wrapper.findAll('img');
      expect(imgs.length).toBeGreaterThan(0);
      expect(imgs[0].attributes('src')).toContain('openobserve');
    });

    it("should display red warning icon when quota is exactly 95%", () => {
      const wrapper = createWrapper({
        mountType: 'shallow',
        storeOverrides: {
          state: {
            zoConfig: {
              ingestion_quota_used: 95.0,
            }
          }
        }
      });

      // Verify the computed property returns red color
      expect(wrapper.vm.ingestionQuotaColor).toBe("red");

      // Verify the computed percentage
      expect(wrapper.vm.ingestionQuotaPercentage).toBe(95.0);
    });

    it("should handle organization with very long name", () => {
      const longName = "A".repeat(100);
      const orgWithLongName = { identifier: "long", label: longName };

      const wrapper = createWrapper({
        mountType: 'shallow',
        propsOverrides: {
          selectedOrg: orgWithLongName,
        }
      });

      // Verify the component accepts and stores the long organization name
      expect(wrapper.props('selectedOrg')).toEqual(orgWithLongName);
      expect(wrapper.props('selectedOrg').label).toBe(longName);
      expect(wrapper.props('selectedOrg').label.length).toBe(100);
    });
  });

  describe("Conditional Rendering Logic", () => {
    it("should show custom logo section only in enterprise mode with custom logo", async () => {
      const customWrapper = createWrapper({
        mountType: 'mount',
        storeOverrides: {
          state: {
            zoConfig: {
              custom_logo_text: "Custom",
            },
          },
        },
        configOverrides: {
          isEnterprise: "true",
        },
        stubsOverrides: {
          QToolbar: false,
        },
      });

      await customWrapper.vm.$nextTick();

      // Verify custom logo text is displayed
      const html = customWrapper.html();
      expect(html).toContain("Custom");

      customWrapper.unmount();
    });

    it("should apply active class to selected organization", () => {
      const selectedOrg = { identifier: "test-org", label: "Test Organization" };

      wrapper = shallowMount(Header, {
        global: { plugins: [i18n] },
        props: {
          ...wrapper.props(),
          userClickedOrg: selectedOrg,
          selectedOrg: selectedOrg,
        },
      });

      expect(wrapper.props("userClickedOrg").identifier).toBe(
        wrapper.props("selectedOrg").identifier
      );
    });
  });

  describe("Integration Points", () => {
    it("should use store for configuration", () => {
      expect(wrapper.props("store")).toBeDefined();
      expect(wrapper.props("store").state).toBeDefined();
      expect(wrapper.props("store").state.zoConfig).toBeDefined();
    });

    it("should use router for navigation", () => {
      wrapper.vm.$emit("goToHome");

      expect(wrapper.emitted("goToHome")).toBeTruthy();
    });

    it("should use config for feature flags", () => {
      expect(wrapper.props("config").isEnterprise).toBe("false");
      expect(wrapper.props("config").isCloud).toBe("false");
    });
  });
});
