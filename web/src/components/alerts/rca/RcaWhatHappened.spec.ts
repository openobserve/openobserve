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

const mountTimeline = (
  summary: RcaRunSummary,
  live = false,
  timezone = "UTC",
  firings: { alert_id: string; alert_name: string; alert_fired_at: number }[] = [],
) =>
  mount(RcaWhatHappened, {
    props: {
      timeline: summary.timeline,
      evidence: summary.evidence,
      hypotheses: summary.hypotheses,
      org: "default",
      live,
      timezone,
      firings,
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

  it("counts its rows as events in the heading", () => {
    expect(mountTimeline(rcaRunSummary()).text()).toContain("3 events");
  });

  it("rows are in time order with their evidence numbers", () => {
    const wrapper = mountTimeline(rcaRunSummary());

    expect(rows(wrapper).map((row) => row.attributes("data-status"))).toEqual([
      "confirmed",
      "confirmed",
      "likely",
    ]);
    expect(rows(wrapper)[0].text()).toContain("Deploy 4f2c1e (PR #812) rolls out to checkout-api");
    expect(rows(wrapper)[0].find('[data-test="rca-timeline-time"]').text()).toBe("08:53");
    expect(
      rows(wrapper).map((row) =>
        row.findAll('[data-test="rca-timeline-chip"]').map((chip) => chip.text()),
      ),
    ).toEqual([["1"], ["2"], []]);
  });

  it("B-shell2-6: an entry's text may break inside a long id, so a phone-width row never clips it", () => {
    const wrapper = mountTimeline(rcaRunSummary());

    const text = rows(wrapper)[0].get('[data-test="rca-timeline-text"]');
    expect(text.classes()).toEqual(expect.arrayContaining(["min-w-0", "wrap-anywhere"]));
  });

  it("one line per event under a day header naming the app's zone; times in that zone", () => {
    const wrapper = mountTimeline(rcaRunSummary(), false, "Asia/Kolkata");

    const days = wrapper.findAll('[data-test="rca-timeline-day"]');
    expect(days.map((day) => day.text())).toEqual(["Oct 9 · GMT+5:30"]);
    expect(rows(wrapper)[0].find('[data-test="rca-timeline-time"]').text()).toBe("14:23");
    const toggle = rows(wrapper)[0].get('[data-test="rca-fold-row-toggle"]');
    expect(toggle.element.closest("button")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("a row with no evidence says No evidence", () => {
    const wrapper = mountTimeline(rcaRunSummary());
    expect(rows(wrapper)[2].find('[data-test="rca-timeline-no-evidence"]').text()).toBe(
      "No evidence",
    );
    expect(rows(wrapper)[0].find('[data-test="rca-timeline-no-evidence"]').exists()).toBe(false);
  });

  it.each([
    ["Alert checkout_latency_high fired", ["checkout_latency_high_staging"], false],
    ["Alert checkout_latency_high… fired", ["checkout_latency_high_staging"], true],
    ["Alert checkout_latency_high... fired", ["checkout_latency_high_staging"], true],
    [
      "Alert checkout_latency_high… fired",
      ["checkout_latency_high_staging", "checkout_latency_high_prod"],
      false,
    ],
    [
      "Alert checkout_latency_high fired",
      ["checkout_latency_high", "checkout_latency_high_staging"],
      false,
    ],
    [
      "Alert checkout_latency_high… fired",
      ["checkout_latency_high", "checkout_latency_high_staging"],
      false,
    ],
    ...(
      [
        ["at 14:23", true],
        ["at 08:53 UTC", true],
        ["at 08:53", false],
        ["at 23:59 UTC", false],
      ] as const
    ).map(([at, confirmed]) => [
      `Alert \`checkout_latency_high_staging\` fired ${at}`,
      ["checkout_latency_high_staging"],
      confirmed,
    ]),
    [
      "Alert VPC_Flow_Rejected_To_A_Remote_Administration_Port fires (single trigger)",
      ["VPC_Flow_Rejected_To_A_Remote_Administration_Port"],
      true,
    ],
    [
      "Alert VPC_Flow_Rejected_To_A_Remote_Administration_Port fires (single trigger)",
      ["VPC_Flow_Rejected_To_A_Remote_Administration_Port__vpc_flow_log_ocsf"],
      true,
    ],
    [
      "Alert VPC_Flow_Rejected_To_A_Remote_Administration_Port fires (single trigger)",
      [
        "VPC_Flow_Rejected_To_A_Remote_Administration_Port__vpc_flow_log_ocsf",
        "VPC_Flow_Rejected_To_A_Remote_Administration_Port__cloudtrail",
      ],
      false,
    ],
    [
      "Alert VPC_Flow_Rejected_To_A_Remote_Administration_Port fires (single alert, first and last trigger)",
      ["VPC_Flow_Rejected_To_A_Remote_Administration_Port"],
      true,
    ],
    ["cpu_high fired (causes checkout failures)", ["cpu_high"], false],
    ["cpu_high fired (500 customers lost data)", ["cpu_high"], false],
    ["cpu_high fired (1 trigger)", ["cpu_high"], true],
    ["cpu_high fired (999 triggers)", ["cpu_high"], false],
    ["cpu_high fired (first and last trigger)", ["cpu_high", "cpu_high"], false],
    ["cpu_high fired (first trigger)", ["cpu_high", "cpu_high"], false],
    ["cpu_high fired (last trigger)", ["cpu_high", "cpu_high"], true],
    ...[
      "because of overload",
      "caused an outage",
      "due to overload",
      "result of overload",
      "resulted in an outage",
      "results in an outage",
      "resulting in an outage",
      "led to outage",
      "after deploy",
    ].map((remark) => [
      `Alert checkout_latency_high_staging fired (${remark})`,
      ["checkout_latency_high_staging"],
      false,
    ]),
    [
      "checkout_latency_high_staging was caused by a database outage",
      ["checkout_latency_high_staging"],
      false,
    ],
    [
      "Alert checkout_latency_high_staging fired",
      ["checkout_latency_high_staging"],
      false,
      "refuted",
    ],
    [
      "Alert checkout_latency_high_staging fired",
      ["checkout_latency_high_staging"],
      false,
      "unverified",
      sec(61),
    ],
  ] as [string, string[], boolean, ("unverified" | "refuted")?, number?][])(
    "confirms only an identifiable firing whose time and count match, with no causal claim: %s",
    (text, names, confirmed, status = "unverified", delay = 0) => {
      const wrapper = mountTimeline(
        rcaRunSummary({
          timeline: [{ at: RCA_T0 + delay, text, status, evidence_numbers: [] }],
        }),
        false,
        "Asia/Kolkata",
        names.map((name, index) => ({
          alert_id: name,
          alert_name: name,
          alert_fired_at: RCA_T0 - (index === 0 && names.length > 1 ? sec(300) : 0),
        })),
      );
      expect(rows(wrapper)[0].attributes("data-status")).toBe(confirmed ? "confirmed" : status);
      expect(rows(wrapper)[0].find('[data-test="rca-timeline-from-incident"]').exists()).toBe(
        confirmed,
      );
    },
  );

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
    await card.get('[data-test="rca-evidence-show-query"]').trigger("click");
    expect(card.text()).toContain("max(db_pool_in_use");
    expect(chip.attributes("aria-expanded")).toBe("true");
    expect(chip.attributes("aria-controls")).toBe(card.attributes("id"));
    expect(wrapper.findAll('[data-test="rca-evidence-card"]')).toHaveLength(1);

    await chip.trigger("click");
    expect(wrapper.find('[data-test="rca-evidence-card"]').exists()).toBe(false);
  });
});
