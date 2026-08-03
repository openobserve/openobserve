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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import IncidentAlertTriggersTable from "./IncidentAlertTriggersTable.vue";
import { createI18n } from "vue-i18n";
import incidentsService from "@/services/incidents";

vi.mock("@/services/incidents", () => ({
  default: {
    getExternalAlertPayload: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers & factories
// ---------------------------------------------------------------------------

function makeAlert(overrides: Record<string, any> = {}) {
  return {
    incident_id: "incident-1",
    alert_id: "alert-1",
    alert_name: "High CPU Alert",
    alert_fired_at: 1700000000000000,
    correlation_reason: "service_discovery",
    created_at: 1700000000000000,
    ...overrides,
  };
}

function makeAlerts(count = 3, overrides: Record<string, any> = {}) {
  return Array.from({ length: count }, (_, i) =>
    makeAlert({
      alert_id: `alert-${i + 1}`,
      alert_name: `Alert ${i + 1}`,
      created_at: 1700000000000000 + i,
      ...overrides,
    }),
  );
}

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: {
        alerts: {
          incidents: {
            correlationServiceDiscovery: "Service Discovery",
            correlationPrimaryMatch: "Primary Match",
            correlationSecondaryMatch: "Secondary Match",
            correlationAlertId: "Alert ID",
            correlationServiceDiscoveryTooltip: "Tooltip SD",
            correlationPrimaryMatchTooltip: "Tooltip PM",
            correlationSecondaryMatchTooltip: "Tooltip SM",
            correlationAlertIdTooltip: "Tooltip AI",
            viewPayload: "View raw payload",
            rawPayloadTitle: "Raw alert payload",
            rawPayloadError: "Failed to load the raw payload for this alert",
          },
        },
      },
    },
  });
}

