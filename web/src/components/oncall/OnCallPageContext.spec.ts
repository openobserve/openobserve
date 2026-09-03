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

import OnCallPageContext from "@/components/oncall/OnCallPageContext.vue";
import i18n from "@/locales";
import type { CauseGroup, OnCallResponse } from "@/ts/interfaces/oncall";

const stubs = {
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTimeCell: { name: "OTimeCell", props: ["value"], template: "<span />" },
};

function firing(id: string): OnCallResponse {
  return {
    id,
    org_id: "default",
    subject: { subject_type: "alert", source_id: "al_a", firing: 1 },
    team_id: "team_1",
    priority: 1,
    state: "resolved",
    responder_role: "owner",
    opened_at: 1_700_000_000_000_000,
  } as OnCallResponse;
}

function cause(over: Partial<CauseGroup> = {}): CauseGroup {
  return {
    cause: "noisy_threshold",
    count: 3,
    last_response_id: "r1",
    last_closed_at: 1_700_000_000_000_000,
    ...over,
  };
}

function render(firings: OnCallResponse[] = [], causes: CauseGroup[] = []) {
  return mount(OnCallPageContext, {
    props: { firings, causes },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallPageContext", () => {
  /// The server excludes the current firing from the history, so the count has
  /// to add it back — "13× in 7 days" on the fourteenth firing is wrong.
  it("counts the past firings plus this one", () => {
    const wrapper = render([firing("a"), firing("b")]);
    expect(wrapper.find('[data-test="oncall-context-fired"]').text()).toBe("3× in 7 days");
  });

  it("says so plainly when the alert has never fired before", () => {
    expect(render([]).text()).toContain("First time this alert has fired.");
  });

  it("names what a human said it turned out to be, with their note", () => {
    const wrapper = render([firing("a")], [cause({ note: "rolled back checkout-svc v2.3" })]);
    const text = wrapper.find('[data-test="oncall-context-cause"]').text();

    expect(text).toContain("Noisy threshold");
    expect(text).toContain("rolled back checkout-svc v2.3");
  });

  /// "What was it LAST time" is the question being asked before claiming this
  /// firing — not "what is it usually".
  it("shows the most recently closed cause, not the most frequent", () => {
    const wrapper = render(
      [firing("a")],
      [
        cause({ cause: "noisy_threshold", count: 9, last_closed_at: 1_000 }),
        cause({ cause: "genuine_defect", count: 1, last_closed_at: 9_000 }),
      ],
    );
    expect(wrapper.find('[data-test="oncall-context-cause"]').text()).toContain(
      "Genuine defect",
    );
  });

  /// A blank row would read as "nobody knows", which is a different claim from
  /// "nobody has written it down".
  it("omits the cause row entirely when none was ever recorded", () => {
    const wrapper = render([firing("a")], []);
    expect(wrapper.find('[data-test="oncall-context-cause"]').exists()).toBe(false);
  });
});
