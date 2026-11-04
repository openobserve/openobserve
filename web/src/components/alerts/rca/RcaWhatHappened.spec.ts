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
import { mount, type VueWrapper } from "@vue/test-utils";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import i18n from "@/locales";
import RcaWhatHappened from "./RcaWhatHappened.vue";
import type { RcaRunSummary } from "@/services/incidents";
import { RCA_T0, rcaRunSummary, rcaRunSummaryLive, sec } from "@/test/unit/fixtures/rcaThread";

const mountTimeline = (summary: RcaRunSummary, live = false) =>
  mount(RcaWhatHappened, {
    props: {
      timeline: summary.timeline,
      evidence: summary.evidence,
      hypotheses: summary.hypotheses,
      org: "default",
      live,
    },
    global: { plugins: [i18n] },
  });

const rows = (wrapper: VueWrapper) => wrapper.findAll('[data-test="rca-timeline-entry"]');

describe("RcaWhatHappened (03 VE31, VE36, VE-D4)", () => {
  it("live: 'The causal timeline comes with the report.' and no rows", () => {
    const wrapper = mountTimeline(rcaRunSummaryLive(), true);

    expect(wrapper.find('[data-test="rca-timeline-pending"]').text()).toBe(
      "The causal timeline comes with the report.",
    );
    expect(rows(wrapper)).toHaveLength(0);
    expect(wrapper.find('[data-test="rca-timeline-legend"]').exists()).toBe(false);
  });

  it("a finished run with no timeline says so", () => {
    const wrapper = mountTimeline(rcaRunSummary({ timeline: [] }));

    expect(wrapper.find('[data-test="rca-timeline-empty"]').text()).toBe(
      "The report has no timeline.",
    );
  });

  it("rows are in time order with their evidence numbers", () => {
    const wrapper = mountTimeline(rcaRunSummary());

    expect(rows(wrapper).map((row) => row.attributes("data-status"))).toEqual([
      "confirmed",
      "confirmed",
      "likely",
    ]);
    expect(rows(wrapper)[0].text()).toContain("Deploy 4f2c1e (PR #812) rolls out to checkout-api");
    expect(rows(wrapper)[0].text()).toContain("Oct 9, 08:53:20");
    expect(
      rows(wrapper).map((row) =>
        row.findAll('[data-test="rca-timeline-chip"]').map((chip) => chip.text()),
      ),
    ).toEqual([["1"], ["2"], []]);
  });

  it("agent marks in an entry show as code and bold, never as raw markers", () => {
    const [first] = rcaRunSummary().timeline;
    const wrapper = mountTimeline(
      rcaRunSummary({ timeline: [{ ...first, text: "The `adFailure` flag turns **on**" }] }),
    );

    const row = rows(wrapper)[0];
    expect(row.text()).toContain("The adFailure flag turns on");
    expect(row.find("code").text()).toBe("adFailure");
    expect(row.find("strong").text()).toBe("on");
  });

  it("VE31 markers: Confirmed has no tag; likely reads Likely; Unverified and Refuted tag their rows", () => {
    const wrapper = mountTimeline(
      rcaRunSummary({
        timeline: [
          { at: RCA_T0, text: "Deploy", status: "confirmed", evidence_numbers: [1] },
          { at: RCA_T0 + sec(1), text: "Pool full", status: "likely", evidence_numbers: [] },
          { at: RCA_T0 + sec(2), text: "Flag flip", status: "unverified", evidence_numbers: [] },
          { at: RCA_T0 + sec(3), text: "CPU spike", status: "refuted", evidence_numbers: [] },
        ],
      }),
    );

    expect(
      rows(wrapper).map((row) => {
        const marker = row.find('[data-test="rca-timeline-marker"]');
        return marker.exists() ? marker.text() : null;
      }),
    ).toEqual([null, "Likely", "Unverified", "Refuted"]);
    expect(rows(wrapper)[3].find(".line-through").text()).toBe("CPU spike");
    expect(wrapper.find('[data-test="rca-timeline-legend"]').text()).toMatch(
      /Confirmed\s*Likely\s*Unverified\s*Refuted/,
    );
  });

  it("the legend shows Unverified and Refuted only when a row uses them", () => {
    const legend = mountTimeline(rcaRunSummary()).find('[data-test="rca-timeline-legend"]').text();

    expect(legend).toContain("Confirmed");
    expect(legend).toContain("Likely");
    expect(legend).not.toContain("Unverified");
    expect(legend).not.toContain("Refuted");
  });

  it("a number chip opens its evidence card under the row and closes it again (F9)", async () => {
    const wrapper = mountTimeline(rcaRunSummary());
    const chip = rows(wrapper)[1].find('[data-test="rca-timeline-chip"]');

    expect(chip.attributes("aria-label")).toBe("Open evidence 2");
    await chip.trigger("click");
    const card = rows(wrapper)[1].find('[data-test="rca-evidence-card"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("max(db_pool_in_use");
    expect(chip.attributes("aria-expanded")).toBe("true");
    expect(chip.attributes("aria-controls")).toBe(card.attributes("id"));
    expect(wrapper.findAll('[data-test="rca-evidence-card"]')).toHaveLength(1);

    await chip.trigger("click");
    expect(wrapper.find('[data-test="rca-evidence-card"]').exists()).toBe(false);
  });
});
