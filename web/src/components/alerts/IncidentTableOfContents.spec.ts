// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import IncidentTableOfContents from "./IncidentTableOfContents.vue";

installQuasar();

// ==================== TEST DATA FACTORIES ====================

/**
 * TocItem interface for type safety
 */
interface TocItem {
  id: string;
  text: string;
  level: number;
  children: TocItem[];
  expanded: boolean;
}

/**
 * Creates a mock TOC item
 */
function createMockTocItem(overrides = {}): TocItem {
  return {
    id: "item-1",
    text: "Section 1",
    level: 1,
    children: [],
    expanded: false,
    ...overrides,
  };
}

/**
 * Creates a simple flat table of contents
 */
function createFlatToc(): TocItem[] {
  return [
    createMockTocItem({ id: "sec1", text: "Overview", level: 1 }),
    createMockTocItem({ id: "sec2", text: "Details", level: 1 }),
  ];
}

/**
 * Creates a nested table of contents with children
 */
function createNestedToc(): TocItem[] {
  return [
    createMockTocItem({
      id: "parent1",
      text: "Parent Section 1",
      level: 1,
      children: [
        createMockTocItem({ id: "child1-1", text: "Child 1.1", level: 2, children: [] }),
        createMockTocItem({ id: "child1-2", text: "Child 1.2", level: 2, children: [] }),
      ],
    }),
    createMockTocItem({
      id: "parent2",
      text: "Parent Section 2",
      level: 1,
      children: [],
    }),
  ];
}

/**
 * Creates a deeply nested TOC with 3 levels
 */
function createDeeplyNestedToc(): TocItem[] {
  return [
    createMockTocItem({
      id: "l1",
      text: "Level 1",
      level: 1,
      children: [
        createMockTocItem({
          id: "l2",
          text: "Level 2",
          level: 2,
          children: [
            createMockTocItem({ id: "l3-1", text: "Level 3.1", level: 3, children: [] }),
            createMockTocItem({ id: "l3-2", text: "Level 3.2", level: 3, children: [] }),
          ],
        }),
      ],
    }),
  ];
}

/**
 * Creates mock expanded sections object
 */