function mountComp(props: Record<string, any> = {}) {
  const i18n = makeI18n();
  const store = createStore({
    state: { selectedOrganization: { identifier: "myorg" } },
  });
  return mount(IncidentAlertTriggersTable, {
    props: {
      triggers: makeAlerts(3),
      isDarkMode: false,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        OTable: {
          template: `
            <div data-test="triggers-qtable">
              <template v-if="data && data.length === 0">
                <slot name="empty" />
              </template>
              <table v-else>
                <thead><tr><th>Alert Name</th><th>Source</th><th>Labels</th><th>Fired At</th><th>Reason</th><th>Actions</th></tr></thead>
                <tbody>
                  <tr v-for="(row, idx) in data" :key="idx" @click="$emit('row-click', row)">
                    <td><slot :name="'cell-alert_name'" :row="row" /></td>
                    <td><slot :name="'cell-detected_source'" :row="row" /></td>
                    <td><slot :name="'cell-labels'" :row="row" /></td>
                    <td><slot :name="'cell-alert_fired_at'" :row="row" /></td>
                    <td><slot :name="'cell-correlation_reason'" :row="row" /></td>
                    <td><slot :name="'cell-actions'" :row="row" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          `,
          props: ["data", "columns", "rowKey", "pagination", "pageSize"],
          emits: ["row-click"],
        },
        OBadge: {
          template: '<span data-test="correlation-reason-badge"><slot /></span>',
          props: ["variant"],
        },
        OTooltip: { template: "<span />" },
        ODialog: {
          template: `<div data-test="trigger-payload-dialog"><slot v-if="open" /></div>`,
          props: ["open"],
          emits: ["update:open"],
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IncidentAlertTriggersTable", () => {
  let wrapper: VueWrapper;

  afterEach(() => wrapper?.unmount());

  describe("renders with minimum props", () => {
    it("renders the root container", () => {
      wrapper = mountComp();
      expect(wrapper.find('[data-test="alert-triggers-table"]').exists()).toBe(true);
    });

    it("renders the OTable stub", () => {
      wrapper = mountComp();
      expect(wrapper.find('[data-test="triggers-qtable"]').exists()).toBe(true);
    });
  });

  describe("empty state", () => {
    it("shows empty message when triggers is empty", () => {
      wrapper = mountComp({ triggers: [] });
      expect(wrapper.find('[data-test="no-triggers-message"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="no-triggers-message"]').text()).toContain(
        "No triggers loaded",
      );
    });

    it("does not show empty message when triggers are present", () => {
      wrapper = mountComp({ triggers: makeAlerts(2) });
      expect(wrapper.find('[data-test="no-triggers-message"]').exists()).toBe(false);
    });
  });

  describe("alert name column", () => {
    it("renders alert name text for each row", () => {
      wrapper = mountComp({ triggers: makeAlerts(2) });
      const names = wrapper.findAll('[data-test="alert-name-text"]');
      expect(names.length).toBe(2);
      expect(names[0].text()).toBe("Alert 1");
      expect(names[1].text()).toBe("Alert 2");
    });

    it("renders alert name for a single trigger", () => {
      wrapper = mountComp({ triggers: [makeAlert({ alert_name: "My Alert" })] });
      expect(wrapper.find('[data-test="alert-name-text"]').text()).toBe("My Alert");
    });
  });

  describe("timestamp column", () => {
    it("renders a formatted timestamp element for each row", () => {
      wrapper = mountComp({ triggers: makeAlerts(2) });
      const timestamps = wrapper.findAll('[data-test="fired-at-timestamp"]');
      expect(timestamps.length).toBe(2);
    });

    it("shows N/A when alert_fired_at is 0", () => {
      wrapper = mountComp({ triggers: [makeAlert({ alert_fired_at: 0 })] });
      expect(wrapper.find('[data-test="fired-at-timestamp"]').text()).toBe("N/A");
    });

    it("shows N/A when alert_fired_at is null", () => {
      wrapper = mountComp({ triggers: [makeAlert({ alert_fired_at: null })] });
      expect(wrapper.find('[data-test="fired-at-timestamp"]').text()).toBe("N/A");
    });

    it("shows formatted date when alert_fired_at is non-zero", () => {
      wrapper = mountComp({ triggers: [makeAlert({ alert_fired_at: 1700000000000000 })] });
      const text = wrapper.find('[data-test="fired-at-timestamp"]').text();
      expect(text).not.toBe("N/A");
      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe("correlation reason badge", () => {
    it("shows Service Discovery label for service_discovery reason", () => {
      wrapper = mountComp({ triggers: [makeAlert({ correlation_reason: "service_discovery" })] });
      expect(wrapper.find('[data-test="correlation-reason-badge"]').text()).toBe(
        "Service Discovery",
      );
    });

    it("shows Primary Match label for primary_match reason", () => {
      wrapper = mountComp({ triggers: [makeAlert({ correlation_reason: "primary_match" })] });
      expect(wrapper.find('[data-test="correlation-reason-badge"]').text()).toContain(
        "Primary Match",
      );
    });

    it("shows Secondary Match label for secondary_match reason", () => {
      wrapper = mountComp({ triggers: [makeAlert({ correlation_reason: "secondary_match" })] });
      expect(wrapper.find('[data-test="correlation-reason-badge"]').text()).toContain(
        "Secondary Match",
      );
    });

    it("shows Alert ID label for alert_id reason", () => {
      wrapper = mountComp({ triggers: [makeAlert({ correlation_reason: "alert_id" })] });
      expect(wrapper.find('[data-test="correlation-reason-badge"]').text()).toContain("Alert ID");
    });

    it("humanises an unknown correlation reason", () => {
      wrapper = mountComp({ triggers: [makeAlert({ correlation_reason: "unknown_reason" })] });
      expect(wrapper.find('[data-test="correlation-reason-badge"]').text()).toBe("Unknown Reason");
    });
  });

  describe("row click handling", () => {
    it("emits row-click with alert_name on row click", async () => {
      wrapper = mountComp({ triggers: makeAlerts(2) });
      const rows = wrapper.findAll("tbody tr");
      await rows[0].trigger("click");
      await flushPromises();
      expect(wrapper.emitted("row-click")).toBeTruthy();
      expect(wrapper.emitted("row-click")?.[0]).toEqual(["Alert 1"]);
    });

    it("emits correct alert_name for second row", async () => {
      wrapper = mountComp({ triggers: makeAlerts(3) });
      const rows = wrapper.findAll("tbody tr");
      await rows[1].trigger("click");
      await flushPromises();
      expect(wrapper.emitted("row-click")?.[0]).toEqual(["Alert 2"]);
    });

    it("handles multiple row clicks and accumulates emissions", async () => {
      wrapper = mountComp({ triggers: makeAlerts(3) });
      const rows = wrapper.findAll("tbody tr");
      await rows[0].trigger("click");
      await rows[2].trigger("click");
      await flushPromises();
      expect(wrapper.emitted("row-click")?.length).toBe(2);
      expect(wrapper.emitted("row-click")?.[0]).toEqual(["Alert 1"]);
      expect(wrapper.emitted("row-click")?.[1]).toEqual(["Alert 3"]);
    });
  });

  describe("isDarkMode prop branches", () => {
    it("renders without error in dark mode", () => {
      wrapper = mountComp({ isDarkMode: true, triggers: [] });
      expect(wrapper.find('[data-test="no-triggers-message"]').exists()).toBe(true);
    });

    it("renders without error in light mode", () => {
      wrapper = mountComp({ isDarkMode: false, triggers: [] });
      expect(wrapper.find('[data-test="no-triggers-message"]').exists()).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles very long alert names", () => {
      const longName = "X".repeat(300);
      wrapper = mountComp({ triggers: [makeAlert({ alert_name: longName })] });
      expect(wrapper.find('[data-test="alert-name-text"]').text()).toBe(longName);
    });

    it("handles special characters in alert names", () => {
      const name = `Alert <script>alert('x')</script>`;
      wrapper = mountComp({ triggers: [makeAlert({ alert_name: name })] });
      expect(wrapper.find('[data-test="alert-name-text"]').text()).toBe(name);
    });
  });

  describe("external source detail (source_url/labels/detected_source)", () => {
    it("shows a source badge for external triggers", () => {
      wrapper = mountComp({
        triggers: [makeAlert({ alert_kind: "external", detected_source: "grafana" })],
      });
      expect(wrapper.find('[data-test="trigger-source-badge"]').text()).toBe("grafana");
    });

    it("shows a dash for internal triggers with no detected_source", () => {
      wrapper = mountComp({ triggers: [makeAlert({ alert_kind: "internal" })] });
      expect(wrapper.find('[data-test="trigger-source-badge"]').exists()).toBe(false);
    });

    it("renders a label chip per key/value pair", () => {
      wrapper = mountComp({
        triggers: [
          makeAlert({
            alert_kind: "external",
            labels: { service: "checkout-api", region: "us-east" },
          }),
        ],
      });
      const chips = wrapper.findAll('[data-test="trigger-label-chip"]');
      expect(chips.length).toBe(2);
      expect(chips.map((c) => c.text())).toEqual(
        expect.arrayContaining(["service=checkout-api", "region=us-east"]),
      );
    });

    it("shows a dash when a trigger has no labels", () => {
      wrapper = mountComp({ triggers: [makeAlert({ alert_kind: "external", labels: null })] });
      expect(wrapper.findAll('[data-test="trigger-label-chip"]').length).toBe(0);
    });
  });

  describe("view raw payload", () => {
    it("shows the payload button only for external-kind triggers", () => {
      wrapper = mountComp({
        triggers: [
          makeAlert({ alert_id: "ext-1", alert_kind: "external" }),
          makeAlert({ alert_id: "int-1", alert_kind: "internal" }),
        ],
      });
      expect(wrapper.findAll('[data-test="trigger-view-payload-btn"]').length).toBe(1);
    });

    it("fetches and displays the raw payload when clicked", async () => {
      (incidentsService.getExternalAlertPayload as any).mockResolvedValue({
        data: {
          id: "ext-1",
          detected_source: "grafana",
          source_url: "https://grafana.example.com/alert/1",
          first_seen_at: 1,
          last_seen_at: 2,
          last_payload: { alertname: "HighCPU", status: "firing" },
        },
      });
      wrapper = mountComp({
        triggers: [makeAlert({ alert_id: "ext-1", alert_kind: "external" })],
      });
      await wrapper.find('[data-test="trigger-view-payload-btn"]').trigger("click");
      await flushPromises();

      expect(incidentsService.getExternalAlertPayload).toHaveBeenCalledWith("myorg", "ext-1");
      const json = wrapper.find('[data-test="trigger-payload-json"]');
      expect(json.text()).toContain("HighCPU");
      expect(json.text()).toContain("firing");
    });

    it("shows an error message when the payload fetch fails", async () => {
      (incidentsService.getExternalAlertPayload as any).mockRejectedValue(new Error("boom"));
      wrapper = mountComp({
        triggers: [makeAlert({ alert_id: "ext-1", alert_kind: "external" })],
      });
      await wrapper.find('[data-test="trigger-view-payload-btn"]').trigger("click");
      await flushPromises();

      expect(wrapper.text()).toContain("Failed to load the raw payload for this alert");
    });
  });
});
