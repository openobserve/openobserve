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

import OnCallCoverageCard from "@/components/oncall/OnCallCoverageCard.vue";
import i18n from "@/locales";
import type { OnCallSlot, OnCallTeam } from "@/ts/interfaces/oncall";

const stubs = {
  OIcon: { name: "OIcon", template: "<span />" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
};

function team(id: string, name: string): OnCallTeam {
  return { id, org_id: "default", name, timezone: "UTC", created_at: 0, updated_at: 0 };
}

function slot(email: string, rotation = "Primary"): OnCallSlot {
  return { rotation, user_email: email, next_user_email: null };
}

function render(teams: OnCallTeam[], slotsByTeam = {}, viewerEmail = "") {
  return mount(OnCallCoverageCard, {
    props: { teams, slotsByTeam, viewerEmail },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallCoverageCard", () => {
  it("names who a page would reach for each team", () => {
    const wrapper = render([team("t1", "Payments")], {
      t1: [slot("ana@o2.ai")],
    });
    expect(wrapper.find('[data-test="oncall-coverage-holder-t1"]').text()).toContain(
      "ana@o2.ai",
    );
    expect(wrapper.find('[data-test="oncall-coverage-gap-t1"]').exists()).toBe(false);
  });

  /// The failure this card exists for: the list looks calm precisely BECAUSE
  /// those alerts page nobody.
  it("flags a team whose rotation resolves to nobody", () => {
    const wrapper = render([team("t1", "Data")], { t1: [] });
    expect(wrapper.find('[data-test="oncall-coverage-gap-t1"]').text()).toBe("Coverage gap");
  });

  /// An unreadable schedule is not the same fact as a coverage gap. Recording
  /// it as empty would accuse a staffed team of having none.
  it("does not call a team uncovered when its schedule could not be read", () => {
    const wrapper = render([team("t1", "Payments")], {});
    expect(wrapper.find('[data-test="oncall-coverage-gap-t1"]').exists()).toBe(true);
  });

  it("says 'You' when the shift is the viewer's own", () => {
    const wrapper = render(
      [team("t1", "Payments")],
      { t1: [slot("ana@o2.ai")] },
      "ana@o2.ai",
    );
    const text = wrapper.find('[data-test="oncall-coverage-holder-t1"]').text();
    expect(text).toContain("You");
    expect(text).not.toContain("ana@o2.ai");
  });

  it("names the rotation that decided the answer", () => {
    const wrapper = render([team("t1", "Platform")], {
      t1: [slot("sam@o2.ai", "Weekends")],
    });
    expect(wrapper.find('[data-test="oncall-coverage-holder-t1"]').text()).toContain(
      "Weekends",
    );
  });

  it("falls back to a prompt when the org has no teams", () => {
    const wrapper = render([]);
    expect(wrapper.find('[data-test="oncall-coverage-empty"]').exists()).toBe(true);
  });
});

describe("OnCallCoverageCard truncation", () => {
  const many = [
    team("t1", "Alpha"),
    team("t2", "Bravo"),
    team("t3", "Charlie"),
    team("t4", "Delta"),
  ];

  /// The row is three cards of equal height; an org with twenty teams would
  /// otherwise push the whole page down.
  it("shows at most three teams and counts the rest", () => {
    const wrapper = render(many, {
      t1: [slot("a@o2.ai")],
      t2: [slot("b@o2.ai")],
      t3: [slot("c@o2.ai")],
      t4: [slot("d@o2.ai")],
    });

    expect(wrapper.findAll('[data-test^="oncall-coverage-row-"]')).toHaveLength(3);
    expect(wrapper.find('[data-test="oncall-coverage-more"]').text()).toBe("+1 more");
  });

  /// The bug this ordering fixes: a team paging nobody is the exception this
  /// card exists to surface, and it was the row that fell off the end.
  it("keeps a coverage gap visible even when it would be truncated away", () => {
    const wrapper = render(many, {
      t1: [slot("a@o2.ai")],
      t2: [slot("b@o2.ai")],
      t3: [slot("c@o2.ai")],
      t4: [],
    });

    expect(wrapper.find('[data-test="oncall-coverage-gap-t4"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test^="oncall-coverage-row-"]')).toHaveLength(3);
  });

  it("puts the viewer's own team ahead of teams they are not on", () => {
    const wrapper = render(
      many,
      {
        t1: [slot("a@o2.ai")],
        t2: [slot("b@o2.ai")],
        t3: [slot("c@o2.ai")],
        t4: [slot("me@o2.ai")],
      },
      "me@o2.ai",
    );

    expect(wrapper.find('[data-test="oncall-coverage-row-t4"]').exists()).toBe(true);
  });

  it("counts nothing hidden when every team fits", () => {
    const wrapper = render(many.slice(0, 2), { t1: [slot("a@o2.ai")], t2: [slot("b@o2.ai")] });
    expect(wrapper.find('[data-test="oncall-coverage-more"]').exists()).toBe(false);
  });
});
