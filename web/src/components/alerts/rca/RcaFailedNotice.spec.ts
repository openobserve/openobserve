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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import RcaFailedNotice from "./RcaFailedNotice.vue";
import type { RcaFailedAnalyses } from "./rcaLight";

// Jul 18, 15:13:30 UTC is 20:43 in India.
const FAILED: RcaFailedAnalyses = {
  attempts: 8,
  lastAt: 1784387610142548,
  reasons: [
    { reason: "noResponse", count: 8 },
    { reason: "reanalysisNoStart", count: 3 },
    { reason: "noStart", count: 1 },
  ],
};

const mountNotice = (props: Record<string, unknown> = {}) =>
  mount(RcaFailedNotice, {
    props: { failed: FAILED, timezone: "Asia/Kolkata", ...props },
    global: { plugins: [i18n] },
  });

describe("RcaFailedNotice", () => {
  it("names the attempts and the last try in the app's zone, amber, with Retry", async () => {
    const wrapper = mountNotice();

    expect(wrapper.attributes("data-variant")).toBe("error-soft");
    expect(wrapper.get('[data-test="rca-failed-title"]').text()).toMatch(
      /8 times.*Jul 18, 20:43 GMT\+5:30/,
    );
    expect(wrapper.text()).not.toMatch(/service call failed|spawn|trigger failed/i);
    await wrapper.get('[data-test="rca-failed-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("lists every reason in plain words with how often, on demand", async () => {
    const wrapper = mountNotice();
    expect(wrapper.find('[data-test="rca-failed-reasons"]').exists()).toBe(false);

    await wrapper.get('[data-test="rca-failed-reasons-toggle"]').trigger("click");
    const reasons = wrapper.findAll('[data-test="rca-failed-reason"]').map((row) => row.text());
    expect(reasons).toHaveLength(3);
    expect(reasons.map((reason) => reason.match(/8 times|3 times|once/)?.[0])).toEqual([
      "8 times",
      "3 times",
      "once",
    ]);
  });

  it("one failed attempt reads in the singular", () => {
    const wrapper = mountNotice({
      failed: { attempts: 1, lastAt: FAILED.lastAt, reasons: [{ reason: "other", count: 1 }] },
    });
    expect(wrapper.get('[data-test="rca-failed-title"]').text()).toMatch(/1 time\b.*20:43/);
    expect(wrapper.get('[data-test="rca-failed-title"]').text()).not.toContain("1 times");
  });

  it("the Report tab's short form points to Incident Analysis instead of retrying", async () => {
    const wrapper = mountNotice({ short: true });

    expect(wrapper.get('[data-test="rca-failed-title"]').text()).toContain("8 times");
    expect(wrapper.text()).toMatch(/Jul 18, 20:43 GMT\+5:30/);
    expect(wrapper.find('[data-test="rca-failed-retry"]').exists()).toBe(false);
    await wrapper.get('[data-test="rca-failed-open-analysis"]').trigger("click");
    expect(wrapper.emitted("open-analysis")).toHaveLength(1);
  });

  it("Retry stays visible but locked when no run can start", () => {
    const wrapper = mountNotice({ startLockedReason: "AI is off" });
    expect(wrapper.get('[data-test="rca-failed-retry"]').attributes("disabled")).toBeDefined();
  });
});
