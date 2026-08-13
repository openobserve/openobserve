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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallEscalationDryRun from "@/components/oncall/OnCallEscalationDryRun.vue";
import i18n from "@/locales";
import type { EscalationPreview, PreviewRecipient, PreviewRung } from "@/ts/interfaces/oncall";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
};

const person = (over: Partial<PreviewRecipient> = {}): PreviewRecipient => ({
  user_email: "ana@o2.ai",
  reason: "you are on call",
  would_a_page_land: true,
  deliverable_channels: ["email"],
  ...over,
});

const rung = (over: Partial<PreviewRung> = {}): PreviewRung => ({
  after_micros: 0,
  targets: ["the on-call"],
  recipients: [person()],
  resolves_to_nobody: false,
  ...over,
});

function preview(over: Partial<EscalationPreview> = {}): EscalationPreview {
  return {
    team_id: "t",
    team_name: "Payments",
    priority: "P1",
    at: 0,
    pages_anyone: true,
    channels: ["email"],
    rungs: [rung()],
    ends_with: "escalation ends — no further recipients are configured",
    cross_team_moves: ["manual: a responder can hand the page to another team"],
    reaches_nobody: false,
    ...over,
  };
}

const render = (p: EscalationPreview | null) =>
  mount(OnCallEscalationDryRun, { props: { preview: p }, global: { plugins: [i18n], stubs } });

const verdict = (w: any, after = 0) =>
  w.find(`[data-test="oncall-dry-run-verdict-${after}"]`).text();

describe("OnCallEscalationDryRun", () => {
  it("says a fully deliverable rung would land", () => {
    expect(verdict(render(preview()))).toBe("Would land");
  });

  /// The state that matters most: calling this "landed" hides exactly the
  /// person who will never be woken.
  it("distinguishes a partly deliverable rung from a landing one", () => {
    const wrapper = render(
      preview({
        rungs: [
          rung({
            recipients: [
              person({ user_email: "ok@o2.ai" }),
              person({
                user_email: "bad@o2.ai",
                would_a_page_land: false,
                deliverable_channels: [],
                why_not: "no verified contact method",
              }),
            ],
          }),
        ],
      }),
    );

    expect(verdict(wrapper)).toBe("Partial");
    expect(wrapper.text()).toContain("bad@o2.ai would be skipped");
  });

  it("says a rung reaching nobody deliverable would not land", () => {
    const wrapper = render(
      preview({
        rungs: [rung({ recipients: [person({ would_a_page_land: false, deliverable_channels: [] })] })],
      }),
    );
    expect(verdict(wrapper)).toBe("Would not land");
  });

  /// A rung that fires and resolves to nobody is worse than a slow one: the
  /// ladder moves on and the page stays unanswered.
  it("calls out a rung that resolves to nobody at all", () => {
    const wrapper = render(
      preview({ rungs: [rung({ recipients: [], resolves_to_nobody: true })] }),
    );
    expect(verdict(wrapper)).toBe("Reaches nobody");
  });

  it("reports a priority that pages nobody rather than an empty ladder", () => {
    const wrapper = render(preview({ pages_anyone: false, rungs: [] }));
    expect(wrapper.find('[data-test="oncall-dry-run-silent"]').exists()).toBe(true);
  });

  /// Both sentences are the server's — "escalate to a sibling team" is not a
  /// thing, and wording it that way would tell somebody they still hold a page
  /// they gave away.
  it("renders the ending and the cross-team moves verbatim", () => {
    const wrapper = render(preview());

    expect(wrapper.find('[data-test="oncall-dry-run-ends"]').text()).toContain(
      "no further recipients are configured",
    );
    expect(wrapper.find('[data-test="oncall-dry-run-move-0"]').text()).toContain(
      "hand the page to another team",
    );
  });

  it("degrades to a message when the ladder could not be resolved", () => {
    expect(render(null).find('[data-test="oncall-dry-run-empty"]').exists()).toBe(true);
  });
});
