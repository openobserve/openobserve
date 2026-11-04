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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import autoobserve from "@/services/autoobserve";
import { SCENARIOS } from "@/components/autoobserve/data/facts";
import { scenarioData } from "@/components/autoobserve/v2/fixtures";
import LivePaged from "@/components/autoobserve/live/LivePaged.vue";
import LiveSuggestions from "@/components/autoobserve/live/LiveSuggestions.vue";
import AutoObserve2 from "./AutoObserve2.vue";

const routeQuery: Record<string, string> = {};
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ query: routeQuery }),
}));

vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn(), incidents: vi.fn() },
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const pending = () => new Promise<never>(() => undefined);

// A fixture scenario with no suggestions of its own, so only live mode can hold the rail open.
const quiet = SCENARIOS.find(
  (s) => scenarioData(s).requests.filter((r) => r.kind !== "fixNow").length === 0,
);

const mountView = () =>
  shallowMount(AutoObserve2, {
    global: { plugins: [i18n, store] },
  });

describe("AutoObserve2 rail column (OSS-9)", () => {
  beforeEach(() => {
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    vi.mocked(autoobserve.coverage).mockReturnValue(pending());
    vi.mocked(autoobserve.suggestions).mockReturnValue(pending());
    vi.mocked(autoobserve.incidents).mockReset();
    vi.mocked(autoobserve.incidents).mockReturnValue(pending());
  });

  it("has a fixture scenario with no suggestions to test against", () => {
    expect(quiet).toBeDefined();
  });

  it("holds the rail's column from first paint in live mode, before anything loads", () => {
    Object.assign(routeQuery, { live: "1", scenario: quiet ?? "" });
    const wrapper = mountView();
    expect(wrapper.find('[data-test="autoobserve2-rail"]').exists()).toBe(true);
    expect(wrapper.html()).toContain("@min-[60rem]:grid-cols-[minmax(0,44rem)_20rem]");
  });

  it("keeps the single column in fixture mode when there is nothing to suggest", () => {
    Object.assign(routeQuery, { scenario: quiet ?? "" });
    const wrapper = mountView();
    expect(wrapper.find('[data-test="autoobserve2-rail"]').exists()).toBe(false);
  });

  it("the paged card shows only in live mode, first in the rail", () => {
    Object.assign(routeQuery, { live: "1", scenario: quiet ?? "" });
    const wrapper = mountView();
    const rail = wrapper.find('[data-test="autoobserve2-rail-scroll"]');
    const order = Array.from(rail.element.children);
    const paged = wrapper.findComponent(LivePaged);
    expect(paged.exists()).toBe(true);
    expect(order.indexOf(paged.element)).toBe(0);
    expect(order.indexOf(wrapper.findComponent(LiveSuggestions).element)).toBe(1);
    expect(paged.classes()).toEqual(expect.arrayContaining(["order-2", "shrink-0"]));
    wrapper.unmount();

    delete routeQuery.live;
    const fixtureView = mountView();
    expect(fixtureView.findComponent(LivePaged).exists()).toBe(false);
    expect(autoobserve.incidents).not.toHaveBeenCalled();
  });
});
