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
  it("lists each stored action with its kind and detail, as text only", () => {
    const wrapper = mount(RcaProposedActions, {
      props: {
        actions: [
          { title: "Roll back 4f2c1e", kind: "rollback", detail: "Revert the pool size change." },
          { title: "Watch pool usage", kind: "other", detail: "" },
        ],
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.find("h3").text()).toBe("Proposed actions");
    const actions = wrapper.findAll('[data-test="rca-proposed-action"]');
    expect(actions).toHaveLength(2);
    expect(actions[0].text()).toContain("Roll back 4f2c1e");
    expect(actions[0].find('[data-test="rca-proposed-action-kind"]').text()).toBe("· Rollback");
    expect(actions[0].find("p").text()).toBe("Revert the pool size change.");
    expect(actions[1].find('[data-test="rca-proposed-action-kind"]').text()).toBe("· Other");
    expect(actions[1].find("p").exists()).toBe(false);
    // Inert: no control runs an action.
    expect(wrapper.findAll("button, a")).toHaveLength(0);
  });
});
