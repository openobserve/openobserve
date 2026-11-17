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
import RcaProposedActions from "./RcaProposedActions.vue";

describe("RcaProposedActions", () => {
  const actions = [
    {
      title: "Roll back 4f2c1e",
      kind: "rollback" as const,
      detail: "Revert the pool size change.",
    },
    { title: "Watch pool usage", kind: "other" as const, detail: "" },
  ];

  it("lists each action as one title row; its kind shows unless it is Other", () => {
    const wrapper = mount(RcaProposedActions, {
      props: { actions },
      global: { plugins: [i18n] },
    });

    expect(wrapper.find("h3").text()).toBe("Proposed actions");
    const rows = wrapper.findAll('[data-test="rca-proposed-action"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("Roll back 4f2c1e");
    expect(rows[0].find('[data-test="rca-proposed-action-kind"]').text()).toBe("Rollback");
    expect(rows[1].find('[data-test="rca-proposed-action-kind"]').exists()).toBe(false);
    // The detail folds under the title.
    expect(wrapper.text()).not.toContain("Revert the pool size change.");
  });

  it("opens an action's detail from its row; nothing runs", async () => {
    const wrapper = mount(RcaProposedActions, {
      props: { actions },
      global: { plugins: [i18n] },
    });
    const row = wrapper.findAll('[data-test="rca-proposed-action"]')[0];
    await row.get('[data-test="rca-fold-row-toggle"]').trigger("click");
    expect(row.get('[data-test="rca-proposed-action-detail"]').text()).toBe(
      "Revert the pool size change.",
    );
    // The only controls are the row toggles.
    expect(
      wrapper.findAll("button").every((b) => b.find('[data-test="rca-fold-row-toggle"]').exists()),
    ).toBe(true);
  });
});
