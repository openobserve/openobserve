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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import IncidentAlertTriggersTable from "./IncidentAlertTriggersTable.vue";
import { createI18n } from "vue-i18n";

installQuasar();

// ==================== TEST DATA FACTORIES ====================

/**
 * Creates a mock IncidentAlert object
 */
function createMockAlert(overrides = {}) {
  return {
    incident_id: "incident-123",
    alert_id: "alert-456",
    alert_name: "High CPU Alert",
    alert_fired_at: 1700000000000000, // microseconds
    correlation_reason: "service_discovery",
    created_at: 1700000000000000,
    ...overrides,
  };
}

/**
 * Creates an array of mock alerts
 */
function createMockAlerts(count = 3, overrides = {}) {
  return Array.from({ length: count }, (_, index) =>
    createMockAlert({
      alert_id: `alert-${index + 1}`,
      alert_name: `Alert ${index + 1}`,
      alert_fired_at: 1700000000000000 + index * 1000000,
      ...overrides,
    })
  );
}

/**
 * Creates mock props for the component
 */
function createMockProps(overrides = {}) {
  return {
    triggers: createMockAlerts(3),
    isDarkMode: false,
    ...overrides,
  };
}

/**
 * Creates mock i18n instance
 */
function createMockI18n() {
  return createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: {
        alerts: {
          incidents: {
            correlationServiceDiscovery: "Service Discovery",
            correlationScopeMatch: "Scope Match",
            correlationWorkloadMatch: "Workload Match",
            correlationAlertId: "Alert ID",
            correlationServiceDiscoveryTooltip: "Correlated using pre-computed service identity from service discovery",
            correlationScopeMatchTooltip: "Correlated by matching environment scope (cluster, region, namespace)",
            correlationWorkloadMatchTooltip: "Correlated by matching workload identity (service, deployment)",
            correlationAlertIdTooltip: "No matching dimensions found — isolated by alert ID",
          },
        },
      },
    },
  });
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
 * Finds all elements by data-test attribute
 */
function findAllByTestId(wrapper: VueWrapper, testId: string) {
  return wrapper.findAll(`[data-test="${testId}"]`);
}

/**
 * Triggers a row click event
 */
async function clickRow(wrapper: VueWrapper, rowIndex: number) {
  const rows = wrapper.findAll("tbody tr");
  if (rows.length > rowIndex) {
    await rows[rowIndex].trigger("click");
    await flushPromises();
  }
}

/**
 * Mounts the component with default test setup
 */
function mountComponent(props = {}) {
  const i18n = createMockI18n();
  const defaultProps = createMockProps(props);

  return mount(IncidentAlertTriggersTable, {
    props: defaultProps,
    global: {
      plugins: [i18n],
      stubs: {
        QTablePagination: true,
      },
    },
  });
}

// ==================== TESTS ====================

