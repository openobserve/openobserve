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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref, shallowRef } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import TurnOnAlertsDrawer from "./TurnOnAlertsDrawer.vue";
import { fakeFlow, PACK } from "./starterPackTestFlow";

const fake = vi.hoisted(() => ({
  turn: null as any,
  push: vi.fn(async () => {}),
  resolve: vi.fn(() => ({ href: "/alert-destinations?action=add" })),
  destinations: [{ name: "pager" }] as Array<{ name: string }>,
}));

vi.mock("@/composables/starterPacks/useTurnOnAlerts", () => ({
  useTurnOnAlerts: () => fake.turn,
}));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: vi.fn(async () => fake.destinations),
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: fake.push, resolve: fake.resolve }),
}));

const row = (id: string, severity: string, result: Record<string, unknown> | null) => ({
  id,
  name: id,
  severity,
  enabled: false,
  alert: { trigger_condition: { period: 5, frequency: 10 }, query_condition: {} },
  state: "ready",
  result,
  chosen: true,
  touched: false,
});

const result = (incidents: number, checkedSeconds = 2280) => ({
  incidents,
  runs: incidents * 2,
  checkedSeconds,
  noData: false,
});

const turnFor = (rows: any[]) => {
  const list = shallowRef(rows);
  return {
    rows: list,
    loadState: ref("ready"),
    load: vi.fn(),
    choose: vi.fn(),
    retryRow: vi.fn(),
    setThreshold: vi.fn(async () => true),
    turnOn: vi.fn(async () => 1),
    failedIds: ref([]),
    forbidden: ref(false),
    submitting: ref(false),
    needsCritical: ref(true),
    needsWarning: ref(false),
    chosenRows: computed(() => list.value.filter(({ chosen }) => chosen)),
    summary: computed(() => ({
      incidents: 1,
      runs: 2,
      leftOffIncidents: 3,
      lowConfidence: true,
      checkedSeconds: 2280,
    })),
  };
};

