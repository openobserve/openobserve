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

import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallEscalationCell from "@/components/oncall/OnCallEscalationCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { EscalationProgress, OnCallResponse } from "@/ts/interfaces/oncall";

const stubs = {
  OIcon: { name: "OIcon", template: "<span />" },
  OProgressBar: { name: "OProgressBar", props: ["value", "variant"], template: "<div />" },
};

const NOW = () => Date.now() * 1000;
const MINUTE = 60_000_000;

/// The detail sentence lives in the tooltip's `content` prop, not a second visible line.
function tooltipText(wrapper: VueWrapper) {
  return String(wrapper.findComponent(OTooltip).props("content"));
}

function firedRungs(count: number, reached: string[] = []) {
  return Array.from({ length: count }, (_, i) => ({
    after_micros: i * 300_000_000,
    at: NOW(),
    targets: ["the on-call"],
    reached,
  }));
}

function render(
  record: Partial<OnCallResponse>,
  progress: Partial<EscalationProgress> | null,
  extra: Record<string, unknown> = {},
) {
  return mount(OnCallEscalationCell, {
    props: {
      responseId: "resp-1",
      record: { state: "triggered", opened_at: NOW() - 10 * MINUTE, ...record } as OnCallResponse,
      totalRungs: 3,
      progressLoaded: true,
      progress: progress && {
        fired: [],
        next_targets: [],
        next_at: null,
        exhausted: false,
        stopped_because: null,
        ...progress,
      },
      ...extra,
    },
    global: { plugins: [i18n, store], stubs },
  });
}

const text = (wrapper: VueWrapper) =>
  wrapper.find('[data-test="oncall-escalation-cell-level"]').text();

describe("OnCallEscalationCell", () => {
  /// One phrase per row, and never the bare state word the group header already says.
  it.each([
    [{}, { fired: firedRungs(2, ["bo@o2.ai"]) }, {}, "Paging step 2 of 3 · bo@o2.ai"],
    [{}, { fired: firedRungs(2, ["bo@o2.ai"]) }, { totalRungs: null }, "Paging step 2 · bo@o2.ai"],
    [{}, { fired: firedRungs(2) }, {}, "Paging step 2 of 3"],
    [{}, null, { reachedStep: 1 }, "Paging step 1 of 3"],
    [{}, { fired: [] }, {}, "Not paged yet"],
    [{}, { fired: [], exhausted: true }, { totalRungs: 0 }, "Pages nobody"],
    [
      {},
      { fired: [...firedRungs(1, ["ana@o2.ai"]), { ...firedRungs(1)[0], reached_nobody: true }] },
      {},
      "Step 2 of 3 reached nobody",
    ],
    [
      {},
      { fired: [{ ...firedRungs(1)[0], reached_nobody: true }] },
      { totalRungs: null },
      "Step 1 reached nobody",
    ],
    [
      { state: "acknowledged", acked_by: "ana@o2.ai" },
      { fired: firedRungs(1) },
      {},
      "Acknowledged by ana@o2.ai",
    ],
    [
      { state: "resolved", opened_at: 1_000_000, closed_at: 1_000_000 + 5 * MINUTE },
      { fired: firedRungs(1) },
      {},
      "Resolved after 5m",
    ],
  ] as const)("says %o / %o as one phrase", (record, progress, extra, expected) => {
    const wrapper = render(record as any, progress as any, extra as any);
    expect(text(wrapper)).toBe(expected);
    expect(text(wrapper)).not.toContain("Triggered");
  });

  it("says when a snooze ends", () => {
    const wrapper = render({ snoozed_until: NOW() + 30 * MINUTE }, { fired: firedRungs(1) });
    expect(text(wrapper)).toMatch(/^Snoozed until ([A-Z][a-z]{2} \d{1,2}, \d{4}, )?\d{2}:\d{2}$/);
  });

  it("says AI triage is first, as an upper bound", () => {
    const wrapper = render({}, { held_until_micros: NOW() + 54_500_000 });
    expect(text(wrapper)).toMatch(/^AI triage first · paging within 5[45]s$/);
  });

  /// The tag and the ladder come from the same progress, so a row cannot say both "finished" and "ringing".
  it("tags a finished ladder as nobody answered, from the progress alone", () => {
    const wrapper = render(
      { exhausted_at: null },
      {
        fired: [
          { after_micros: 0, at: 1, targets: ["ana@o2.ai"] },
          { after_micros: 60_000_000, at: 2, targets: ["ana@o2.ai", "liam@o2.ai"] },
        ],
        exhausted: true,
      },
      { totalRungs: 6 },
    );

    expect(wrapper.find('[data-test="oncall-escalation-cell-exhausted"]').text()).toBe(
      "Nobody answered",
    );
    expect(wrapper.text()).not.toContain("Ladder finished");
    expect(tooltipText(wrapper)).toContain("rung 2 people over 6 levels, no ack");
  });

  it("counts down to the next rung and names who it wakes", () => {
    const wrapper = render(
      {},
      {
        fired: firedRungs(1),
        next_targets: ["the next on-call"],
        next_at: NOW() + 4 * MINUTE,
      },
    );

    const tooltip = tooltipText(wrapper);
    expect(tooltip).toContain("the next on-call");
    expect(tooltip).toMatch(/[34]m/);
  });

  it("says how quickly an answered page was claimed", () => {
    const opened = NOW() - 10 * MINUTE;
    const wrapper = render(
      {
        state: "acknowledged",
        acked_by: "ana@o2.ai",
        opened_at: opened,
        acked_at: opened + 42_000_000,
      },
      { fired: firedRungs(1), stopped_because: "acknowledged" },
    );
    expect(tooltipText(wrapper)).toContain("acked in 42s");
  });

  it("says nothing while the ladder position is still loading", () => {
    const wrapper = render({}, null, { progressLoaded: false });
    expect(text(wrapper)).toBe("");
  });

  it("draws no bar and no icon at all", () => {
    const wrapper = render({}, { fired: firedRungs(2) }, { totalRungs: 4 });

    expect(wrapper.find('[data-test="oncall-escalation-cell-bar"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "OProgressBar" }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: "OIcon" }).exists()).toBe(false);
  });

  /// Tone is the cell's only signal, so every phrase carries one.
  it.each([
    [{}, { fired: firedRungs(1) }, "text-status-error-text"],
    [{ state: "acknowledged", acked_by: "a@o2.ai" }, { fired: firedRungs(1) }, "text-text-body"],
    [{ snoozed_until: NOW() + MINUTE }, { fired: firedRungs(1) }, "text-status-warning-text"],
    [{ state: "resolved", closed_at: NOW() }, { fired: firedRungs(1) }, "text-text-secondary"],
    [{}, { fired: [] }, "text-status-error-text"],
    [{}, { fired: [{ ...firedRungs(1)[0], reached_nobody: true }] }, "text-status-warning-text"],
  ] as const)("tones %o as %s", (record, progress, expected) => {
    const wrapper = render(record as any, progress as any);
    expect(wrapper.find('[data-test="oncall-escalation-cell-level"]').classes()).toContain(
      expected,
    );
  });
});
