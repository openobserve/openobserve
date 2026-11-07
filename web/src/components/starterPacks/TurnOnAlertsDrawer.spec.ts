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
import { computed, nextTick, ref, shallowRef } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import TurnOnAlertsDrawer from "./TurnOnAlertsDrawer.vue";
import { fakeFlow } from "./starterPackTestFlow";

const fake = vi.hoisted(() => ({ turn: null as any }));

vi.mock("@/composables/starterPacks/useTurnOnAlerts", () => ({
  useTurnOnAlerts: () => fake.turn,
}));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: vi.fn(async ({ queryKey }: { queryKey: unknown[] }) =>
    JSON.stringify(queryKey).includes("template") ? [{ name: "tpl" }] : [{ name: "pager" }],
  ),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

const render = async () => {
  const wrapper = mount(TurnOnAlertsDrawer, {
    props: { flow: fakeFlow(), clusters: ["eu-1"], open: true },
    attachTo: document.body,
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: { template: "<div><slot /><slot name='footer' /></div>" },
        AddDestination: {
          props: ["templates"],
          template:
            "<div data-test='add-destination'>{{ templates.map((row) => row.name).join() }}</div>",
        },
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

  it("offers Retry on a row that could not be checked", async () => {
    fake.turn = turnFor([{ ...row("a", "critical", null), state: "error" }]);
    const wrapper = await render();
    await wrapper.get('[data-test="turn-on-alerts-row-retry-btn"]').trigger("click");
    expect(fake.turn.retryRow).toHaveBeenCalledWith("a");
  });

  it("opens New destination inside the drawer", async () => {
    const wrapper = await render();
    await wrapper.get('[data-test="turn-on-alerts-new-destination-btn"]').trigger("click");
    await nextTick();
    expect(wrapper.find('[data-test="add-destination"]').exists()).toBe(true);
  });

  it("gives New destination the org's templates", async () => {
    const wrapper = await render();
    await wrapper.get('[data-test="turn-on-alerts-new-destination-btn"]').trigger("click");
    await flushPromises();
    expect(text(wrapper, "add-destination")).toBe("tpl");
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
});
