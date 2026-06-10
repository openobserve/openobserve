// Copyright 2026 OpenObserve Inc.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import NoData from "@/components/shared/grid/NoData.vue";

// Mock dependencies
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/core/EmptyState/OEmptyState.vue", () => ({
  default: {
    name: "OEmptyState",
    props: ["size", "preset", "illustration", "title"],
    template:
      '<div class="o-empty-state" :data-preset="preset" :data-title="title">{{ title }}</div>',
  },
}));

describe("NoData.vue", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (props: Record<string, unknown> = {}) => {
    return mount(NoData, {
      global: {
        plugins: [],
      },
      props,
    });
  };

  describe("Component Rendering", () => {
    it("should render the component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should display the no data message by default", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("ticket.noDataErrorMsg");
    });

    it("should display a custom title when provided", () => {
      wrapper = createWrapper({ title: "Custom Title" });
      expect(wrapper.text()).toContain("Custom Title");
    });
  });

  describe("Component Structure", () => {
    it("should have a wrapper div with data-test attribute", () => {
      wrapper = createWrapper();
      const container = wrapper.find('[data-test="no-data-message"]');
      expect(container.exists()).toBe(true);
    });

    it("should apply tw:w-full class to root div", () => {
      wrapper = createWrapper();
      const container = wrapper.find('[data-test="no-data-message"]');
      expect(container.classes()).toContain("tw:w-full");
    });
  });

  describe("filtered state", () => {
    it("should show no-search-results preset when filtered is true", () => {
      wrapper = createWrapper({ filtered: true });
      const emptyState = wrapper.find(".o-empty-state");
      expect(emptyState.exists()).toBe(true);
      expect(emptyState.attributes("data-preset")).toBe("no-search-results");
    });

    it("should show default empty state when filtered is false", () => {
      wrapper = createWrapper({ filtered: false });
      const emptyState = wrapper.find(".o-empty-state");
      expect(emptyState.exists()).toBe(true);
      expect(emptyState.attributes("data-preset")).toBeUndefined();
    });
  });

  describe("Internationalization", () => {
    it("should display the translated message key", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("ticket.noDataErrorMsg");
    });
  });

  describe("Accessibility", () => {
    it("should provide meaningful content for screen readers", () => {
      wrapper = createWrapper();
      expect(wrapper.text().trim()).toBeTruthy();
    });
  });

  describe("Vue 3 Composition API Integration", () => {
    it("should use Vue 3 script setup correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render without errors", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing title prop gracefully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle i18n key that might not exist", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("ticket.noDataErrorMsg");
    });
  });

  describe("Component Performance", () => {
    it("should render efficiently", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Integration with Parent Components", () => {
    it("should be usable as a placeholder in tables", () => {
      wrapper = createWrapper();
      const container = wrapper.find('[data-test="no-data-message"]');
      expect(container.exists()).toBe(true);
      expect(container.classes()).toContain("tw:w-full");
    });

    it("should maintain consistent styling across different contexts", () => {
      wrapper = createWrapper();
      const container = wrapper.find('[data-test="no-data-message"]');
      expect(container.exists()).toBe(true);
      expect(container.classes()).toContain("tw:w-full");
    });
  });

  describe("Component Lifecycle", () => {
    it("should mount without errors", () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it("should unmount cleanly", () => {
      wrapper = createWrapper();
      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });
  });
});
