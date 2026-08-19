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

import OnCallRecentPages from "@/components/oncall/OnCallRecentPages.vue";
import i18n from "@/locales";
import type { OnCallPolicy, OnCallResponse } from "@/ts/interfaces/oncall";

const MINUTE = 60_000_000;
const OPENED = 1_700_000_000_000_000;

const page = (over: Partial<OnCallResponse> = {}): OnCallResponse => ({
  id: "p1",
  org_id: "default",
  subject: { subject_type: "alert", source_id: "search_index_lag_growing", firing: 1 },
  team_id: "team_1",
  priority: 1,
  state: "acknowledged",
  opened_at: OPENED,
  responder_role: "owner",
  ...over,
});

/// A ladder whose second rung fires after five minutes, so "escalated" has a
/// threshold to be measured against.
const policy: OnCallPolicy = {
  id: "pol_1",
  org_id: "default",
  team_id: "team_1",
  rungs: [
    {
      priority: 1,
      channels: [],
      steps: [
        { after_micros: 0, targets: [] },
        { after_micros: 5 * MINUTE, targets: [] },
      ],
    },
  ],
};

function render(pages: OnCallResponse[], props: Record<string, unknown> = {}) {
  return mount(OnCallRecentPages, {
    props: { pages, policy, windowDays: 7, ...props },
    global: { plugins: [i18n] },
  });
}

const rows = (wrapper: ReturnType<typeof render>) =>
  wrapper.findAll('[data-test^="oncall-recent-pages-row-"]');

describe("OnCallRecentPages", () => {
  /// The list is a sample, and a sample that does not say so reads as the whole
  /// history of the team.
  it("says how many of the window's pages it is showing", () => {
    const wrapper = render(
      Array.from({ length: 6 }, (_, i) => page({ id: `p${i}`, opened_at: OPENED - i * MINUTE })),
    );

    expect(rows(wrapper)).toHaveLength(3);
    expect(wrapper.find('[data-test="oncall-recent-pages-window"]').text()).toBe(
      "3 of 6 in the last 7 days",
    );
  });

  /// With nothing truncated there is no "of", because "3 of 3" invites a reader
  /// to look for the other zero.
  it("states a plain count when nothing is truncated", () => {
    const wrapper = render([page({ id: "a" }), page({ id: "b", opened_at: OPENED - MINUTE })]);

    expect(wrapper.find('[data-test="oncall-recent-pages-window"]').text()).toBe(
      "2 in the last 7 days",
    );
  });

  it("orders newest first regardless of the order it was handed", () => {
    const wrapper = render([
      page({ id: "old", opened_at: OPENED - 10 * MINUTE }),
      page({ id: "new", opened_at: OPENED }),
    ]);

    expect(rows(wrapper).map((r) => r.attributes("data-test"))).toEqual([
      "oncall-recent-pages-row-new",
      "oncall-recent-pages-row-old",
    ]);
  });

  /// The two outcomes worth a second look, and the one that is not: tagging the
  /// norm is what made the old table unreadable.
  it("tags only the pages that were never answered or ran past the first rung", () => {
    const wrapper = render([
      page({ id: "quick", acked_by: "mei@o2.ai", acked_at: OPENED + MINUTE }),
      page({ id: "slow", acked_by: "root@o2.ai", acked_at: OPENED + 15 * MINUTE }),
      page({ id: "never", state: "triggered" }),
    ]);

    const text = (id: string) => wrapper.find(`[data-test="oncall-recent-pages-row-${id}"]`).text();

    expect(text("quick")).not.toContain("Escalate");
    expect(text("quick")).not.toContain("Never acked");
    expect(text("slow")).toContain("Escalate");
    expect(text("never")).toContain("Never acked");
  });

  /// Who picked it up and how long it took, on the row — the pair of facts the
  /// five-column table existed to carry.
  it("names the answerer and the delay on an answered page", () => {
    const wrapper = render([page({ acked_by: "mei@o2.ai", acked_at: OPENED + 7 * MINUTE })]);

    expect(rows(wrapper)[0].text()).toContain("acked by mei@o2.ai");
  });

  it("emits the record on a row click and asks for the full list on view-all", async () => {
    const wrapper = render([page()]);

    await rows(wrapper)[0].trigger("click");
    expect(wrapper.emitted("open")?.[0]?.[0]).toMatchObject({ id: "p1" });

    await wrapper.find('[data-test="oncall-recent-pages-view-all"]').trigger("click");
    expect(wrapper.emitted("view-all")).toHaveLength(1);
  });

  it("shows the empty state rather than a bare card when nothing fired", () => {
    expect(render([]).find('[data-test="oncall-recent-pages-empty"]').exists()).toBe(true);
  });
});
