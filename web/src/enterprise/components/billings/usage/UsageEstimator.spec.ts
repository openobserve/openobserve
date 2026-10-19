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
const search = vi.fn(
  (_sql: string, options: { key: string }) =>
    new Promise((resolve) => {
      const previous = releaseHistory;
      releaseHistory = () => {
        previous?.();
        // 300 MB scanned per minute of searching; 10 streams of 50 MB.
        resolve(
          options.key === "scan" ? [{ total: 300, seconds: 60 }] : [{ total: 500, streams: 10 }],
        );
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
  });

  const mountEstimator = () =>
    mount(UsageEstimator, { props: { details }, global: { plugins: [i18n, store] } });

  it("keeps a small search and check as one of each, sized to match the bill", async () => {
    const wrapper = mountEstimator();
    await flushPromises();
    releaseHistory();
    await flushPromises();

    // Under one 60-minute search a month: one shorter search, not zero searches.
    const scannedMb = monthlyPace(1000, details);
    expect(field(wrapper, "searchCount").props("modelValue")).toBe(1);
    const duration = field(wrapper, "searchMinutes").props("modelValue") as number;
    // The duration keeps two decimals, so the total lands within a fraction of a percent.
    expect(Math.abs(duration * 300 - scannedMb) / scannedMb).toBeLessThan(0.001);

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

  it("leaves a value typed before the history lands as typed", async () => {
    const wrapper = mountEstimator();
    await flushPromises();

    field(wrapper, "ingestGb").vm.$emit("update:modelValue", 500);
    releaseHistory();
    await flushPromises();

    expect(field(wrapper, "ingestGb").props("modelValue")).toBe(500);
  });
});
