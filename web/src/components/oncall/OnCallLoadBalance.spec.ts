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

import OnCallLoadBalance from "@/components/oncall/OnCallLoadBalance.vue";
import i18n from "@/locales";
import type { TeamLoad } from "@/ts/interfaces/oncall";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  OProgressBar: { name: "OProgressBar", props: ["value", "variant"], template: "<div />" },
};

function load(over: Partial<TeamLoad> = {}): TeamLoad {
  return {
    team_id: "t",
    from: 0,
    to: 0,
    days: 30,
    members: [],
    upcoming_from: 0,
    upcoming_to: 0,
    rotations: [],
    ...over,
  };
}

const person = (user_email: string, pages: number, nights = 0, acks = 0) => ({
  user_email,
  pages,
  nights,
  acks,
});

function render(l: TeamLoad | null) {
  return mount(OnCallLoadBalance, {
    props: { load: l },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallLoadBalance", () => {
  it("ranks carriers by the pages they took", () => {
    const wrapper = render(load({ members: [person("b@o2.ai", 2), person("a@o2.ai", 8)] }));
    const rows = wrapper.findAll('[data-test^="oncall-load-row-"]');
    expect(rows[0].attributes("data-test")).toBe("oncall-load-row-a@o2.ai");
  });

  /// Somebody who carried nothing is not part of "who has been carrying the
  /// pager" — listing them at zero implies they were in the rotation and idle.
  it("leaves out people who carried nothing", () => {
    const wrapper = render(load({ members: [person("a@o2.ai", 3), person("idle@o2.ai", 0)] }));
    expect(wrapper.find('[data-test="oncall-load-row-idle@o2.ai"]').exists()).toBe(false);
  });

  /// Nights are the cost people actually feel, and an even page count can hide
  /// one person taking every 3am.
  it("calls out overnight pages separately", () => {
    const wrapper = render(load({ members: [person("a@o2.ai", 6, 4)] }));
    expect(wrapper.find('[data-test="oncall-load-row-a@o2.ai"]').text()).toContain("4 overnight");
  });

  /// A rotation is allowed to be slightly uneven without the screen implying
  /// somebody is being exploited.
  it("colours only a carrier taking more than half the load", () => {
    const wrapper = render(load({ members: [person("a@o2.ai", 8), person("b@o2.ai", 2)] }));
    const tones = wrapper
      .findAllComponents({ name: "OProgressBar" })
      .map((bar) => bar.props("variant"));
    expect(tones).toEqual(["warning", "default"]);
  });

  it("leaves an even split uncoloured", () => {
    const wrapper = render(load({ members: [person("a@o2.ai", 5), person("b@o2.ai", 5)] }));
    const tones = wrapper
      .findAllComponents({ name: "OProgressBar" })
      .map((bar) => bar.props("variant"));
    expect(tones).toEqual(["default", "default"]);
  });

  /// The verdict is the engine's, worded by it — an uneven share may be
  /// deliberate, and this side cannot tell.
  it("renders the server's fairness summary verbatim", () => {
    const wrapper = render(
      load({
        members: [person("a@o2.ai", 1)],
        rotations: [
          { rotation: "Primary", shares: [], verdict: "even", summary: "Even" },
        ],
      }),
    );
    expect(wrapper.find('[data-test="oncall-load-fairness-Primary"]').text()).toContain("Even");
  });

  it("says so when nobody was paged in the window", () => {
    expect(render(load()).find('[data-test="oncall-load-empty"]').exists()).toBe(true);
  });

  it("names the window the server answered for", () => {
    expect(render(load({ days: 7, members: [person("a@o2.ai", 1)] })).text()).toContain(
      "last 7 days",
    );
  });
});
