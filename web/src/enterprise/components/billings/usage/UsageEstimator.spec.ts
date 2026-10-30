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

import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/locales";
import { formatSizeFromMB } from "@/utils/formatters";
import store from "@/test/unit/helpers/store";
import { mockMeteringResponse } from "./meteringMock";
import {
  browserStepRuns,
  monthlyPace,
  type EstimateInputs,
  type MeteringDetails,
} from "./meteringModel";

// The two history reads, released by each test when it wants them to land.
let releaseHistory!: () => void;
// Search history: one search that scanned 300 GB, far more than this cycle's billed scan.
const BIG_SEARCH = { total: 307_200, seconds: 60, searches: 1 };
let scanHistory: Record<string, number> = BIG_SEARCH;
const search = vi.fn(
  (_sql: string, options: { key: string }) =>
    new Promise((resolve) => {
      const previous = releaseHistory;
      releaseHistory = () => {
        previous?.();
        // 10 streams of 50 MB.
        resolve(options.key === "scan" ? [scanHistory] : [{ total: 500, streams: 10 }]);
      };
    }),
);
vi.mock("./useUsageSearch", () => ({ useUsageSearch: () => ({ search }) }));

const { default: UsageEstimator } = await import("./UsageEstimator.vue");

enableAutoUnmount(afterEach);

const field = (wrapper: VueWrapper, key: string) =>
  wrapper
    .findAllComponents({ name: "OInput" })
    .find((input) => input.vm.$attrs["data-test"] === `billings-usageestimator-${key}`)!;

