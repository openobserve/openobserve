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

import OnCallVerdictCard from "@/components/oncall/OnCallVerdictCard.vue";
import i18n from "@/locales";
import type { OnCallResponseEvent } from "@/ts/interfaces/oncall";
import store from "@/test/unit/helpers/store";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTimeCell: { name: "OTimeCell", props: ["value"], template: "<span />" },
};

function event(over: Partial<OnCallResponseEvent> = {}): OnCallResponseEvent {
  return {
    kind: "ai_verdict",
    at: 1_786_000_048_000_000,
    actor: "o2-sre",
    body: "connection pool exhausted after the 14:02 deploy (high) — rca/2026/08/17/abc; recommended page: error rate is user-facing",
    ...over,
  } as OnCallResponseEvent;
}

function render(events: OnCallResponseEvent[]) {
  return mount(OnCallVerdictCard, {
    props: { events },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallVerdictCard", () => {
  /// §G.7: the default deployment has no agent, emits no event, and is
  /// indistinguishable from a broken one — so no verdict means NO panel, not
  /// an empty panel that reads as a defect.
  it("renders nothing at all when no verdict event exists", () => {
    const wrapper = render([event({ kind: "page", body: "paged ana@o2.ai" })]);
    expect(wrapper.find('[data-test="oncall-verdict-card"]').exists()).toBe(false);
  });

  /// The sentence is the contract — the structured verdict never reaches the
  /// wire, so the body is rendered verbatim, never recomposed.
  it("renders the server's verdict sentence verbatim", () => {
    const wrapper = render([event()]);
    expect(wrapper.find('[data-test="oncall-verdict-body"]').text()).toContain(
      "connection pool exhausted after the 14:02 deploy",
    );
    expect(wrapper.text()).toContain("o2-sre");
  });

  /// attach_verdict is idempotent — a second verdict overwrites the analysis,
  /// so the newest event is the one that stands.
  it("shows the latest verdict when a re-run overwrote the first", () => {
    const wrapper = render([
      event({ at: 1, body: "first guess" }),
      event({ at: 2, body: "second, better guess" }),
    ]);
    expect(wrapper.find('[data-test="oncall-verdict-body"]').text()).toContain(
      "second, better guess",
    );
  });

  /// C14: the promotion line carries both facts in the server's words —
  /// asked-for beside applied, including the clamped case — as its own
  /// appended line, never an edit to the verdict above it.
  it("appends the promotion as its own line with both severities", () => {
    const wrapper = render([
      event(),
      event({
        kind: "severity_promoted",
        at: 1_786_000_049_000_000,
        body: "severity promoted P3 ↑ P2 (the agent asked for P1, clamped to the promotion bound): checkout is down",
      }),
    ]);
    const promotion = wrapper.find('[data-test="oncall-verdict-promotion"]');
    expect(promotion.text()).toContain("P3");
    expect(promotion.text()).toContain("P2");
    expect(promotion.text()).toContain("asked for P1");
  });

  it("keeps the promotion line off when nothing was promoted", () => {
    const wrapper = render([event()]);
    expect(wrapper.find('[data-test="oncall-verdict-promotion"]').exists()).toBe(false);
  });
});
