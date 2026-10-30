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
import RcaHypotheses from "./RcaHypotheses.vue";
import type { RcaHypothesisStatus, RcaRunSummary } from "@/services/incidents";
import {
  rcaHypothesis,
  rcaRunSummary,
  rcaRunSummaryCancelled,
  rcaRunSummaryInconclusive,
  rcaRunSummaryLive,
} from "@/test/unit/fixtures/rcaThread";

const mountList = (summary: RcaRunSummary, live = false) =>
  mount(RcaHypotheses, {
    props: {
      hypotheses: summary.hypotheses,
      outcome: summary.card.outcome,
      evidence: summary.evidence,
      org: "default",
      live,
    },
    global: { plugins: [i18n] },
  });

/** [group title, [status pill, statement] …] for each group. */
const groups = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test="rca-hypothesis-group"]').map((group) => [
    group
      .find("h4")
      .text()
      .replace(/\s*\d+$/, ""),
    group
      .findAll('[data-test="rca-hypothesis"]')
      .map((row) => row.find('[data-test="rca-hypothesis-status"]').text()),
  ]);

describe("RcaHypotheses (03 VE11, VE12, VE18, VE36; F8)", () => {
  it("frame B: Explains (root cause, contributing, symptom), then Not confirmed, then Ruled out", () => {
    const base = rcaRunSummary();
    const wrapper = mountList(
      rcaRunSummary({
        hypotheses: [
          ...base.hypotheses,
          rcaHypothesis({
            id: "h6",
            statement: "Retries amplify the load",
            status: "symptom",
            first_seen_seq: 2,
          }),
          rcaHypothesis({
            id: "h7",
            statement: "DNS",
            status: "ruled_out",
            first_seen_seq: 1,
            history: [],
          }),
        ],
      }),
    );

    expect(groups(wrapper)).toEqual([
      ["Explains the incident", ["Root cause", "Contributing", "Symptom"]],
      ["Not confirmed", ["Blocked"]],
      ["Ruled out", ["Ruled out", "Ruled out"]],
    ]);
    // Inside Ruled out: first seen first.
    expect(
      wrapper
        .find('[data-group="out"]')
        .findAll('[data-test="rca-hypothesis-statement"]')
        .map((s) => s.text()),
    ).toEqual(["DNS", "Node CPU saturation"]);
  });

  it("agent inline code in a statement or reason shows as code, never as backticks", () => {
    const wrapper = mountList(
      rcaRunSummary({
        hypotheses: [
          rcaHypothesis({
            statement: "The `adFailure` flag was toggled on",
            reason: "`GET /api/data` errors began at the toggle",
          }),
        ],
      }),
    );

    const statement = wrapper.find('[data-test="rca-hypothesis-statement"]');
    expect(statement.text()).toBe("The adFailure flag was toggled on");
    expect(statement.find("code").text()).toBe("adFailure");
    expect(wrapper.text()).not.toContain("`");
    expect(wrapper.findAll("code").map((code) => code.text())).toContain("GET /api/data");
  });

  it("frame C: Not confirmed first, and a root_cause hypothesis reads 'Root cause · not confirmed' (VE18)", () => {
    const wrapper = mountList(rcaRunSummaryInconclusive());

    expect(groups(wrapper)).toEqual([
      ["Not confirmed", ["Inconclusive", "Inconclusive"]],
      ["Explains the incident", ["Root cause · not confirmed"]],
    ]);
    // A long status label wraps inside the status column instead of spilling over.
    const pill = wrapper.findComponent({ name: "RcaPill" });
    expect(pill.props("wrap")).toBe(true);
    expect(
      wrapper
        .findAll('[data-test="rca-hypothesis-status"]')
        .every((status) => !status.classes().includes("whitespace-nowrap")),
    ).toBe(true);
  });

  it("live: the open group reads 'Being tested'", () => {
    const wrapper = mountList(rcaRunSummaryLive(), true);

    expect(groups(wrapper)).toEqual([
      ["Being tested", ["Testing"]],
      ["Explains the incident", ["Symptom"]],
    ]);
  });

  it("cancelled: untested hypotheses under Not confirmed", () => {
    expect(groups(mountList(rcaRunSummaryCancelled()))).toEqual([
      ["Not confirmed", ["Untested", "Untested"]],
    ]);
  });

  it("each row has its reason, evidence numbers, and 'e7 · not verified' for an unverified id", () => {
    const wrapper = mountList(rcaRunSummary());
    const rows = wrapper.findAll('[data-test="rca-hypothesis"]');

    expect(rows[0].text()).toContain("Pool hits 100/100 within 2 min of rollout.");
    expect(rows[0].findAll('[data-test="rca-hypothesis-chip"]').map((c) => c.text())).toEqual([
      "1",
    ]);
    expect(rows[2].text()).toContain("No evidence yet");
    expect(rows[3].find('[data-test="rca-hypothesis-unverified"]').text()).toBe(
      "e7 · not verified",
    );
    expect(rows[3].findAll('[data-test="rca-hypothesis-chip"]')).toHaveLength(0);
  });

  it("'Status history · N' expands the history with the actor of each change (VE11)", async () => {
    const wrapper = mountList(rcaRunSummary());
    const ruledOut = wrapper.find('[data-status="ruled_out"]');
    const toggle = ruledOut.find('[data-test="rca-hypothesis-history-toggle"]');

    expect(toggle.text()).toBe("Status history · 2");
    expect(ruledOut.find('[data-test="rca-hypothesis-history"]').exists()).toBe(false);
    await toggle.trigger("click");

    const history = ruledOut.find('[data-test="rca-hypothesis-history"]');
    expect(toggle.attributes("aria-controls")).toBe(history.attributes("id"));
    expect(history.findAll("li").map((li) => li.text())).toEqual([
      "08:54:20 UTC · Testing (agent)",
      "08:56:20 UTC · Ruled out (agent · after a.rao@acme.io)",
    ]);
    // A hypothesis with no history has no expander.
    expect(
      wrapper.find('[data-status="blocked"] [data-test="rca-hypothesis-history-toggle"]').exists(),
    ).toBe(false);
  });

  it("a number chip opens the evidence card inline", async () => {
    const wrapper = mountList(rcaRunSummary());
    const chip = wrapper.find('[data-status="contributing"] [data-test="rca-hypothesis-chip"]');
    await chip.trigger("click");

    const card = wrapper.find('[data-status="contributing"] [data-test="rca-evidence-card"]');
    expect(card.text()).toContain("max(db_pool_in_use");
    expect(chip.attributes("aria-expanded")).toBe("true");
  });

  it("no hypothesis actions without can_steer", () => {
    const text = mountList(rcaRunSummary(), true).text();

    for (const action of ["Disprove", "Reopen", "Test first"]) expect(text).not.toContain(action);
  });

  describe("04 H16, SG31: hypothesis actions on a steerable run", () => {
    const mountOne = (
      status: RcaHypothesisStatus,
      extra: { pending?: Map<string, string>; sending?: boolean } = {},
    ) =>
      mount(RcaHypotheses, {
        props: {
          hypotheses: [rcaHypothesis({ status })],
          outcome: undefined,
          evidence: rcaRunSummary().evidence,
          org: "default",
          live: true,
          canSteer: true,
          ...extra,
        },
        global: { plugins: [i18n] },
      });
    const actionLabels = (wrapper: VueWrapper) =>
      wrapper.findAll('[data-test^="rca-hypothesis-action-"]').map((button) => button.text());

    it.each<[RcaHypothesisStatus, string[]]>([
      ["untested", ["Disprove", "Test first"]],
      ["testing", ["Disprove", "Test first"]],
      ["likely", ["Disprove", "Test first"]],
      ["root_cause", ["Disprove"]],
      ["contributing", ["Disprove"]],
      ["ruled_out", ["Reopen"]],
    ])("%s offers %o", (status, labels) => {
      expect(actionLabels(mountOne(status))).toEqual(labels);
    });

    it("each action has an aria-label naming the hypothesis", () => {
      const button = mountOne("testing").find('[data-test="rca-hypothesis-action-test_first"]');
      expect(button.attributes("aria-label")).toBe(
        "Ask the agent to test first: Deploy 4f2c1e opens one orders-db connection per line item",
      );
    });

    it.each([
      ["disprove", "testing"],
      ["test_first", "untested"],
      ["reopen", "ruled_out"],
    ] as const)("%s emits the steer-action request", async (action, status) => {
      const wrapper = mountOne(status);

      await wrapper.find(`[data-test="rca-hypothesis-action-${action}"]`).trigger("click");

      expect(wrapper.emitted("steer-action")).toEqual([[{ hypothesisId: "h1", action }]]);
    });

    it("an unread action shows 'Pending · <author>' and disables the actions", () => {
      const wrapper = mountOne("testing", { pending: new Map([["h1", "a.rao"]]) });

      expect(wrapper.find('[data-test="rca-hypothesis-pending"]').text()).toBe("Pending · a.rao");
      for (const button of wrapper.findAll('[data-test^="rca-hypothesis-action-"]')) {
        expect(button.attributes("disabled")).toBeDefined();
      }
    });

    it("no pending line once the action is read", () => {
      expect(mountOne("testing").find('[data-test="rca-hypothesis-pending"]').exists()).toBe(false);
    });
  });

  it("no hypotheses: the empty line", () => {
    expect(
      mountList(rcaRunSummary({ hypotheses: [] }))
        .find('[data-test="rca-hypotheses-empty"]')
        .text(),
    ).toBe("No hypotheses recorded yet.");
  });
});