describe("UsageEstimator My Current Usage", () => {
  const base = mockMeteringResponse().upcoming!;
  // A little searching and one slow browser check this cycle.
  const details: MeteringDetails = {
    ...base,
    query: { ...base.query, metered_amount: 1000 },
    synthetics_browser: { ...base.synthetics_browser, metered_amount: 5000 },
  };

  beforeEach(() => {
    search.mockClear();
    releaseHistory = () => {};
    scanHistory = BIG_SEARCH;
  });

  const mountEstimator = () =>
    mount(UsageEstimator, { props: { details }, global: { plugins: [i18n, store] } });

  it("keeps a small search and check as one of each, sized to match the bill", async () => {
    const wrapper = mountEstimator();
    await flushPromises();
    releaseHistory();
    await flushPromises();

    // Under one typical search a month: one smaller search, not zero searches.
    const scannedMb = monthlyPace(1000, details);
    expect(field(wrapper, "searchCount").props("modelValue")).toBe(1);
    // The search line scans what the bill does, so the estimate matches it.
    expect(wrapper.find('[data-test="billings-usageestimator-line-query"]').text()).toContain(
      `${formatSizeFromMB(scannedMb)} scanned`,
    );

    // A third of a default check: one check that runs a third as often.
    const perCheck = browserStepRuns({
      browserChecks: 1,
      browserSteps: 5,
      browserRegions: 1,
      browserDevices: 1,
      browserIntervalSec: 300,
    } as EstimateInputs);
    const exact = monthlyPace(5000, details) / perCheck;
    expect(field(wrapper, "browserChecks").props("modelValue")).toBe(1);
    expect(field(wrapper, "browserIntervalSec").props("modelValue")).toBe(Math.round(300 / exact));
  });

  it("prices a search by the data it scans, not by how long it runs", async () => {
    // The issue's history: 10 searches scanned 2,970 MB in all, each done in 0.3 seconds.
    scanHistory = { total: 2970, seconds: 3, searches: 10 };
    const wrapper = mountEstimator();
    await flushPromises();
    releaseHistory();
    await flushPromises();

    field(wrapper, "searchCount").vm.$emit("update:modelValue", 10);
    await flushPromises();
    // 10 searches of about 297 MB each (≈ 2.9 GB, ≈ $0.03), not 10 hour-long scans at 59 GB a
    // minute. The size per search is squared with this cycle's billed scan, so it is near, not exact.
    const line = wrapper.find('[data-test="billings-usageestimator-line-query"]').text();
    const scannedGb = Number(/([\d.]+) GB scanned/.exec(line)?.[1]);
    expect(Math.abs(scannedGb - 2.9) / 2.9).toBeLessThan(0.05);
    expect(line).toContain("$0.03");
  });

  it("says it is reading history instead of showing defaults as current usage", async () => {
    const wrapper = mountEstimator();
    await flushPromises();
    const loading = () => wrapper.findComponent({ name: "OInnerLoading" }).props("showing");
    expect(loading()).toBe(true);

    releaseHistory();
    await flushPromises();
    expect(loading()).toBe(false);
  });

  it("keeps a preset picked while history loads", async () => {
    const wrapper = mountEstimator();
    await flushPromises();
    wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "twice");
    releaseHistory();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OToggleGroup" }).props("modelValue")).toBe("twice");
    const current = Number(field(wrapper, "searchCount").props("modelValue"));
    expect(current).toBe(2);
  });

  it("reads a super org's history across the whole group, the same orgs its bill covers", async () => {
    mount(UsageEstimator, {
      props: {
        details,
        billingOrgs: [
          { id: "payer", name: "Payer", isSelf: true },
          { id: "child", name: "Child", isSelf: false },
        ],
      },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    expect(search).toHaveBeenCalledTimes(2);
    for (const [sql] of search.mock.calls) expect(sql).not.toContain("org_id =");
  });

  it("starts the two synthetics blocks on one row, so neither leaves a hole beside a short field", async () => {
    const wrapper = mountEstimator();
    await flushPromises();
    const order = wrapper
      .findAll('[data-test^="billings-usageestimator-field-"]')
      .map((block) => block.attributes("data-test")!.replace("billings-usageestimator-field-", ""));
    // Two columns: the tall browser block must open a row and the API block sit beside it.
    const browser = order.indexOf("browserChecks");
    expect(browser % 2).toBe(0);
    expect(order[browser + 1]).toBe("apiChecks");
    expect(order).toHaveLength(browser + 2);
  });

  it("puts each count slider's thumb where its box says, including the defaults", async () => {
    const wrapper = mountEstimator();
    await flushPromises();
    releaseHistory();
    await flushPromises();
    // A browser draws a range input's thumb at the nearest min + n x step, so a value off that
    // grid shows somewhere else: the old duration slider showed 61 for a box reading 60.
    const onGrid = (key: string) => {
      const slider = wrapper
        .findAllComponents({ name: "OSlider" })
        .find((item) => item.vm.$attrs["data-test"] === `billings-usageestimator-${key}-slider`)!;
      const steps =
        (Number(slider.props("modelValue")) - Number(slider.props("min"))) /
        Number(slider.props("step"));
      return Math.abs(steps - Math.round(steps)) < 1e-9;
    };
    expect(
      wrapper.findAllComponents({ name: "OSlider" }).every((slider) => {
        const key = String(slider.vm.$attrs["data-test"]).replace(
          /^billings-usageestimator-|-slider$/g,
          "",
        );
        // Sizes keep decimals, where the step is only how far a drag moves; counts must sit exactly.
        return key === "ingestGb" || key === "scanPerSearchMb" || onGrid(key);
      }),
    ).toBe(true);

    for (const [key, value] of [
      ["searchCount", 7],
      ["aiCredits", 13],
      ["pipelineCount", 3],
    ] as const) {
      field(wrapper, key).vm.$emit("update:modelValue", value);
      await flushPromises();
      expect(onGrid(key)).toBe(true);
    }
  });

  it("leaves a value typed before the history lands as typed", async () => {
    const wrapper = mountEstimator();
    await flushPromises();

    field(wrapper, "ingestGb").vm.$emit("update:modelValue", 500);
    releaseHistory();
    await flushPromises();

    expect(field(wrapper, "ingestGb").props("modelValue")).toBe(500);
  });
});
