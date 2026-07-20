// Copyright 2026 OpenObserve Inc.

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";


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

// The placement manifest is fetched at build time (absent in tests), so stub it.
// codex (no existing home) → real "ai-codex" entry pinned to top of Frameworks.
// openai → matches openai-python, so it MOVES to the top of Model Providers
// (reusing route ai-openai-python) and the original is removed (no duplicate).
vi.mock("@/components/ingestion/ai/content/manifest", () => ({
  manifestIntegrations: [
    { slug: "codex", name: "OpenAI Codex", category: "frameworks", order: 1, docURL: "", keywords: ["codex"] },
    { slug: "openai", name: "OpenAI", category: "model-providers", order: 1, docURL: "https://example.com/openai", keywords: ["openai"] },
  ],
  manifestCategories: [
    { slug: "frameworks", label: "AI Frameworks & Agents", order: 1 },
    { slug: "model-providers", label: "Model Providers", order: 2 },
  ],
}));

import AIIntegrations from "./AIIntegrations.vue";

describe("AIIntegrations", () => {
  let wrapper: VueWrapper;

  function mountComponent() {
    return mount(AIIntegrations, {
      global: {
        plugins: [store, i18n],
        stubs: {
          "OIcon": true,
          "router-view": true,
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
        wrapper.find('[data-test="ai-integrations-item-codex"]').exists(),
      ).toBe(true);
    });
  });

  describe("initial state", () => {
    it("should default to first category (manifest order → frameworks)", () => {
      expect(wrapper.vm.selectedCategory).toBe("frameworks");
    });

    it("should default to first integration route name", () => {
      expect(wrapper.vm.selectedIntegration).toBe("ai-codex");
    });

    it("should have empty search filter initially", () => {
      expect(wrapper.vm.integrationFilter).toBe("");
    });
  });

  describe("navigating to first integration", () => {
    it("should navigate to first integration on mount when route is ai-integrations", () => {
      expect(mockReplace).toHaveBeenCalledWith({
        name: "ai-codex",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    });
  });

  describe("category switching", () => {
    it("should update integration list when category changes", async () => {
      wrapper.vm.selectedCategory = "model-providers";
      await wrapper.vm.$nextTick();

      // OpenAI is pinned to the top of Model Providers by the manifest.
      expect(wrapper.vm.selectedIntegration).toBe("ai-openai-python");
      expect(mockReplace).toHaveBeenCalledWith({
        name: "ai-openai-python",
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
      // "codex" lives in the default-selected Popular category
      wrapper.vm.integrationFilter = "codex";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredIntegrations).toHaveLength(1);
      expect(wrapper.vm.filteredIntegrations[0].slug).toBe("codex");
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
      // langchain isn't in the mocked Popular manifest, so a deep link
      // resolves to its real category (frameworks).
      mockCurrentRoute.value = { name: "ai-langchain" };

      const syncedWrapper = mountComponent();

      expect(syncedWrapper.vm.selectedCategory).toBe("frameworks");
      expect(syncedWrapper.vm.selectedIntegration).toBe("ai-langchain");
      syncedWrapper.unmount();
    });
  });
});
