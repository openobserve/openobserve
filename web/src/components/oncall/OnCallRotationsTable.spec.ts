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

import OnCallRotationsTable from "@/components/oncall/OnCallRotationsTable.vue";
import i18n from "@/locales";
import type { Rotation, TeamLoad } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";

// Renders the real cell slots so the tests exercise what the table draws.
const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
  OTooltip: { name: "OTooltip", template: "<span />" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"(e) => $emit('click', e)\"><slot /></button>",
  },
  OTable: {
    name: "OTable",
    props: ["data", "columns"],
    template: `<div>
      <div v-for="(row, i) in (data || [])" :key="i" data-test="row">
        <slot v-for="c in (columns || [])" :key="c.id" :name="'cell-' + c.id" :row="row" />
      </div>
    </div>`,
  },
};

const NOW = Date.now() * 1000;

function rotation(over: Partial<Rotation> = {}): Rotation {
  return {
    name: "Primary",
    members: ["ana@o2.ai", "bob@o2.ai"],
    shift_micros: MICROS_PER_WEEK,
    // Mid-shift so there is a handover ahead.
    anchor_micros: NOW - 2 * MICROS_PER_DAY,
    ...over,
  };
}

function render(rotations: Rotation[], load: TeamLoad | null = null) {
  return mount(OnCallRotationsTable, {
    props: { rotations, timezone: "UTC", load },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallRotationsTable", () => {
  it("names the cadence and the size of the cycle", () => {
    const text = render([rotation()]).text();
    expect(text).toContain("Weekly");
    expect(text).toContain("2 people");
  });

  it("says who holds it now and when it hands over", () => {
    const text = render([rotation()]).text();
    expect(text).toContain("ana@o2.ai");
    expect(text).toContain("bob@o2.ai");
  });

  /// A one-person rotation has no next — naming the same person as their own
  /// handover would be a lie the schedule never makes.
  it("reports no handover for a single-member rotation", () => {
    const text = render([rotation({ members: ["solo@o2.ai"] })]).text();
    expect(text).toContain("no handover");
  });

  it("says nobody is on when the rotation resolves to no one", () => {
    const text = render([rotation({ members: [] })]).text();
    expect(text).toContain("Nobody on call");
  });

  /// The verdict is the engine's. An uneven share may be deliberate, and
  /// nothing here can tell a weighted rotation from an unfair one.
  it("renders the server's fairness summary verbatim", () => {
    const load = {
      team_id: "t",
      from: 0,
      to: 0,
      days: 30,
      members: [],
      upcoming_from: 0,
      upcoming_to: 0,
      rotations: [{ rotation: "Primary", shares: [], verdict: "uneven", summary: "Ana 2× load" }],
    } as TeamLoad;

    expect(render([rotation()], load).text()).toContain("Ana 2× load");
  });

  /// Only the uneven verdict is coloured; a rail of green "Even" badges is one
  /// people stop reading.
  it("colours an uneven verdict and leaves an even one plain", () => {
    const make = (verdict: string, summary: string) =>
      ({
        team_id: "t",
        from: 0,
        to: 0,
        days: 30,
        members: [],
        upcoming_from: 0,
        upcoming_to: 0,
        rotations: [{ rotation: "Primary", shares: [], verdict, summary }],
      }) as TeamLoad;

    const even = render([rotation()], make("even", "Even"));
    const uneven = render([rotation()], make("uneven", "Ana 2×"));

    expect(even.findComponent({ name: "OTag" }).props("variant")).toBe("default-soft");
    expect(uneven.findComponent({ name: "OTag" }).props("variant")).toBe("amber-soft");
  });

  it("asks the caller to edit the rotation that was clicked", async () => {
    const wrapper = render([rotation({ name: "Weekends" })]);
    await wrapper.find('[data-test="oncall-rotation-edit-Weekends"]').trigger("click");

    expect(wrapper.emitted("edit")?.[0]).toEqual(["Weekends"]);
  });

  it("asks the caller to add a rotation", async () => {
    const wrapper = render([rotation()]);
    await wrapper.find('[data-test="oncall-rotations-add"]').trigger("click");

    expect(wrapper.emitted("add")).toHaveLength(1);
  });
});
