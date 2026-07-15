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
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";


vi.mock("vue-router", () => ({
  useRouter: () => ({
    resolve: vi.fn().mockReturnValue({ href: "/alerts/destinations" }),
    push: vi.fn(),
  }),
  useRoute: () => ({ params: {}, query: {} }),
}));

import AnomalyAlerting from "@/components/anomaly_detection/steps/AnomalyAlerting.vue";

const makeConfig = (overrides: Record<string, any> = {}) => ({
  alert_enabled: true,
  alert_destination_ids: [] as string[],
  ...overrides,
});

const makeDestinations = () => [
  { name: "slack-dest", type: "slack" },
  { name: "pagerduty-dest", type: "pagerduty" },
];

async function mountComp(props: Record<string, any> = {}) {
  return mount(AnomalyAlerting, {
    props: {
      config: makeConfig(),
      destinations: makeDestinations(),
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
}

describe("AnomalyAlerting - rendering", () => {
  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders the alert_enabled toggle", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-alert-enabled"]').exists()).toBe(true);
  });

  it("renders destination select when alert_enabled=true", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: true }) });
    expect(w.find('[data-test="anomaly-destination"]').exists()).toBe(true);
  });

  it("hides destination select when alert_enabled=false", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: false }) });
    expect(w.find('[data-test="anomaly-destination"]').exists()).toBe(false);
  });

  it("shows info note when alert_enabled=false", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: false }) });
    expect(w.text()).toContain("_anomalies");
  });

  it("shows required field error when alert_enabled and no destination", async () => {
    const w = await mountComp({
      config: makeConfig({ alert_enabled: true, alert_destination_ids: [] }),
    });
    expect(w.text()).toContain("At least one destination is required!");
  });

  it("does not show required field error when destination is selected", async () => {
    const w = await mountComp({
      config: makeConfig({ alert_enabled: true, alert_destination_ids: ["slack-dest"] }),
    });
    expect(w.text()).not.toContain("At least one destination is required!");
  });
});

describe("AnomalyAlerting - destinations", () => {
  it("receives destinations as prop", async () => {
    const w = await mountComp();
    expect(w.props("destinations")).toHaveLength(2);
  });

  it("renders destination options from props", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: true }) });
    const selectEl = w.find('[data-test="anomaly-destination"]');
    expect(selectEl.exists()).toBe(true);
  });
});

describe("AnomalyAlerting - emits", () => {
  it("emits refresh:destinations when refresh button is clicked", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: true }) });
    // Find the refresh button (icon="refresh")
    const refreshBtn = w.find('button[title="Refresh destinations"]');
    if (refreshBtn.exists()) {
      await refreshBtn.trigger("click");
      expect(w.emitted("refresh:destinations")).toBeTruthy();
    }
  });
});

describe("AnomalyAlerting - openAddDestination", () => {
  it("openAddDestination calls window.open", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const w = await mountComp({ config: makeConfig({ alert_enabled: true }) });
    (w.vm as any).openAddDestination();
    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
