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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnCallCoverList from "@/components/oncall/OnCallCoverList.vue";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { Override } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({
  default: { listOverrides: vi.fn(), deleteOverride: vi.fn() },
}));

const service = vi.mocked(oncallService);

const stubs = {
  OTable: {
    name: "OTable",
    props: ["data", "columns"],
    template: `<div>
      <div v-for="(row, i) in (data || [])" :key="i" data-test="row">
        <slot v-for="c in (columns || [])" :key="c.id" :name="'cell-' + c.id" :row="row" />
      </div>
    </div>`,
  },
  ODialog: {
    name: "ODialog",
    props: ["open"],
    emits: ["click:primary", "click:secondary", "update:open"],
    template: `<div v-if="open">
      <slot />
      <button data-test="confirm" @click="$emit('click:primary')">ok</button>
    </div>`,
  },
  // Emits the real event, because the remove control uses `@click.stop` and
  // `withModifiers` calls `stopPropagation()` on whatever the emit carried —
  // a stub emitting nothing silently swallows the handler.
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="$emit('click', $event)"><slot /></button>`,
  },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
};

const FROM = 1_786_000_000_000_000;

function cover(over: Partial<Override> = {}): Override {
  return {
    id: "ovr_1",
    org_id: "default",
    team_id: "team_1",
    user_email: "sam@o2.ai",
    start_at: FROM,
    end_at: FROM + 3_600_000_000,
    created_by: "ana@o2.ai",
    created_at: FROM,
    ...over,
  };
}

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallCoverList, {
    props: { teamId: "team_1", timezone: "UTC", ...props },
    global: { plugins: [i18n, store], stubs },
  });
}

/// A cover used to appear only as a "· override" annotation on a calendar
/// cell: no reason, no whose-shift, no way to see two stacked on one window,
/// and no way to take one back. `GET .../overrides` and
/// `DELETE .../overrides/{id}` both existed and neither had a caller, so from
/// the UI a cover was permanent.
describe("OnCallCoverList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.listOverrides.mockResolvedValue({ data: [] } as any);
    service.deleteOverride.mockResolvedValue({ data: { deleted: true } } as any);
  });

  it("lists the covers standing over this team's rotations", async () => {
    service.listOverrides.mockResolvedValue({
      data: [cover({ covering_for: "ana@o2.ai", reason: "dentist" })],
    } as any);

    const wrapper = render();
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("sam@o2.ai");
    // Both facts the calendar annotation could not carry.
    expect(text).toContain("ana@o2.ai");
    expect(text).toContain("dentist");
  });

  /// Both are optional on the wire, and legitimately so: "cover tonight" is a
  /// real request before anybody has worked out whose night it is.
  it("renders a cover that names neither a shift nor a reason", async () => {
    service.listOverrides.mockResolvedValue({ data: [cover()] } as any);

    const wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain("Not specified");
    expect(wrapper.find('[data-test="oncall-cover-empty"]').exists()).toBe(false);
  });

  /// Overlaps are legal and the NEWEST wins, so the row on top of an
  /// overlapping pair has to be the one actually in force.
  it("puts the cover that wins an overlap first", async () => {
    service.listOverrides.mockResolvedValue({
      data: [
        cover({ id: "ovr_old", user_email: "old@o2.ai", created_at: FROM }),
        cover({ id: "ovr_new", user_email: "new@o2.ai", created_at: FROM + 1 }),
      ],
    } as any);

    const wrapper = render();
    await flushPromises();

    expect(wrapper.findAll('[data-test="row"]')[0].text()).toContain("new@o2.ai");
  });

  it("asks the endpoint for the window the calendar is showing", async () => {
    render({ window: { from: FROM, to: FROM + 86_400_000_000 } });
    await flushPromises();

    expect(service.listOverrides).toHaveBeenCalledWith(
      expect.objectContaining({ from: FROM, to: FROM + 86_400_000_000 }),
    );
  });

  /// Both bounds or neither: the endpoint refuses a half-specified window
  /// rather than quietly answering the unfiltered list.
  it("sends no bounds at all when it has no window", async () => {
    render();
    await flushPromises();

    const call = service.listOverrides.mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("from");
    expect(call).not.toHaveProperty("to");
  });

  describe("removing a cover", () => {
    it("deletes it and re-reads the list", async () => {
      service.listOverrides.mockResolvedValue({ data: [cover()] } as any);
      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-cover-remove-ovr_1"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="confirm"]').trigger("click");
      await flushPromises();

      expect(service.deleteOverride).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: "team_1", override_id: "ovr_1" }),
      );
      expect(service.listOverrides).toHaveBeenCalledTimes(2);
    });

    /// The calendar above is resolved server-side, so it has to be re-asked —
    /// the window this cover held belongs to the rotation again, and the cell
    /// still names the person who no longer holds it.
    it("tells the calendar to re-resolve", async () => {
      service.listOverrides.mockResolvedValue({ data: [cover()] } as any);
      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-cover-remove-ovr_1"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="confirm"]').trigger("click");
      await flushPromises();

      expect(wrapper.emitted("changed")).toHaveLength(1);
    });

    it("does not delete anything until the confirm is pressed", async () => {
      service.listOverrides.mockResolvedValue({ data: [cover()] } as any);
      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-cover-remove-ovr_1"]').trigger("click");
      await flushPromises();

      expect(service.deleteOverride).not.toHaveBeenCalled();
    });
  });

  /// A cover replaces the holder of ONE position and leaves the others alone,
  /// so "which covers apply to this rotation" is a real question — and on a
  /// team with three of them the unfiltered list answers it by making the
  /// reader check every chip.
  it("shows only the covers standing over the rotation it is scoped to", async () => {
    service.listOverrides.mockResolvedValue({
      data: [
        cover({ id: "ov_primary", rotation_id: "rot_primary" }),
        cover({ id: "ov_secondary", rotation_id: "rot_secondary" }),
      ],
    } as any);

    const wrapper = render({ rotationId: "rot_secondary" });
    await flushPromises();

    const rows = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
    expect(rows.map((r) => r.id)).toEqual(["ov_secondary"]);
  });

  /// The chip answers "which rotation is this standing over", which is not a
  /// question a one-rotation team can ask. It shows the rotation's NAME from
  /// its stored id — printing the id would be an identifier nobody can look up.
  it("names the rotation only where the team staffs more than one", async () => {
    service.listOverrides.mockResolvedValue({
      data: [cover({ rotation_id: "rot_secondary" })],
    } as any);

    const rotations = [
      { id: "rot_primary", name: "Primary", shift_rules: [] },
      { id: "rot_secondary", name: "Secondary", shift_rules: [] },
    ];
    const one = render({ rotations: [rotations[0]] });
    await flushPromises();
    expect(one.text()).not.toContain("Secondary");

    const two = render({ rotations });
    await flushPromises();
    expect(two.text()).toContain("Secondary");
  });

  /// A cover list that cannot load is not worth an error over the calendar it
  /// sits under: the calendar still answers who is on call.
  it("degrades to empty rather than shouting when the read fails", async () => {
    service.listOverrides.mockRejectedValue(new Error("boom"));

    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-cover-empty"]').exists()).toBe(true);
  });
});
