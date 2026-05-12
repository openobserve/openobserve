// Copyright 2026 OpenObserve Inc.

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

installQuasar();

const mockReplace = vi.fn();
const mockCurrentRoute = { value: { name: "ai-integrations" } };
const mockRoute = { name: "ai-integrations" };

vi.mock("vue-router", () => ({
  useRouter: () => ({
    currentRoute: mockCurrentRoute,
    replace: mockReplace,
  }),
  useRoute: () => mockRoute,
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, useQuasar: () => ({ notify: vi.fn() }) };
});

import AIIntegrations from "./AIIntegrations.vue";

describe("AIIntegrations", () => {
  let wrapper: VueWrapper;

  function mountComponent() {
    return mount(AIIntegrations, {
      global: {
        plugins: [store, i18n],
        stubs: {
          "q-input": true,
          "q-icon": true,
          "router-view": true,
          "q-tabs": {
            template: '<div class="q-tabs-stub"><slot /></div>',
          },
          "q-tab": {
            template:
              '<div class="q-tab-stub" :data-test="$attrs[\'data-test\']">{{ $attrs.label }}</div>',
            inheritAttrs: false,
          },
        },
      },
    });
  }

  beforeEach(() => {
    mockReplace.mockClear();
    mockCurrentRoute.value = { name: "ai-integrations" };
    wrapper = mountComponent();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the search input", () => {
      expect(
        wrapper.find('[data-test="ai-integrations-search-input"]').exists(),
      ).toBe(true);
    });

    it("should render category tabs", () => {
      expect(
        wrapper
          .find('[data-test="ai-integrations-category-frameworks"]')
          .exists(),
      ).toBe(true);
    });

    it("should render integration tabs", () => {
      expect(
        wrapper.find('[data-test="ai-integrations-item-agno"]').exists(),
      ).toBe(true);
    });
  });

  describe("initial state", () => {
    it("should default to first category", () => {
      expect(wrapper.vm.selectedCategory).toBe("frameworks");
    });

    it("should default to first integration route name", () => {
      expect(wrapper.vm.selectedIntegration).toBe("ai-agno");
    });

    it("should have empty search filter initially", () => {
      expect(wrapper.vm.integrationFilter).toBe("");
    });
  });

  describe("navigating to first integration", () => {
    it("should navigate to first integration on mount when route is ai-integrations", () => {
      expect(mockReplace).toHaveBeenCalledWith({
        name: "ai-agno",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    });
  });

  describe("category switching", () => {
    it("should update integration list when category changes", async () => {
      wrapper.vm.selectedCategory = "model-providers";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedIntegration).toBe("ai-anthropic-python");
      expect(mockReplace).toHaveBeenCalledWith({
        name: "ai-anthropic-python",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    });

    it("should clear search filter when category changes", async () => {
      wrapper.vm.integrationFilter = "openai";
      wrapper.vm.selectedCategory = "model-providers";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.integrationFilter).toBe("");
    });
  });

  describe("integration filtering", () => {
    it("should return all integrations when filter is empty", () => {
      const count = wrapper.vm.filteredIntegrations.length;
      expect(count).toBeGreaterThan(0);
    });

    it("should filter integrations by name (case insensitive)", async () => {
      wrapper.vm.integrationFilter = "agno";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredIntegrations).toHaveLength(1);
      expect(wrapper.vm.filteredIntegrations[0].slug).toBe("agno");
    });

    it("should return empty when no match found", async () => {
      wrapper.vm.integrationFilter = "nonexistent";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredIntegrations).toHaveLength(0);
    });
  });

  describe("navigation", () => {
    it("should navigate to integration on tab click", () => {
      wrapper.vm.navigateToIntegration("ai-langchain");

      expect(mockReplace).toHaveBeenCalledWith({
        name: "ai-langchain",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    });
  });

  describe("route sync on mount", () => {
    it("should sync selectedCategory from current route", () => {
      mockCurrentRoute.value = { name: "ai-langchain" };

      const syncedWrapper = mountComponent();

      expect(syncedWrapper.vm.selectedCategory).toBe("frameworks");
      expect(syncedWrapper.vm.selectedIntegration).toBe("ai-langchain");
      syncedWrapper.unmount();
    });
  });
});
