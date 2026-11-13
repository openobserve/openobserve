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

import { beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import autoobserve from "@/services/autoobserve";
import { installFacts, problemsIn, scenarioFacts } from "@/components/autoobserve/data/facts";
import AutoObserve from "./AutoObserve.vue";
import AutoObserve2 from "./AutoObserve2.vue";

const routeQuery: Record<string, string> = {};
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ query: routeQuery }),
}));
vi.mock("@/services/autoobserve", () => ({
  default: {
    coverage: vi.fn(),
    suggestions: vi.fn(),
    incidents: vi.fn(),
    pagingSettings: vi.fn(),
  },
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

// A production build loads no sample facts, so both views must render live mode from an empty store.
describe("AutoObserve with no sample facts (production build)", () => {
  beforeAll(() => {
    installFacts({
      PROBLEMS: {},
      LEDGER: [],
      EVENTS: [],
      EVENT_PROBLEM: {},
      SCENARIO_BASE: {} as never,
      servicesFor: () => [],
      streamsFor: () => [],
    });
    for (const fn of Object.values(autoobserve)) vi.mocked(fn).mockReturnValue(pending());
    localStorage.setItem("autoobserve2.howItWorksSeen", "1");
  });

  it("reads every scenario as empty", () => {
    expect(scenarioFacts("demo").services).toEqual([]);
    expect(problemsIn("demo", "quarter")).toEqual([]);
  });

  it.each([
    ["standard", AutoObserve2, "autoobserve2-paged"],
    ["nerd", AutoObserve, "autoobserve-live-issues"],
  ] as const)("the %s view renders its live surfaces without an error", async (_, view, testId) => {
    const errors: unknown[] = [];
    const w = mount(view, {
      global: { plugins: [i18n, store], config: { errorHandler: (e) => errors.push(e) } },
    });
    await flushPromises();
    expect(errors).toEqual([]);
    expect(w.find(`[data-test^="${testId}"]`).exists()).toBe(true);
    w.unmount();
  });
});