function createExpandedSections(itemIds: string[]): Record<string, boolean> {
  return itemIds.reduce((acc, id) => {
    acc[id] = true;
    return acc;
  }, {} as Record<string, boolean>);
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Finds an element by data-test attribute
 */
function findByTestId(wrapper: VueWrapper, testId: string) {
  return wrapper.find(`[data-test="${testId}"]`);
}

/**
 * Checks if an element exists by data-test id
 */
function existsByTestId(wrapper: VueWrapper, testId: string): boolean {
  return findByTestId(wrapper, testId).exists();
}

/**
 * Clicks on an item's text to trigger scroll
 */
async function clickItemText(wrapper: VueWrapper, level: number, itemId: string) {
  const textElement = findByTestId(wrapper, `toc-level${level}-text-${itemId}`);
  await textElement.trigger("click");
  await flushPromises();
}

/**
 * Clicks on an expand button
 */
async function clickExpandButton(wrapper: VueWrapper, level: number, itemId: string) {
  const button = findByTestId(wrapper, `toc-level${level}-expand-btn-${itemId}`);
  await button.trigger("click");
  await flushPromises();
}

/**
 * Mounts the component with default test setup
 */
function mountComponent(
  tableOfContents: TocItem[] = [],
  expandedSections: Record<string, boolean> = {},
  isDarkMode = false
) {
  return mount(IncidentTableOfContents, {
    props: {
      tableOfContents,
      expandedSections,
      isDarkMode,
    },
  });
}

// ==================== TESTS ====================

describe("IncidentTableOfContents", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("Component Rendering", () => {
    it("should render the component", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
      expect(existsByTestId(wrapper, "toc-container")).toBe(true);
    });

    it("should render section container", () => {
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "toc-section-container")).toBe(true);
    });

    it("should render header section", () => {
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "toc-header")).toBe(true);
    });

    it("should render content section", () => {
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "toc-content")).toBe(true);
    });
  });

  describe("Header Display", () => {
    it("should display header icon", () => {
      wrapper = mountComponent();
      const icon = findByTestId(wrapper, "toc-header-icon");
      expect(icon.exists()).toBe(true);
      const qIcon = icon.findComponent({ name: "QIcon" });
      expect(qIcon.props("name")).toBe("format_list_bulleted");
    });

    it("should display header title", () => {
      wrapper = mountComponent();
      const title = findByTestId(wrapper, "toc-header-title");
      expect(title.text()).toBe("Table of Contents");
    });

    it("should apply dark mode styles to header in dark mode", () => {
      wrapper = mountComponent([], {}, true);
      const header = findByTestId(wrapper, "toc-header");
      const title = findByTestId(wrapper, "toc-header-title");

      expect(header.classes()).toContain("tw:border-gray-700");
      expect(title.classes()).toContain("tw:text-gray-300");
    });

    it("should apply light mode styles to header in light mode", () => {
      wrapper = mountComponent([], {}, false);
      const header = findByTestId(wrapper, "toc-header");
      const title = findByTestId(wrapper, "toc-header-title");

      expect(header.classes()).toContain("tw:border-gray-200");
      expect(title.classes()).toContain("tw:text-gray-700");
    });
  });

  describe("Empty State", () => {
    it("should display empty state when no items", () => {
      wrapper = mountComponent([]);
      expect(existsByTestId(wrapper, "toc-empty-state")).toBe(true);
    });

    it("should display correct empty state message", () => {
      wrapper = mountComponent([]);
      const emptyState = findByTestId(wrapper, "toc-empty-state");
      expect(emptyState.text()).toBe("No sections available");
    });

    it("should apply dark mode styles to empty state", () => {
      wrapper = mountComponent([], {}, true);
      const emptyState = findByTestId(wrapper, "toc-empty-state");
      expect(emptyState.classes()).toContain("tw:text-gray-500");
    });

    it("should apply light mode styles to empty state", () => {
      wrapper = mountComponent([], {}, false);
      const emptyState = findByTestId(wrapper, "toc-empty-state");
      expect(emptyState.classes()).toContain("tw:text-gray-400");
    });

    it("should not display empty state when items exist", () => {
      wrapper = mountComponent(createFlatToc());
      expect(existsByTestId(wrapper, "toc-empty-state")).toBe(false);
    });
  });

  describe("Level 1 Items", () => {
    it("should render level 1 items", () => {
      const toc = createFlatToc();
      wrapper = mountComponent(toc);

      expect(existsByTestId(wrapper, "toc-level1-item-sec1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level1-item-sec2")).toBe(true);
    });

    it("should display correct text for level 1 items", () => {
      const toc = createFlatToc();
      wrapper = mountComponent(toc);

      const text1 = findByTestId(wrapper, "toc-level1-text-sec1");
      const text2 = findByTestId(wrapper, "toc-level1-text-sec2");

      expect(text1.text()).toBe("Overview");
      expect(text2.text()).toBe("Details");
    });

    it("should display folder icon for items with children", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc);

      const icon = findByTestId(wrapper, "toc-level1-icon-parent1");
      const qIcon = icon.findComponent({ name: "QIcon" });
      expect(qIcon.props("name")).toBe("folder");
    });

    it("should display article icon for items without children", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc);

      const icon = findByTestId(wrapper, "toc-level1-icon-parent2");
      const qIcon = icon.findComponent({ name: "QIcon" });
      expect(qIcon.props("name")).toBe("article");
    });

    it("should show expand button only for items with children", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc);

      expect(existsByTestId(wrapper, "toc-level1-expand-btn-parent1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level1-expand-btn-parent2")).toBe(false);
    });

    it("should emit scroll-to-section when clicking level 1 text", async () => {
      const toc = createFlatToc();
      wrapper = mountComponent(toc);

      await clickItemText(wrapper, 1, "sec1");

      expect(wrapper.emitted("scroll-to-section")).toBeTruthy();
      expect(wrapper.emitted("scroll-to-section")?.[0]).toEqual(["sec1"]);
    });

    it("should apply dark mode styles to level 1 items", () => {
      const toc = createFlatToc();
      wrapper = mountComponent(toc, {}, true);

      const content = findByTestId(wrapper, "toc-level1-content-sec1");
      expect(content.classes()).toContain("tw:text-gray-200");
    });

    it("should apply light mode styles to level 1 items", () => {
      const toc = createFlatToc();
      wrapper = mountComponent(toc, {}, false);

      const content = findByTestId(wrapper, "toc-level1-content-sec1");
      expect(content.classes()).toContain("tw:text-gray-900");
    });
  });

  describe("Level 2 Items", () => {
    it("should not render level 2 items when parent is collapsed", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, {});

      expect(existsByTestId(wrapper, "toc-level2-container-parent1")).toBe(false);
      expect(existsByTestId(wrapper, "toc-level2-item-child1-1")).toBe(false);
    });

    it("should render level 2 items when parent is expanded", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["parent1"]));

      expect(existsByTestId(wrapper, "toc-level2-container-parent1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level2-item-child1-1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level2-item-child1-2")).toBe(true);
    });

    it("should display correct text for level 2 items", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["parent1"]));

      const text1 = findByTestId(wrapper, "toc-level2-text-child1-1");
      const text2 = findByTestId(wrapper, "toc-level2-text-child1-2");

      expect(text1.text()).toBe("Child 1.1");
      expect(text2.text()).toBe("Child 1.2");
    });

    it("should display label icon for level 2 items", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["parent1"]));

      const icon = findByTestId(wrapper, "toc-level2-icon-child1-1");
      const qIcon = icon.findComponent({ name: "QIcon" });
      expect(qIcon.props("name")).toBe("label");
    });

    it("should emit scroll-to-section when clicking level 2 text", async () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["parent1"]));

      await clickItemText(wrapper, 2, "child1-1");

      expect(wrapper.emitted("scroll-to-section")).toBeTruthy();
      expect(wrapper.emitted("scroll-to-section")?.[0]).toEqual(["child1-1"]);
    });

    it("should apply dark mode styles to level 2 items", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["parent1"]), true);

      const content = findByTestId(wrapper, "toc-level2-content-child1-1");
      expect(content.classes()).toContain("tw:text-gray-300");
    });

    it("should apply light mode styles to level 2 items", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["parent1"]), false);

      const content = findByTestId(wrapper, "toc-level2-content-child1-1");
      expect(content.classes()).toContain("tw:text-gray-700");
    });
  });

  describe("Level 3 Items", () => {
    it("should not render level 3 items when parent is collapsed", () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1"]));

      expect(existsByTestId(wrapper, "toc-level3-container-l2")).toBe(false);
      expect(existsByTestId(wrapper, "toc-level3-item-l3-1")).toBe(false);
    });

    it("should render level 3 items when parent is expanded", () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1", "l2"]));

      expect(existsByTestId(wrapper, "toc-level3-container-l2")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level3-item-l3-1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level3-item-l3-2")).toBe(true);
    });

    it("should display correct text for level 3 items", () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1", "l2"]));

      const text1 = findByTestId(wrapper, "toc-level3-text-l3-1");
      const text2 = findByTestId(wrapper, "toc-level3-text-l3-2");

      expect(text1.text()).toBe("Level 3.1");
      expect(text2.text()).toBe("Level 3.2");
    });

    it("should display bullet icon for level 3 items", () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1", "l2"]));

      const icon = findByTestId(wrapper, "toc-level3-icon-l3-1");
      const qIcon = icon.findComponent({ name: "QIcon" });
      expect(qIcon.props("name")).toBe("fiber_manual_record");
    });

    it("should emit scroll-to-section when clicking level 3 item", async () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1", "l2"]));

      const item = findByTestId(wrapper, "toc-level3-item-l3-1");
      await item.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("scroll-to-section")).toBeTruthy();
      expect(wrapper.emitted("scroll-to-section")?.[0]).toEqual(["l3-1"]);
    });

    it("should apply dark mode hover styles to level 3 items", () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1", "l2"]), true);

      const item = findByTestId(wrapper, "toc-level3-item-l3-1");
      expect(item.classes()).toContain("hover:tw:bg-gray-700");
      expect(item.classes()).toContain("tw:text-gray-400");
    });

    it("should apply light mode hover styles to level 3 items", () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1", "l2"]), false);

      const item = findByTestId(wrapper, "toc-level3-item-l3-1");
      expect(item.classes()).toContain("hover:tw:bg-blue-50");
      expect(item.classes()).toContain("tw:text-gray-600");
    });
  });

  describe("Expand/Collapse Functionality", () => {
    it("should show chevron_right icon when collapsed", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, {});

      const button = findByTestId(wrapper, "toc-level1-expand-btn-parent1");
      const qBtn = button.findComponent({ name: "QBtn" });
      expect(qBtn.props("icon")).toBe("chevron_right");
    });

    it("should show expand_more icon when expanded", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["parent1"]));

      const button = findByTestId(wrapper, "toc-level1-expand-btn-parent1");
      const qBtn = button.findComponent({ name: "QBtn" });
      expect(qBtn.props("icon")).toBe("expand_more");
    });

    it("should emit toggle-section when clicking expand button", async () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, {});

      await clickExpandButton(wrapper, 1, "parent1");

      expect(wrapper.emitted("toggle-section")).toBeTruthy();
      expect(wrapper.emitted("toggle-section")?.[0][0]).toEqual(
        expect.objectContaining({ id: "parent1" })
      );
    });

    it("should show Expand tooltip when collapsed", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, {});

      const button = findByTestId(wrapper, "toc-level1-expand-btn-parent1");
      // Verify tooltip exists and check button HTML for tooltip content
      expect(button.findComponent({ name: "QTooltip" }).exists()).toBe(true);
      expect(button.html()).toContain("Expand");
    });

    it("should show Collapse tooltip when expanded", () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["parent1"]));

      const button = findByTestId(wrapper, "toc-level1-expand-btn-parent1");
      // Verify tooltip exists and check button HTML for tooltip content
      expect(button.findComponent({ name: "QTooltip" }).exists()).toBe(true);
      expect(button.html()).toContain("Collapse");
    });

    it("should handle expand button on level 2 items with children", async () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1"]));

      await clickExpandButton(wrapper, 2, "l2");

      expect(wrapper.emitted("toggle-section")).toBeTruthy();
      expect(wrapper.emitted("toggle-section")?.[0][0]).toEqual(
        expect.objectContaining({ id: "l2" })
      );
    });
  });

  describe("Event Emissions", () => {
    it("should emit scroll-to-section with correct item id", async () => {
      const toc = createFlatToc();
      wrapper = mountComponent(toc);

      await clickItemText(wrapper, 1, "sec1");
      await clickItemText(wrapper, 1, "sec2");

      const emissions = wrapper.emitted("scroll-to-section");
      expect(emissions?.length).toBe(2);
      expect(emissions?.[0]).toEqual(["sec1"]);
      expect(emissions?.[1]).toEqual(["sec2"]);
    });

    it("should emit toggle-section with item and event", async () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, {});

      await clickExpandButton(wrapper, 1, "parent1");

      const emissions = wrapper.emitted("toggle-section");
      expect(emissions?.length).toBe(1);
      expect(emissions?.[0][0]).toHaveProperty("id", "parent1");
      expect(emissions?.[0][1]).toBeDefined(); // Event object
    });

    it("should emit separate events for different levels", async () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1", "l2"]));

      await clickItemText(wrapper, 1, "l1");
      await clickItemText(wrapper, 2, "l2");

      const item3 = findByTestId(wrapper, "toc-level3-item-l3-1");
      await item3.trigger("click");
      await flushPromises();

      const emissions = wrapper.emitted("scroll-to-section");
      expect(emissions?.length).toBe(3);
      expect(emissions?.[0]).toEqual(["l1"]);
      expect(emissions?.[1]).toEqual(["l2"]);
      expect(emissions?.[2]).toEqual(["l3-1"]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long item text with truncation", () => {
      const longText = "A".repeat(200);
      const toc = [createMockTocItem({ id: "long", text: longText })];
      wrapper = mountComponent(toc);

      const text = findByTestId(wrapper, "toc-level1-text-long");
      expect(text.classes()).toContain("tw:truncate");
      expect(text.text()).toBe(longText);
    });

    it("should handle empty children array", () => {
      const toc = [createMockTocItem({ id: "empty", children: [] })];
      wrapper = mountComponent(toc);

      expect(existsByTestId(wrapper, "toc-level1-item-empty")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level1-expand-btn-empty")).toBe(false);
    });

    it("should handle many level 1 items", () => {
      const toc = Array.from({ length: 20 }, (_, i) =>
        createMockTocItem({ id: `item-${i}`, text: `Item ${i}` })
      );
      wrapper = mountComponent(toc);

      expect(existsByTestId(wrapper, "toc-level1-item-item-0")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level1-item-item-19")).toBe(true);
    });

    it("should handle special characters in item text", () => {
      const specialText = "Section <>&\"'";
      const toc = [createMockTocItem({ id: "special", text: specialText })];
      wrapper = mountComponent(toc);

      const text = findByTestId(wrapper, "toc-level1-text-special");
      expect(text.text()).toBe(specialText);
    });

    it("should handle mixed expanded and collapsed states", () => {
      const toc = [
        createMockTocItem({
          id: "parent1",
          text: "Parent 1",
          children: [createMockTocItem({ id: "child1", text: "Child 1" })],
        }),
        createMockTocItem({
          id: "parent2",
          text: "Parent 2",
          children: [createMockTocItem({ id: "child2", text: "Child 2" })],
        }),
      ];
      wrapper = mountComponent(toc, createExpandedSections(["parent1"]));

      expect(existsByTestId(wrapper, "toc-level2-item-child1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level2-item-child2")).toBe(false);
    });

    it("should handle updating expanded sections prop", async () => {
      const toc = createNestedToc();
      wrapper = mountComponent(toc, {});

      expect(existsByTestId(wrapper, "toc-level2-item-child1-1")).toBe(false);

      await wrapper.setProps({ expandedSections: createExpandedSections(["parent1"]) });
      await flushPromises();

      expect(existsByTestId(wrapper, "toc-level2-item-child1-1")).toBe(true);
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete user workflow for expanding nested items", async () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, {});

      // Initially, no children visible
      expect(existsByTestId(wrapper, "toc-level2-item-l2")).toBe(false);
      expect(existsByTestId(wrapper, "toc-level3-item-l3-1")).toBe(false);

      // Expand level 1
      await wrapper.setProps({ expandedSections: createExpandedSections(["l1"]) });
      await flushPromises();
      expect(existsByTestId(wrapper, "toc-level2-item-l2")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level3-item-l3-1")).toBe(false);

      // Expand level 2
      await wrapper.setProps({ expandedSections: createExpandedSections(["l1", "l2"]) });
      await flushPromises();
      expect(existsByTestId(wrapper, "toc-level3-item-l3-1")).toBe(true);
    });

    it("should handle navigation through all levels", async () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1", "l2"]));

      // Click level 1
      await clickItemText(wrapper, 1, "l1");
      expect(wrapper.emitted("scroll-to-section")?.[0]).toEqual(["l1"]);

      // Click level 2
      await clickItemText(wrapper, 2, "l2");
      expect(wrapper.emitted("scroll-to-section")?.[1]).toEqual(["l2"]);

      // Click level 3
      const item = findByTestId(wrapper, "toc-level3-item-l3-1");
      await item.trigger("click");
      await flushPromises();
      expect(wrapper.emitted("scroll-to-section")?.[2]).toEqual(["l3-1"]);
    });

    it("should maintain theme consistency across all levels", () => {
      const toc = createDeeplyNestedToc();
      wrapper = mountComponent(toc, createExpandedSections(["l1", "l2"]), true);

      // Level 1 dark mode
      const l1Content = findByTestId(wrapper, "toc-level1-content-l1");
      expect(l1Content.classes()).toContain("tw:text-gray-200");

      // Level 2 dark mode
      const l2Content = findByTestId(wrapper, "toc-level2-content-l2");
      expect(l2Content.classes()).toContain("tw:text-gray-300");

      // Level 3 dark mode
      const l3Item = findByTestId(wrapper, "toc-level3-item-l3-1");
      expect(l3Item.classes()).toContain("tw:text-gray-400");
    });

    it("should handle complex nested structure with multiple branches", () => {
      const toc = [
        createMockTocItem({
          id: "root1",
          text: "Root 1",
          children: [
            createMockTocItem({
              id: "branch1-1",
              text: "Branch 1.1",
              children: [
                createMockTocItem({ id: "leaf1-1-1", text: "Leaf 1.1.1" }),
                createMockTocItem({ id: "leaf1-1-2", text: "Leaf 1.1.2" }),
              ],
            }),
            createMockTocItem({
              id: "branch1-2",
              text: "Branch 1.2",
              children: [createMockTocItem({ id: "leaf1-2-1", text: "Leaf 1.2.1" })],
            }),
          ],
        }),
        createMockTocItem({
          id: "root2",
          text: "Root 2",
          children: [
            createMockTocItem({
              id: "branch2-1",
              text: "Branch 2.1",
              children: [createMockTocItem({ id: "leaf2-1-1", text: "Leaf 2.1.1" })],
            }),
          ],
        }),
      ];

      wrapper = mountComponent(
        toc,
        createExpandedSections(["root1", "branch1-1", "branch1-2", "root2", "branch2-1"])
      );

      // Verify all branches are rendered
      expect(existsByTestId(wrapper, "toc-level1-item-root1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level2-item-branch1-1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level3-item-leaf1-1-1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level2-item-branch1-2")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level3-item-leaf1-2-1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level1-item-root2")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level2-item-branch2-1")).toBe(true);
      expect(existsByTestId(wrapper, "toc-level3-item-leaf2-1-1")).toBe(true);
    });
  });
});
