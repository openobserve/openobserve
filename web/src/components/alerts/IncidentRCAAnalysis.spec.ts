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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import IncidentRCAAnalysis from "./IncidentRCAAnalysis.vue";

installQuasar();

// ==================== TEST DATA FACTORIES ====================

/**
 * Creates mock props for IncidentRCAAnalysis
 */
function createMockProps(overrides = {}) {
  return {
    hasExistingRca: false,
    rcaLoading: false,
    rcaStreamContent: "",
    formattedRcaContent: "",
    isDarkMode: false,
    ...overrides,
  };
}

/**
 * Creates mock RCA content (formatted HTML)
 */
function createMockRcaContent(overrides = {}) {
  const defaults = {
    simple: "<p>Root cause: High CPU usage due to memory leak</p>",
    detailed: `
      <h2>Root Cause Analysis</h2>
      <h3>Primary Cause</h3>
      <p>Memory leak in payment processing service</p>
      <h3>Contributing Factors</h3>
      <ul>
        <li>Increased traffic volume</li>
        <li>Database connection pooling issues</li>
      </ul>
    `,
    streaming: "<p>Analyzing incident...</p><p>Checking service dependencies...</p>",
  };
  return { ...defaults, ...overrides };
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
 * Clicks the trigger RCA button
 */
async function clickTriggerButton(wrapper: VueWrapper) {
  const button = findByTestId(wrapper, "trigger-rca-btn");
  await button.trigger("click");
  await flushPromises();
}

/**
 * Mounts the component with default test setup
 */
function mountComponent(props = {}) {
  const defaultProps = createMockProps(props);
  return mount(IncidentRCAAnalysis, {
    props: defaultProps,
  });
}

// ==================== TESTS ====================

describe("IncidentRCAAnalysis", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("Component Rendering", () => {
    it("should render the component", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
      expect(existsByTestId(wrapper, "rca-analysis-container")).toBe(true);
    });

    it("should render in light mode by default", () => {
      wrapper = mountComponent({ isDarkMode: false });
      expect(wrapper.exists()).toBe(true);
    });

    it("should render in dark mode when enabled", () => {
      wrapper = mountComponent({ isDarkMode: true });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Trigger Button State", () => {
    it("should show trigger button when no analysis and not loading", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
      });

      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(true);
      expect(existsByTestId(wrapper, "trigger-rca-btn")).toBe(true);
    });

    it("should display correct button text", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
      });

      const button = findByTestId(wrapper, "trigger-rca-btn");
      expect(button.text()).toBe("Analyze Incident");
    });

    it("should not show trigger button when loading", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: true,
      });

      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(false);
      expect(existsByTestId(wrapper, "trigger-rca-btn")).toBe(false);
    });

    it("should not show trigger button when analysis exists", () => {
      wrapper = mountComponent({
        hasExistingRca: true,
        rcaLoading: false,
      });

      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(false);
      expect(existsByTestId(wrapper, "trigger-rca-btn")).toBe(false);
    });

    it("should emit trigger-rca when button is clicked", async () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
      });

      await clickTriggerButton(wrapper);

      expect(wrapper.emitted("trigger-rca")).toBeTruthy();
      expect(wrapper.emitted("trigger-rca")?.length).toBe(1);
    });

    it("should disable button when loading", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: true,
      });

      // Button shouldn't be visible during loading
      expect(existsByTestId(wrapper, "trigger-rca-btn")).toBe(false);
    });
  });

  describe("Loading State", () => {
    it("should show loading state when rcaLoading is true", () => {
      wrapper = mountComponent({ rcaLoading: true });

      expect(existsByTestId(wrapper, "rca-loading-container")).toBe(true);
      expect(existsByTestId(wrapper, "rca-loading-indicator")).toBe(true);
    });

    it("should display loading spinner", () => {
      wrapper = mountComponent({ rcaLoading: true });

      expect(existsByTestId(wrapper, "rca-spinner")).toBe(true);
    });

    it("should display loading text", () => {
      wrapper = mountComponent({ rcaLoading: true });

      const loadingText = findByTestId(wrapper, "rca-loading-text");
      expect(loadingText.text()).toBe("Analysis in progress...");
    });

    it("should show streaming content while loading", () => {
      const streamContent = createMockRcaContent().streaming;
      wrapper = mountComponent({
        rcaLoading: true,
        rcaStreamContent: "Analyzing...",
        formattedRcaContent: streamContent,
      });

      expect(existsByTestId(wrapper, "rca-stream-content")).toBe(true);
      const content = findByTestId(wrapper, "rca-stream-content");
      expect(content.html()).toContain("Analyzing incident");
    });

    it("should not show streaming content when rcaStreamContent is empty", () => {
      wrapper = mountComponent({
        rcaLoading: true,
        rcaStreamContent: "",
      });

      expect(existsByTestId(wrapper, "rca-stream-content")).toBe(false);
    });

    it("should apply dark mode styles to loading container", () => {
      wrapper = mountComponent({
        rcaLoading: true,
        isDarkMode: true,
      });

      const container = findByTestId(wrapper, "rca-loading-container");
      expect(container.classes()).toContain("tw:bg-gray-800");
      expect(container.classes()).toContain("tw:border-gray-700");
    });

    it("should apply light mode styles to loading container", () => {
      wrapper = mountComponent({
        rcaLoading: true,
        isDarkMode: false,
      });

      const container = findByTestId(wrapper, "rca-loading-container");
      expect(container.classes()).toContain("tw:bg-white");
      expect(container.classes()).toContain("tw:border-gray-200");
    });
  });

  describe("Existing Analysis Display", () => {
    it("should show existing analysis when hasExistingRca is true", () => {
      const rcaContent = createMockRcaContent().simple;
      wrapper = mountComponent({
        hasExistingRca: true,
        formattedRcaContent: rcaContent,
      });

      expect(existsByTestId(wrapper, "rca-existing-container")).toBe(true);
      expect(existsByTestId(wrapper, "rca-existing-content")).toBe(true);
    });

    it("should display formatted RCA content", () => {
      const rcaContent = createMockRcaContent().simple;
      wrapper = mountComponent({
        hasExistingRca: true,
        formattedRcaContent: rcaContent,
      });

      const content = findByTestId(wrapper, "rca-existing-content");
      expect(content.html()).toContain("Root cause: High CPU usage");
    });

    it("should render detailed HTML content correctly", () => {
      const rcaContent = createMockRcaContent().detailed;
      wrapper = mountComponent({
        hasExistingRca: true,
        formattedRcaContent: rcaContent,
      });

      const content = findByTestId(wrapper, "rca-existing-content");
      expect(content.html()).toContain("Root Cause Analysis");
      expect(content.html()).toContain("Memory leak");
      expect(content.html()).toContain("<ul>");
    });

    it("should not show existing analysis when loading", () => {
      wrapper = mountComponent({
        hasExistingRca: true,
        rcaLoading: true,
      });

      expect(existsByTestId(wrapper, "rca-existing-container")).toBe(false);
    });

    it("should apply dark mode styles to existing container", () => {
      const rcaContent = createMockRcaContent().simple;
      wrapper = mountComponent({
        hasExistingRca: true,
        formattedRcaContent: rcaContent,
        isDarkMode: true,
      });

      const container = findByTestId(wrapper, "rca-existing-container");
      expect(container.classes()).toContain("tw:border-gray-700");
    });

    it("should apply light mode styles to existing container", () => {
      const rcaContent = createMockRcaContent().simple;
      wrapper = mountComponent({
        hasExistingRca: true,
        formattedRcaContent: rcaContent,
        isDarkMode: false,
      });

      const container = findByTestId(wrapper, "rca-existing-container");
      expect(container.classes()).toContain("tw:bg-white");
      expect(container.classes()).toContain("tw:border-gray-200");
    });
  });

  describe("Empty State", () => {
    it("should show empty state when no analysis and not loading", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
      });

      expect(existsByTestId(wrapper, "rca-empty-state")).toBe(true);
    });

    it("should display empty state message", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
      });

      const emptyState = findByTestId(wrapper, "rca-empty-state");
      expect(emptyState.text()).toBe("No analysis performed yet");
    });

    it("should not show empty state when loading", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: true,
      });

      expect(existsByTestId(wrapper, "rca-empty-state")).toBe(false);
    });

    it("should not show empty state when analysis exists", () => {
      wrapper = mountComponent({
        hasExistingRca: true,
        rcaLoading: false,
      });

      expect(existsByTestId(wrapper, "rca-empty-state")).toBe(false);
    });

    it("should apply dark mode styles to empty state", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
        isDarkMode: true,
      });

      const emptyState = findByTestId(wrapper, "rca-empty-state");
      expect(emptyState.classes()).toContain("tw:bg-gray-700");
      expect(emptyState.classes()).toContain("tw:border-gray-600");
      expect(emptyState.classes()).toContain("tw:text-gray-300");
    });

    it("should apply light mode styles to empty state", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
        isDarkMode: false,
      });

      const emptyState = findByTestId(wrapper, "rca-empty-state");
      expect(emptyState.classes()).toContain("tw:bg-gray-50");
      expect(emptyState.classes()).toContain("tw:border-gray-200");
      expect(emptyState.classes()).toContain("tw:text-gray-500");
    });
  });

  describe("State Transitions", () => {
    it("should transition from empty to loading", async () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
      });

      expect(existsByTestId(wrapper, "rca-empty-state")).toBe(true);

      await wrapper.setProps({ rcaLoading: true });
      await flushPromises();

      expect(existsByTestId(wrapper, "rca-empty-state")).toBe(false);
      expect(existsByTestId(wrapper, "rca-loading-container")).toBe(true);
    });

    it("should transition from loading to existing analysis", async () => {
      const rcaContent = createMockRcaContent().simple;
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: true,
      });

      expect(existsByTestId(wrapper, "rca-loading-container")).toBe(true);

      await wrapper.setProps({
        rcaLoading: false,
        hasExistingRca: true,
        formattedRcaContent: rcaContent,
      });
      await flushPromises();

      expect(existsByTestId(wrapper, "rca-loading-container")).toBe(false);
      expect(existsByTestId(wrapper, "rca-existing-container")).toBe(true);
    });

    it("should show trigger button after loading completes without existing RCA", async () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: true,
      });

      await wrapper.setProps({
        rcaLoading: false,
        hasExistingRca: false,
      });
      await flushPromises();

      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long RCA content", () => {
      const longContent = "<p>" + "A".repeat(10000) + "</p>";
      wrapper = mountComponent({
        hasExistingRca: true,
        formattedRcaContent: longContent,
      });

      const content = findByTestId(wrapper, "rca-existing-content");
      expect(content.exists()).toBe(true);
    });

    it("should handle RCA content with special characters", () => {
      const specialContent = "<p>Error: <script>alert('test')</script></p>";
      wrapper = mountComponent({
        hasExistingRca: true,
        formattedRcaContent: specialContent,
      });

      const content = findByTestId(wrapper, "rca-existing-content");
      expect(content.html()).toContain("Error:");
    });

    it("should handle empty formattedRcaContent with hasExistingRca true", () => {
      wrapper = mountComponent({
        hasExistingRca: true,
        formattedRcaContent: "",
      });

      expect(existsByTestId(wrapper, "rca-existing-container")).toBe(true);
      const content = findByTestId(wrapper, "rca-existing-content");
      expect(content.html()).toBeTruthy();
    });

    it("should handle rapid prop changes", async () => {
      wrapper = mountComponent();

      await wrapper.setProps({ rcaLoading: true });
      await flushPromises();

      await wrapper.setProps({ rcaLoading: false, hasExistingRca: true });
      await flushPromises();

      await wrapper.setProps({ hasExistingRca: false });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle multiple button clicks", async () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
      });

      await clickTriggerButton(wrapper);
      await clickTriggerButton(wrapper);
      await clickTriggerButton(wrapper);

      expect(wrapper.emitted("trigger-rca")?.length).toBe(3);
    });
  });

  describe("Theme Switching", () => {
    it("should update styles when switching from light to dark mode", async () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
        isDarkMode: false,
      });

      const emptyStateBefore = findByTestId(wrapper, "rca-empty-state");
      expect(emptyStateBefore.classes()).toContain("tw:bg-gray-50");

      await wrapper.setProps({ isDarkMode: true });
      await flushPromises();

      const emptyStateAfter = findByTestId(wrapper, "rca-empty-state");
      expect(emptyStateAfter.classes()).toContain("tw:bg-gray-700");
    });

    it("should apply correct dark mode styles during loading", () => {
      wrapper = mountComponent({
        rcaLoading: true,
        isDarkMode: true,
      });

      const container = findByTestId(wrapper, "rca-loading-container");
      expect(container.classes()).toContain("tw:bg-gray-800");
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete analysis workflow", async () => {
      // Start with empty state
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(true);

      // Trigger analysis
      await clickTriggerButton(wrapper);
      expect(wrapper.emitted("trigger-rca")).toBeTruthy();

      // Simulate loading state
      await wrapper.setProps({ rcaLoading: true, rcaStreamContent: "Analyzing..." });
      expect(existsByTestId(wrapper, "rca-loading-container")).toBe(true);

      // Complete analysis
      const finalContent = createMockRcaContent().detailed;
      await wrapper.setProps({
        rcaLoading: false,
        hasExistingRca: true,
        formattedRcaContent: finalContent,
      });

      expect(existsByTestId(wrapper, "rca-existing-container")).toBe(true);
      expect(findByTestId(wrapper, "rca-existing-content").html()).toContain(
        "Root Cause Analysis"
      );
    });
  });
});
