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

import { describe, it, expect, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import IncidentRCAAnalysis from "./IncidentRCAAnalysis.vue";
import i18n from "@/locales";


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
    global: { plugins: [i18n] },
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
    it("should show in-flight banner when rcaLoading is true", () => {
      wrapper = mountComponent({ rcaLoading: true });

      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(true);
    });

    it("should display loading text in the in-flight banner", () => {
      wrapper = mountComponent({ rcaLoading: true });

      const container = findByTestId(wrapper, "rca-inflight-container");
      expect(container.text()).toContain("AI SRE Agent is analyzing this incident");
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

    it("should render in-flight container in dark mode", () => {
      wrapper = mountComponent({
        rcaLoading: true,
        isDarkMode: true,
      });

      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(true);
    });

    it("should render in-flight container in light mode", () => {
      wrapper = mountComponent({
        rcaLoading: true,
        isDarkMode: false,
      });

      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(true);
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

    // The previous report stays mounted while a reanalysis runs so the panel does not
    // blank out for the duration of the request; the in-flight banner sits above it.
    it("should keep showing existing analysis while a reanalysis is loading", () => {
      wrapper = mountComponent({
        hasExistingRca: true,
        rcaLoading: true,
      });

      expect(existsByTestId(wrapper, "rca-existing-container")).toBe(true);
      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(true);
    });

    it("should show streaming content instead of the existing report once chunks arrive", () => {
      wrapper = mountComponent({
        hasExistingRca: true,
        rcaLoading: true,
        rcaStreamContent: "partial",
        formattedRcaContent: "<p>partial</p>",
      });

      expect(existsByTestId(wrapper, "rca-stream-container")).toBe(true);
      expect(existsByTestId(wrapper, "rca-existing-container")).toBe(false);
    });

    it("should render existing container in dark mode", () => {
      const rcaContent = createMockRcaContent().simple;
      wrapper = mountComponent({
        hasExistingRca: true,
        formattedRcaContent: rcaContent,
        isDarkMode: true,
      });

      expect(existsByTestId(wrapper, "rca-existing-container")).toBe(true);
    });

    it("should render existing container in light mode", () => {
      const rcaContent = createMockRcaContent().simple;
      wrapper = mountComponent({
        hasExistingRca: true,
        formattedRcaContent: rcaContent,
        isDarkMode: false,
      });

      expect(existsByTestId(wrapper, "rca-existing-container")).toBe(true);
    });
  });

  describe("Empty State", () => {
    it("should show trigger button (not an empty-state element) when no analysis and not loading", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
      });

      // Empty state text is gone; the trigger button section takes its place
      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(true);
      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(false);
    });

    it("should not show trigger button when loading", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: true,
      });

      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(false);
    });

    it("should not show trigger button when analysis exists", () => {
      wrapper = mountComponent({
        hasExistingRca: true,
        rcaLoading: false,
      });

      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(false);
    });

    it("should show in-flight banner instead of trigger button when analysisInFlight", () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
        analysisInFlight: true,
      });

      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(false);
      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(true);
    });
  });

  describe("State Transitions", () => {
    it("should transition from trigger button to in-flight banner when loading starts", async () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: false,
      });

      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(true);

      await wrapper.setProps({ rcaLoading: true });
      await flushPromises();

      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(false);
      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(true);
    });

    it("should transition from loading to existing analysis", async () => {
      const rcaContent = createMockRcaContent().simple;
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: true,
      });

      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(true);

      await wrapper.setProps({
        rcaLoading: false,
        hasExistingRca: true,
        formattedRcaContent: rcaContent,
      });
      await flushPromises();

      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(false);
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
    it("should keep the semantic in-flight banner surface when switching from light to dark mode", async () => {
      wrapper = mountComponent({
        hasExistingRca: false,
        rcaLoading: true,
        isDarkMode: false,
      });

      // The in-flight state is an OBanner variant="info", whose surface token flips
      // with the theme on its own — the class must stay put across the mode switch.
      const bannerBefore = findByTestId(wrapper, "rca-inflight-container");
      expect(bannerBefore.classes()).toContain("bg-banner-info-bg");

      await wrapper.setProps({ isDarkMode: true });
      await flushPromises();

      const bannerAfter = findByTestId(wrapper, "rca-inflight-container");
      expect(bannerAfter.classes()).toContain("bg-banner-info-bg");
    });

    it("should apply the semantic in-flight banner surface during loading in dark mode", () => {
      wrapper = mountComponent({
        rcaLoading: true,
        isDarkMode: true,
      });

      const container = findByTestId(wrapper, "rca-inflight-container");
      expect(container.classes()).toContain("bg-banner-info-bg");
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
      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(true);

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

  describe("Failure State", () => {
    const failure = { reason: "Agent unavailable", details: "connection refused" };

    it("should show the failure banner with reason and details when a run failed", () => {
      wrapper = mountComponent({ rcaError: failure });

      expect(existsByTestId(wrapper, "rca-error-banner")).toBe(true);
      expect(findByTestId(wrapper, "rca-error-reason").text()).toContain(
        "Agent unavailable"
      );
      expect(findByTestId(wrapper, "rca-error-details").text()).toContain(
        "connection refused"
      );
    });

    it("should offer retry instead of the bare trigger button after a failure", async () => {
      wrapper = mountComponent({ rcaError: failure });

      // The generic trigger section is replaced by an explicit retry affordance.
      expect(existsByTestId(wrapper, "rca-trigger-section")).toBe(false);

      await findByTestId(wrapper, "rca-retry-btn").trigger("click");
      expect(wrapper.emitted("trigger-rca")).toBeTruthy();
    });

    it("should keep an existing report visible alongside a failed reanalysis", () => {
      wrapper = mountComponent({
        rcaError: failure,
        hasExistingRca: true,
        formattedRcaContent: createMockRcaContent().simple,
      });

      expect(existsByTestId(wrapper, "rca-error-banner")).toBe(true);
      expect(existsByTestId(wrapper, "rca-existing-container")).toBe(true);
    });

    it("should hide the failure banner once a new run starts", () => {
      wrapper = mountComponent({ rcaError: failure, rcaLoading: true });

      expect(existsByTestId(wrapper, "rca-error-banner")).toBe(false);
      expect(existsByTestId(wrapper, "rca-inflight-container")).toBe(true);
    });
  });

  describe("Cancel", () => {
    it("should emit cancel-rca when cancelling a background run", async () => {
      wrapper = mountComponent({ analysisInFlight: true });

      await findByTestId(wrapper, "rca-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toBeTruthy();
    });

    it("should emit cancel-rca when cancelling a user-triggered run", async () => {
      wrapper = mountComponent({ rcaLoading: true });

      await findByTestId(wrapper, "rca-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toBeTruthy();
    });

    it("should disable the cancel button while the cancel is in flight", () => {
      wrapper = mountComponent({ analysisInFlight: true, rcaCancelling: true });

      expect(findByTestId(wrapper, "rca-cancel-btn").attributes("disabled")).toBeDefined();
    });
  });

  describe("Report Toolbar", () => {
    const withReport = (overrides = {}) =>
      mountComponent({
        hasExistingRca: true,
        formattedRcaContent: createMockRcaContent().simple,
        ...overrides,
      });

    it("should not render the toolbar before any report exists", () => {
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "rca-toolbar")).toBe(false);
    });

    it("should show when the report was produced", () => {
      // 5 minutes ago, in epoch microseconds.
      const fiveMinAgo = (Date.now() - 5 * 60 * 1000) * 1000;
      wrapper = withReport({ analyzedAt: fiveMinAgo });

      expect(findByTestId(wrapper, "rca-analyzed-ago").text()).toContain("5m");
    });

    it("should emit copy-report and download-report", async () => {
      wrapper = withReport();

      await findByTestId(wrapper, "rca-copy-btn").trigger("click");
      await findByTestId(wrapper, "rca-download-btn").trigger("click");

      expect(wrapper.emitted("copy-report")).toBeTruthy();
      expect(wrapper.emitted("download-report")).toBeTruthy();
    });

    it("should hide the history picker when there are no earlier reports", () => {
      wrapper = withReport();
      expect(existsByTestId(wrapper, "rca-history-btn")).toBe(false);
    });

    it("should show the history picker once earlier reports exist", () => {
      wrapper = withReport({
        rcaHistory: [{ content: "older", archived_at: 1_700_000_000_000_000 }],
      });

      expect(existsByTestId(wrapper, "rca-history-btn")).toBe(true);
    });

    it("should flag when an archived report is being viewed and offer a way back", async () => {
      wrapper = withReport({
        rcaHistory: [{ content: "older", archived_at: 1_700_000_000_000_000 }],
        viewingArchivedIndex: 0,
      });

      expect(existsByTestId(wrapper, "rca-archived-banner")).toBe(true);

      await findByTestId(wrapper, "rca-back-to-current-btn").trigger("click");
      expect(wrapper.emitted("view-report")?.[0]).toEqual([null]);
    });

    it("should not flag the current report as archived", () => {
      wrapper = withReport({
        rcaHistory: [{ content: "older", archived_at: 1_700_000_000_000_000 }],
        viewingArchivedIndex: null,
      });

      expect(existsByTestId(wrapper, "rca-archived-banner")).toBe(false);
    });

    it("should hide the re-analyze control while a run is in progress", () => {
      wrapper = withReport({ analysisInFlight: true });
      expect(existsByTestId(wrapper, "rca-reanalyze-btn")).toBe(false);
    });
  });

  describe("Elapsed Time and Staleness", () => {
    it("should show the elapsed label while running", () => {
      wrapper = mountComponent({
        analysisInFlight: true,
        analysisElapsedLabel: "4m",
      });

      expect(findByTestId(wrapper, "rca-elapsed").text()).toContain("4m");
    });

    it("should warn and stay cancellable when a run outlives the stale window", () => {
      wrapper = mountComponent({
        analysisInFlight: true,
        analysisElapsedLabel: "1h 5m",
        analysisIsStale: true,
      });

      const banner = findByTestId(wrapper, "rca-inflight-container");
      // Stale runs switch to the warning surface rather than the neutral info one.
      expect(banner.classes()).toContain("bg-banner-warning-bg");
      expect(existsByTestId(wrapper, "rca-cancel-btn")).toBe(true);
    });
  });
});
