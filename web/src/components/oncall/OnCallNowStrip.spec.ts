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

import OnCallNowStrip from "@/components/oncall/OnCallNowStrip.vue";
import i18n from "@/locales";
import type { OnCallTeam } from "@/ts/interfaces/oncall";

const stubs = {
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OIcon: { name: "OIcon", template: "<span />" },
  OButton: {
    name: "OButton",
    props: ["variant", "size", "iconLeft", "iconRight"],
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  // Rendered inline so the menu's contents are assertable without driving the
  // real popup open.
  ODropdown: {
    name: "ODropdown",
    props: ["contentClass"],
    template: "<div><slot name='trigger' /><slot /></div>",
  },
  ODropdownItem: {
    name: "ODropdownItem",
    props: ["disabled", "textValue"],
    emits: ["select"],
    template: "<button @click=\"$emit('select')\"><slot /></button>",
  },
  ODropdownSeparator: { name: "ODropdownSeparator", template: "<hr />" },
};

function team(id: string, name: string, timezone = "UTC"): OnCallTeam {
  return { id, name, timezone } as OnCallTeam;
}

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallNowStrip, {
    props: { teams: [team("team_1", "Search")], ...props },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallNowStrip", () => {
  it("says so when there is no team at all", () => {
    const wrapper = render({ teams: [] });

    expect(wrapper.find("[data-test='oncall-now-strip-empty']").exists()).toBe(true);
    expect(wrapper.find("[data-test='oncall-now-strip-trigger']").text()).toContain(
      "On-call teams (0)",
    );
  });

  /// The count is on the closed button because "is anybody on call" must be
  /// answerable without opening anything.
  it("counts the teams on the closed button", () => {
    const wrapper = render({ teams: [team("t1", "A"), team("t2", "B")] });

    expect(wrapper.find("[data-test='oncall-now-strip-trigger']").text()).toContain(
      "On-call teams (2)",
    );
  });

  /// A gap is the failure this exists to surface, and a failure you have to open
  /// a menu to find is a failure nobody finds.
  it("carries the gap count outside the menu", () => {
    const wrapper = render({
      teams: [team("t1", "A"), team("t2", "B")],
      slotsByTeam: { t1: [{ rotation: "Primary", user_email: "ana@o2.ai" }], t2: [] },
    });

    expect(wrapper.find("[data-test='oncall-now-strip-gap-count']").text()).toBe("1 gap");
  });

  it("shows no gap count when every team is covered", () => {
    const wrapper = render({
      slotsByTeam: { team_1: [{ rotation: "Primary", user_email: "ana@o2.ai" }] },
    });

    expect(wrapper.find("[data-test='oncall-now-strip-gap-count']").exists()).toBe(false);
  });

  /// Whose shift it is and which rotation picked them — the team name is its own
  /// column in the row, so the label spends its width on "why them".
  it("names the person on call and the rotation that picked them", () => {
    const wrapper = render({
      slotsByTeam: { team_1: [{ rotation: "Primary", user_email: "ana@o2.ai" }] },
    });

    expect(wrapper.find("[data-test='oncall-now-holder-team_1']").text()).toContain(
      "ana@o2.ai · Primary",
    );
    expect(wrapper.find("[data-test='oncall-now-team-team_1']").text()).toContain("Search");
  });

  /// On the screen that pages them, whose shift it is matters more than which
  /// mailbox it goes to.
  it("says You for the reader's own shift", () => {
    const wrapper = render({
      slotsByTeam: { team_1: [{ rotation: "Primary", user_email: "Ana@o2.ai" }] },
      viewerEmail: "ana@o2.ai",
    });

    expect(wrapper.find("[data-test='oncall-now-holder-team_1']").text()).toContain(
      "You · Primary",
    );
  });

  /// A rotation handing over at 21:00 means nothing rendered in the reader's own
  /// timezone, and this line is read from other offices.
  it("renders the handover in the team's own zone", () => {
    const wrapper = render({
      teams: [team("team_1", "Search", "Asia/Kolkata")],
      slotsByTeam: { team_1: [{ rotation: "Primary", user_email: "ana@o2.ai" }] },
      // 2023-11-14T22:13:20Z, which is 03:43 the next morning in Kolkata.
      handoverByTeam: { team_1: 1_700_000_000_000_000 },
    });

    expect(wrapper.find("[data-test='oncall-now-handover-team_1']").text()).toBe("→ 03:43 AM");
  });

  /// A team paging nobody is the exception this exists to surface, so it is the
  /// one entry that gets colour, and it opens the menu.
  it("marks a team with nobody on call, and shows it first", () => {
    const wrapper = render({
      teams: [team("t1", "A"), team("t2", "B"), team("t3", "C"), team("t4", "D"), team("t5", "E")],
      slotsByTeam: {
        t1: [{ rotation: "Primary", user_email: "ana@o2.ai" }],
        t2: [{ rotation: "Primary", user_email: "b@o2.ai" }],
        t3: [{ rotation: "Primary", user_email: "c@o2.ai" }],
        t4: [{ rotation: "Primary", user_email: "d@o2.ai" }],
        t5: [],
      },
    });

    expect(wrapper.find("[data-test='oncall-now-gap-t5']").exists()).toBe(true);
    expect(wrapper.findAll("[data-test^='oncall-now-team-']")[0].attributes("data-test")).toBe(
      "oncall-now-team-t5",
    );
  });

  /// The cap this had as a one-line strip is the whole reason it became a menu:
  /// five teams used to print four.
  it("lists every team, however many there are", () => {
    const wrapper = render({
      teams: [team("t1", "A"), team("t2", "B"), team("t3", "C"), team("t4", "D"), team("t5", "E")],
    });

    expect(wrapper.findAll("[data-test^='oncall-now-team-']")).toHaveLength(5);
  });

  /// Whoever is reading "nobody on call for Search" wants Search's schedule, not
  /// the teams list.
  it("opens the team a row names", async () => {
    const wrapper = render();
    await wrapper.find("[data-test='oncall-now-team-team_1']").trigger("click");

    expect(wrapper.emitted("view-team")).toEqual([["team_1"]]);
  });

  it("asks for the schedules when the link is used", async () => {
    const wrapper = render();
    await wrapper.find("[data-test='oncall-now-strip-schedules']").trigger("click");

    expect(wrapper.emitted("view-schedules")).toHaveLength(1);
  });
});