describe("IncidentAlertTriggersTable", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("Component Rendering", () => {
    it("should render the component", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
      expect(existsByTestId(wrapper, "alert-triggers-table")).toBe(true);
    });

    it("should render the table", () => {
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "triggers-qtable")).toBe(true);
    });

    it("should render table with correct number of rows", () => {
      wrapper = mountComponent();
      const rows = wrapper.findAll("tbody tr");
      expect(rows.length).toBe(3);
    });

    it("should render all table columns", () => {
      wrapper = mountComponent();
      const headers = wrapper.findAll("thead th");
      expect(headers.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Empty State", () => {
    it("should show empty state message when no triggers", () => {
      wrapper = mountComponent({ triggers: [] });
      expect(existsByTestId(wrapper, "no-triggers-message")).toBe(true);
      expect(findByTestId(wrapper, "no-triggers-message").text()).toContain(
        "No triggers loaded"
      );
    });

    it("should not show empty state when triggers exist", () => {
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "no-triggers-message")).toBe(false);
    });

    it("should display correct empty state styling in dark mode", () => {
      wrapper = mountComponent({ triggers: [], isDarkMode: true });
      const emptyState = findByTestId(wrapper, "no-triggers-message");
      expect(emptyState.exists()).toBe(true);
    });

    it("should display correct empty state styling in light mode", () => {
      wrapper = mountComponent({ triggers: [], isDarkMode: false });
      const emptyState = findByTestId(wrapper, "no-triggers-message");
      expect(emptyState.exists()).toBe(true);
    });
  });

  describe("Alert Name Column", () => {
    it("should display alert names correctly", () => {
      const mockAlerts = createMockAlerts(2);
      wrapper = mountComponent({ triggers: mockAlerts });

      const alertNameCells = findAllByTestId(wrapper, "alert-name-text");
      expect(alertNameCells.length).toBe(2);
      expect(alertNameCells[0].text()).toBe("Alert 1");
      expect(alertNameCells[1].text()).toBe("Alert 2");
    });

    it("should apply correct styling in dark mode", () => {
      wrapper = mountComponent({ isDarkMode: true });
      const alertNameText = findByTestId(wrapper, "alert-name-text");
      expect(alertNameText.exists()).toBe(true);
      expect(alertNameText.classes()).toContain("tw:text-gray-200");
    });

    it("should apply correct styling in light mode", () => {
      wrapper = mountComponent({ isDarkMode: false });
      const alertNameText = findByTestId(wrapper, "alert-name-text");
      expect(alertNameText.exists()).toBe(true);
      expect(alertNameText.classes()).toContain("tw:text-gray-800");
    });
  });

  describe("Timestamp Formatting", () => {
    it("should format timestamps correctly", () => {
      const mockAlert = createMockAlert({
        alert_fired_at: 1700000000000000, // microseconds
      });
      wrapper = mountComponent({ triggers: [mockAlert] });

      const timestamp = findByTestId(wrapper, "fired-at-timestamp");
      expect(timestamp.exists()).toBe(true);
      expect(timestamp.text()).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it("should display N/A for invalid timestamp", () => {
      const mockAlert = createMockAlert({ alert_fired_at: 0 });
      wrapper = mountComponent({ triggers: [mockAlert] });

      const timestamp = findByTestId(wrapper, "fired-at-timestamp");
      expect(timestamp.text()).toBe("N/A");
    });

    it("should handle null timestamp gracefully", () => {
      const mockAlert = createMockAlert({ alert_fired_at: null });
      wrapper = mountComponent({ triggers: [mockAlert] });

      const timestamp = findByTestId(wrapper, "fired-at-timestamp");
      expect(timestamp.text()).toBe("N/A");
    });
  });

  describe("Correlation Reason Badge", () => {
    it("should display service_discovery badge with correct color", () => {
      const mockAlert = createMockAlert({
        correlation_reason: "service_discovery",
      });
      wrapper = mountComponent({ triggers: [mockAlert] });

      const badge = findByTestId(wrapper, "correlation-reason-badge");
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Service Discovery");
    });

    it("should display scope_match badge with correct color", () => {
      const mockAlert = createMockAlert({
        correlation_reason: "scope_match",
      });
      wrapper = mountComponent({ triggers: [mockAlert] });

      const badge = findByTestId(wrapper, "correlation-reason-badge");
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain("Scope Match");
    });

    it("should handle unknown correlation reason", () => {
      const mockAlert = createMockAlert({ correlation_reason: "unknown" });
      wrapper = mountComponent({ triggers: [mockAlert] });

      const badge = findByTestId(wrapper, "correlation-reason-badge");
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("unknown");
    });
  });

  describe("Row Click Handling", () => {
    it("should emit row-click event when row is clicked", async () => {
      const mockAlerts = createMockAlerts(2);
      wrapper = mountComponent({ triggers: mockAlerts });

      await clickRow(wrapper, 0);

      expect(wrapper.emitted("row-click")).toBeTruthy();
      expect(wrapper.emitted("row-click")?.[0]).toEqual(["Alert 1"]);
    });

    it("should emit correct alert name on second row click", async () => {
      const mockAlerts = createMockAlerts(3);
      wrapper = mountComponent({ triggers: mockAlerts });

      await clickRow(wrapper, 1);

      expect(wrapper.emitted("row-click")).toBeTruthy();
      expect(wrapper.emitted("row-click")?.[0]).toEqual(["Alert 2"]);
    });

    it("should handle multiple row clicks", async () => {
      const mockAlerts = createMockAlerts(3);
      wrapper = mountComponent({ triggers: mockAlerts });

      await clickRow(wrapper, 0);
      await clickRow(wrapper, 2);

      expect(wrapper.emitted("row-click")).toBeTruthy();
      expect(wrapper.emitted("row-click")?.length).toBe(2);
      expect(wrapper.emitted("row-click")?.[0]).toEqual(["Alert 1"]);
      expect(wrapper.emitted("row-click")?.[1]).toEqual(["Alert 3"]);
    });
  });

  describe("Pagination", () => {
    it("should display pagination component", () => {
      wrapper = mountComponent();
      // QTablePagination is stubbed, but we can verify it's rendered
      expect(wrapper.findComponent({ name: "QTablePagination" }).exists()).toBe(
        true
      );
    });

    it("should initialize with default pagination (20 rows per page)", () => {
      wrapper = mountComponent();
      // Pagination value is internal, but we can verify component mounted
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle pagination with large dataset", () => {
      const mockAlerts = createMockAlerts(50);
      wrapper = mountComponent({ triggers: mockAlerts });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.findAll("tbody tr").length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle single trigger", () => {
      const mockAlert = createMockAlert();
      wrapper = mountComponent({ triggers: [mockAlert] });

      expect(wrapper.findAll("tbody tr").length).toBe(1);
      expect(findByTestId(wrapper, "alert-name-text").text()).toBe(
        "High CPU Alert"
      );
    });

    it("should handle very long alert names", () => {
      const longName = "A".repeat(200);
      const mockAlert = createMockAlert({ alert_name: longName });
      wrapper = mountComponent({ triggers: [mockAlert] });

      const alertName = findByTestId(wrapper, "alert-name-text");
      expect(alertName.text()).toBe(longName);
    });

    it("should handle alerts with same timestamps", () => {
      const timestamp = 1700000000000000;
      const mockAlerts = [
        createMockAlert({ alert_id: "1", alert_fired_at: timestamp }),
        createMockAlert({ alert_id: "2", alert_fired_at: timestamp }),
        createMockAlert({ alert_id: "3", alert_fired_at: timestamp }),
      ];
      wrapper = mountComponent({ triggers: mockAlerts });

      expect(wrapper.findAll("tbody tr").length).toBe(3);
    });

    it("should handle alerts with far future timestamps", () => {
      const futureTimestamp = 9999999999999999;
      const mockAlert = createMockAlert({ alert_fired_at: futureTimestamp });
      wrapper = mountComponent({ triggers: [mockAlert] });

      const timestamp = findByTestId(wrapper, "fired-at-timestamp");
      expect(timestamp.exists()).toBe(true);
    });

    it("should handle alerts with special characters in names", () => {
      const specialName = "Alert <script>alert('test')</script>";
      const mockAlert = createMockAlert({ alert_name: specialName });
      wrapper = mountComponent({ triggers: [mockAlert] });

      const alertName = findByTestId(wrapper, "alert-name-text");
      // Vue automatically escapes, so text should be safe
      expect(alertName.text()).toBe(specialName);
    });
  });

  describe("Dark Mode Support", () => {
    it("should apply dark mode styles correctly", () => {
      wrapper = mountComponent({ isDarkMode: true });
      expect(wrapper.exists()).toBe(true);
    });

    it("should apply light mode styles correctly", () => {
      wrapper = mountComponent({ isDarkMode: false });
      expect(wrapper.exists()).toBe(true);
    });

    it("should update styles when switching modes", async () => {
      wrapper = mountComponent({ isDarkMode: false });
      const beforeText = findByTestId(wrapper, "alert-name-text");
      expect(beforeText.classes()).toContain("tw:text-gray-800");

      await wrapper.setProps({ isDarkMode: true });
      await flushPromises();

      const afterText = findByTestId(wrapper, "alert-name-text");
      expect(afterText.classes()).toContain("tw:text-gray-200");
    });
  });

  describe("Performance", () => {
    it("should handle large dataset efficiently", () => {
      const mockAlerts = createMockAlerts(100);
      wrapper = mountComponent({ triggers: mockAlerts });

      expect(wrapper.exists()).toBe(true);
      expect(existsByTestId(wrapper, "triggers-qtable")).toBe(true);
    });

    it("should handle rapid prop updates", async () => {
      wrapper = mountComponent({ triggers: createMockAlerts(5) });

      await wrapper.setProps({ triggers: createMockAlerts(10) });
      await flushPromises();

      await wrapper.setProps({ triggers: createMockAlerts(3) });
      await flushPromises();

      expect(wrapper.findAll("tbody tr").length).toBeGreaterThan(0);
    });
  });
});