const render = async (flow = fakeFlow()) => {
  const wrapper = mount(TurnOnAlertsDrawer, {
    props: { flow, clusters: ["eu-1"], open: true },
    attachTo: document.body,
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: { template: "<div><slot /><slot name='footer' /></div>" },
        OIcon: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};
const text = (wrapper: any, id: string) => wrapper.get(`[data-test="${id}"]`).text();

describe("TurnOnAlertsDrawer", () => {
  beforeEach(() => {
    fake.turn = turnFor([row("a", "critical", result(1))]);
    fake.destinations = [{ name: "pager" }];
  });

  it("shows hours checked, marks short history, and never says a day", async () => {
    const wrapper = await render();
    const summary = text(wrapper, "turn-on-alerts-summary");
    expect(summary).toContain("38 min checked");
    expect(summary).not.toMatch(/a day|per day|24 h/);
    expect(wrapper.find('[data-test="turn-on-alerts-low-confidence-tag"]').exists()).toBe(true);
  });

  it("says why a noisy alert is off", async () => {
    const noisy = { ...row("b", "warning", result(3)), chosen: false };
    fake.turn = turnFor([row("a", "critical", result(1)), noisy]);
    const wrapper = await render();
    expect(text(wrapper, "turn-on-alerts-noisy-tag")).toContain("over 2 incidents");
    expect(text(wrapper, "turn-on-alerts-left-off")).toContain("b");
  });

  it("does not submit without a destination", async () => {
    const wrapper = await render();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(fake.turn.turnOn).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Without one these alerts reach nobody");
  });

  it("shows No data, not zero incidents, when nothing came back", async () => {
    fake.turn = turnFor([row("a", "critical", { ...result(0, 0), noData: true })]);
    const wrapper = await render();
    expect(wrapper.find('[data-test="turn-on-alerts-check-collector-link"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("0 incidents");
  });

  it("sends the collector link to the pack's own ingestion guide", async () => {
    fake.turn = turnFor([row("a", "critical", { ...result(0, 0), noData: true })]);
    const hosts = fakeFlow({ pack: { ...PACK, id: "hosts", collectorRoute: "ingestFromLinux" } });
    const wrapper = await render(hosts);
    await wrapper.get('[data-test="turn-on-alerts-check-collector-link"]').trigger("click");
    expect(fake.push).toHaveBeenCalledWith({
      name: "ingestFromLinux",
      query: { org_identifier: expect.anything() },
    });
    const none = fakeFlow({ pack: { ...PACK, collectorRoute: undefined } });
    expect(
      (await render(none)).find('[data-test="turn-on-alerts-check-collector-link"]').exists(),
    ).toBe(false);
  });

  it("offers Retry on a row that could not be checked", async () => {
    fake.turn = turnFor([{ ...row("a", "critical", null), state: "error" }]);
    const wrapper = await render();
    await wrapper.get('[data-test="turn-on-alerts-row-retry-btn"]').trigger("click");
    expect(fake.turn.retryRow).toHaveBeenCalledWith("a");
  });

  it("opens Alert Destinations in a new tab and selects the one added there", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const wrapper = await render();
    await wrapper.get('[data-test="turn-on-alerts-new-destination-btn"]').trigger("click");
    expect(fake.resolve).toHaveBeenCalledWith({
      name: "alertDestinations",
      query: { action: "add", org_identifier: expect.anything() },
    });
    expect(opened).toHaveBeenCalledWith("/alert-destinations?action=add", "_blank");
    fake.destinations = [{ name: "pager" }, { name: "platform-alerts" }];
    window.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(text(wrapper, "turn-on-alerts-critical-destination")).toContain("platform-alerts");
    expect(text(wrapper, "turn-on-alerts-warning-destination")).toContain("platform-alerts");
    opened.mockRestore();
  });

  it("leaves the lists alone on focus when no destination was being added", async () => {
    const wrapper = await render();
    fake.destinations = [{ name: "pager" }, { name: "platform-alerts" }];
    window.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(text(wrapper, "turn-on-alerts-critical-destination")).not.toContain("platform-alerts");
  });

  it("labels the table columns and splits the run count from the history checked", async () => {
    fake.turn = turnFor([
      row("a", "critical", { incidents: 0, runs: 24, checkedSeconds: 7200, noData: false }),
      row("b", "warning", { incidents: 0, runs: 288, checkedSeconds: 86400, noData: false }),
    ]);
    const wrapper = await render();
    expect(text(wrapper, "turn-on-alerts-table-header")).toBe(
      "AlertWould have firedHistory checked",
    );
    const first = wrapper.get('[data-test="turn-on-alerts-row-a"]');
    expect(first.get('[data-test="turn-on-alerts-fired"]').text()).toBe("0 incidents · 24 runs");
    expect(first.get('[data-test="turn-on-alerts-history"]').text()).toContain("2 h of 24 h");
    expect(first.find('[data-test="turn-on-alerts-partial-tag"]').exists()).toBe(true);
    const second = wrapper.get('[data-test="turn-on-alerts-row-b"]');
    expect(second.get('[data-test="turn-on-alerts-history"]').text()).toBe("24 h");
  });

  it("names each row by its library title, like Pack details", async () => {
    fake.turn = turnFor([row("a", "critical", result(0))]);
    const wrapper = await render(fakeFlow({ alertTitle: (id: string) => `Title ${id}` }));
    expect(text(wrapper, "turn-on-alerts-title-a")).toBe("Title a");
    expect(wrapper.find('[aria-label="Title a"]').exists()).toBe(true);
  });

  it("puts No data in the History checked column with nothing fired", async () => {
    fake.turn = turnFor([
      row("a", "critical", { ...result(0, 0), noData: true }),
      row("b", "warning", result(1)),
    ]);
    const wrapper = await render();
    const first = wrapper.get('[data-test="turn-on-alerts-row-a"]');
    expect(first.find('[data-test="turn-on-alerts-no-data-tag"]').exists()).toBe(true);
    expect(first.find('[data-test="turn-on-alerts-fired"]').exists()).toBe(false);
  });

  it("shows the notes, scope and cost without a More details toggle", async () => {
    const wrapper = await render();
    for (const id of ["history-note", "noise-rule", "scope", "cost"]) {
      expect(wrapper.find(`[data-test="turn-on-alerts-${id}"]`).isVisible()).toBe(true);
    }
    expect(wrapper.find('[data-test="turn-on-alerts-more-details"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="turn-on-alerts-limit-clusters-btn"]').exists()).toBe(true);
  });

  it("ticks only the preselected alerts once the rows load", async () => {
    fake.turn = turnFor([row("a", "critical", result(0)), row("b", "warning", result(0))]);
    fake.turn.loadState.value = "loading";
    const wrapper = mount(TurnOnAlertsDrawer, {
      props: { flow: fakeFlow(), clusters: [], open: true, preselectIds: ["b"] },
      global: {
        plugins: [i18n, store],
        stubs: { ODrawer: { template: "<div><slot /><slot name='footer' /></div>" }, OIcon: true },
      },
    });
    fake.turn.loadState.value = "ready";
    await flushPromises();
    expect(fake.turn.choose).toHaveBeenCalledWith("a", false);
    expect(fake.turn.choose).toHaveBeenCalledWith("b", true);
    wrapper.unmount();
  });

  it("names the alerts that did not turn on in the footer, with Retry", async () => {
    fake.turn = turnFor([row("a", "critical", result(0)), row("b", "warning", result(0))]);
    fake.turn.failedIds.value = ["b"];
    const wrapper = await render();
    expect(text(wrapper, "turn-on-alerts-failed")).toContain("b didn't turn on.");
    await wrapper.get('[data-test="turn-on-alerts-retry-btn"]').trigger("click");
    await flushPromises();
    expect(fake.turn.turnOn).toHaveBeenCalledWith(expect.anything(), ["b"]);
  });

  it("offers the on-call preview to nobody on OSS", async () => {
    const wrapper = await render();
    expect(wrapper.find('[data-test="turn-on-alerts-oncall-preview"]').exists()).toBe(false);
  });

  it("asks for an admin when the write is refused", async () => {
    fake.turn.forbidden.value = true;
    const wrapper = await render();
    expect(wrapper.find('[data-test="turn-on-alerts-copy-link-btn"]').exists()).toBe(true);
  });
  const editThreshold = async (wrapper: any, value: string) => {
    await wrapper.get('[data-test="turn-on-alerts-row-expand"]').trigger("click");
    await wrapper.get('[data-test="turn-on-alerts-edit-threshold-btn"]').trigger("click");
    await wrapper.get('[data-test="turn-on-alerts-threshold-input"] input').setValue(value);
    await wrapper.get('[data-test="turn-on-alerts-threshold-save-btn"]').trigger("click");
    await flushPromises();
  };
  const thresholdError = (wrapper: any) =>
    wrapper.find('[data-test="turn-on-alerts-threshold-input-error"]');

  it("says a threshold must be a number instead of saving nothing", async () => {
    const wrapper = await render();
    await editThreshold(wrapper, "");
    expect(fake.turn.setThreshold).not.toHaveBeenCalled();
    expect(thresholdError(wrapper).attributes("data-test-error-text")).toBe(
      i18n.global.t("starterPacks.turnOn.thresholdInvalid"),
    );
  });

  it("keeps the edit open and says so when the threshold save fails", async () => {
    fake.turn.setThreshold = vi.fn(async () => false);
    const wrapper = await render();
    await editThreshold(wrapper, "7");
    expect(fake.turn.setThreshold).toHaveBeenCalledWith("a", 7);
    expect(thresholdError(wrapper).attributes("data-test-error-text")).toBe(
      i18n.global.t("starterPacks.turnOn.thresholdFailed"),
    );
  });

  it("drops a half-done threshold edit when the drawer reopens", async () => {
    const wrapper = await render();
    await wrapper.get('[data-test="turn-on-alerts-row-expand"]').trigger("click");
    await wrapper.get('[data-test="turn-on-alerts-edit-threshold-btn"]').trigger("click");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(wrapper.find('[data-test="turn-on-alerts-threshold-input"]').exists()).toBe(false);
  });

  it("stops looking for a new destination once the drawer closes", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const wrapper = await render();
    await wrapper.get('[data-test="turn-on-alerts-new-destination-btn"]').trigger("click");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    fake.destinations = [{ name: "pager" }, { name: "platform-alerts" }];
    window.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(text(wrapper, "turn-on-alerts-critical-destination")).not.toContain("platform-alerts");
    opened.mockRestore();
  });
});
