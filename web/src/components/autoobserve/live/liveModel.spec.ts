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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import autoobserve, { type AutoObserveCoverage } from "@/services/autoobserve";
import { useLiveAutoObserve } from "./liveModel";

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRoute: () => ({ query: { live: "1" } }),
}));

vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn() },
}));

const START = Date.UTC(2026, 10, 2, 10, 0);

const cell = (state: string) => ({ state, evidence: [], counts: {} });

const coverage = (): AutoObserveCoverage =>
  ({
    view: "strict",
    pass_at: START * 1000,
    refreshed_at: null,
    quality: null,
    classes: [],
    rows: [
      {
        service_id: "api",
        service_name: "api",
        cluster: "prod",
        namespace: "shop",
        streams: [],
        cells: { errors: cell("covered"), latency: cell("none"), absence: cell("none") },
      },
    ],
  }) as unknown as AutoObserveCoverage;

const Harness = defineComponent({
  setup() {
    const { source } = useLiveAutoObserve();
    return () => h("span", { "data-test": "age" }, String(source.value.rows[0]?.lastScanned ?? ""));
  },
});

describe("useLiveAutoObserve", () => {
  afterEach(() => vi.useRealTimers());

  it("ages Last checked while the page stays open on the same data", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(START);
    vi.mocked(autoobserve.coverage).mockResolvedValue({ data: coverage() } as never);
    vi.mocked(autoobserve.suggestions).mockResolvedValue({
      data: { suggestions: [], total: 0, limit: 5, offset: 0 },
    } as never);
    const wrapper = mount(Harness, { global: { plugins: [i18n, store] } });
    await flushPromises();
    expect(wrapper.text()).toBe("just now");
    vi.advanceTimersByTime(2 * 60 * 60_000);
    await nextTick();
    expect(wrapper.text()).toBe("2 hours ago");
    expect(autoobserve.coverage).toHaveBeenCalledTimes(1);
  });
});
