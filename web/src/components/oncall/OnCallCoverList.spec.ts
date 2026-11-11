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
import { ok } from "@/test/unit/helpers/mockService";
import store from "@/test/unit/helpers/store";
import type { Override } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({
  default: { listOverrides: vi.fn(), deleteOverride: vi.fn() },
}));

const service = vi.mocked(oncallService);

const stubs = {
  OTable: {
    name: "OTable",
    props: ["data", "columns", "persistColumns", "tableId", "columnVisibility"],
    template: `<div>
      <div v-for="(row, i) in (data || [])" :key="i" data-test="row">
        <slot v-for="c in (columns || [])" :key="c.id" :name="'cell-' + c.id" :row="row" />
      </div>
    </div>`,
  },
  ODialog: {
    name: "ODialog",
    props: ["open", "primaryButtonVariant"],
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
    rotation_id: "rot_primary",
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
    service.listOverrides.mockResolvedValue(ok([]));
    service.deleteOverride.mockResolvedValue(ok({ deleted: true }));
  });

  it("tells the page when the license refuses the read", async () => {
    service.listOverrides.mockRejectedValueOnce({
      response: { status: 403, data: { code: 40001, error_detail: "oncall" } },
    });
    const wrapper = render({ teamId: "team_denied" });
    await flushPromises();

    expect(wrapper.emitted("licenseDenied")).toEqual([[["oncall"]]]);
  });

  // The delete targets the team now shown, so the previous team's covers must not stay listed while its read is in flight.
  it("drops the previous team's covers the moment the team changes", async () => {
    service.listOverrides.mockResolvedValue(ok([cover({ team_id: "team_a" })]));
    const wrapper = render({ teamId: "team_a" });
    await flushPromises();
    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(1);

    service.listOverrides.mockReturnValue(new Promise(() => {}));
    await wrapper.setProps({ teamId: "team_b" });

    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(0);
  });

  // The covers' times are on the team's clock, which nothing else on the row says.
  it("names the team's zone beside the list title", async () => {
    service.listOverrides.mockResolvedValue(ok([cover()]));
    const wrapper = render({ timezone: "Asia/Kolkata" });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-cover-list-zone"]').text()).toBe(
      "Times in Asia/Kolkata",
    );
  });

  it("lists the covers standing over this team's rotations", async () => {
    service.listOverrides.mockResolvedValue(
      ok([cover({ covering_for: "ana@o2.ai", reason: "dentist" })]),
    );

    const wrapper = render();
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("sam@o2.ai");
    // Both facts the calendar annotation could not carry.
    expect(text).toContain("ana@o2.ai");
    expect(text).toContain("dentist");
  });

  // OTable only renders its column toggle with all three of these, so a hidden Reason stays reachable.
  it("hides Reason by default behind a column toggle the reader can flip", async () => {
    service.listOverrides.mockResolvedValue(ok([cover({ reason: "dentist" })]));

    const wrapper = render();
    await flushPromises();

    const table = wrapper.findComponent({ name: "OTable" });
    expect(table.props("persistColumns")).toBe(true);
    expect(table.props("tableId")).toBe("oncall-team-covers");
    expect(table.props("columnVisibility")).toEqual({ reason: false });
    const reason = table.props("columns").find((c: { id: string }) => c.id === "reason");
    expect(reason.hideable).toBe(true);
  });

  /// Both are optional on the wire, and legitimately so: "cover tonight" is a
  /// real request before anybody has worked out whose night it is.
  it("renders a cover that names neither a shift nor a reason", async () => {
    service.listOverrides.mockResolvedValue(ok([cover()]));

    const wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain("Not specified");
    expect(wrapper.find('[data-test="oncall-cover-list"]').exists()).toBe(true);
  });

  /// Overlaps are legal and the NEWEST wins, so the row on top of an
  /// overlapping pair has to be the one actually in force.
  it("puts the cover that wins an overlap first", async () => {
    service.listOverrides.mockResolvedValue(
      ok([
        cover({ id: "ovr_old", user_email: "old@o2.ai", created_at: FROM }),
        cover({ id: "ovr_new", user_email: "new@o2.ai", created_at: FROM + 1 }),
      ]),
    );

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

  it("waits for the calendar's window instead of asking for from=0&to=0", async () => {
    const wrapper = render({ window: { from: 0, to: 0 } });
    await flushPromises();
    expect(service.listOverrides).not.toHaveBeenCalled();

    const real = { from: FROM + 7 * 86_400_000_000, to: FROM + 8 * 86_400_000_000 };
    await wrapper.setProps({ window: real });
    await flushPromises();
    expect(service.listOverrides).toHaveBeenCalledTimes(1);
    expect(service.listOverrides).toHaveBeenCalledWith(expect.objectContaining(real));
  });

  /// Both bounds or neither: the endpoint refuses a half-specified window
  /// rather than quietly answering the unfiltered list. The service drops an
  /// undefined bound before it builds the query string.
  it("sends no bounds at all when it has no window", async () => {
    render();
    await flushPromises();

    const call = service.listOverrides.mock.calls[0][0] as Record<string, unknown>;
    expect(call.from).toBeUndefined();
    expect(call.to).toBeUndefined();
  });

  /// Paging back to a week already read answers from the cache at once, so the
  /// slower answer for the week just left lands last and must not be drawn.
  it("ignores a slower answer for a window the calendar has already left", async () => {
    const thisWeek = { from: FROM, to: FROM + 86_400_000_000 };
    const nextWeek = { from: FROM + 86_400_000_000, to: FROM + 2 * 86_400_000_000 };
    service.listOverrides.mockResolvedValue(ok([cover()]));
    const wrapper = render({ window: thisWeek });
    await flushPromises();
    let answerNext: (value: Awaited<ReturnType<typeof service.listOverrides>>) => void = () => {};
    service.listOverrides.mockImplementationOnce(
      () => new Promise((resolve) => (answerNext = resolve)),
    );

    await wrapper.setProps({ window: nextWeek });
    await flushPromises();
    await wrapper.setProps({ window: thisWeek });
    await flushPromises();
    answerNext(ok([cover({ id: "ovr_2" }), cover({ id: "ovr_3" })]));
    await flushPromises();

    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(1);
  });

  /// The calendar above this list remounts on every tab and range change.
  it("serves a remount from the cache, and reaches the server on refresh", async () => {
    service.listOverrides.mockResolvedValue(ok([cover()]));

    const first = render({ window: { from: FROM, to: FROM + 86_400_000_000 } });
    await flushPromises();
    expect(service.listOverrides).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = render({ window: { from: FROM, to: FROM + 86_400_000_000 } });
    await flushPromises();
    expect(service.listOverrides).toHaveBeenCalledTimes(1);

    // The parent calls this after a write, so it cannot take the entry it outdated.
    await (second.vm as unknown as { refresh: () => Promise<void> }).refresh();
    await flushPromises();
    expect(service.listOverrides).toHaveBeenCalledTimes(2);
  });

  describe("removing a cover", () => {
    it("deletes it and re-reads the list", async () => {
      service.listOverrides.mockResolvedValue(ok([cover()]));
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
      service.listOverrides.mockResolvedValue(ok([cover()]));
      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-cover-remove-ovr_1"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="confirm"]').trigger("click");
      await flushPromises();

      expect(wrapper.emitted("changed")).toHaveLength(1);
    });

    it("does not delete anything until the confirm is pressed", async () => {
      service.listOverrides.mockResolvedValue(ok([cover()]));
      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-cover-remove-ovr_1"]').trigger("click");
      await flushPromises();

      expect(service.deleteOverride).not.toHaveBeenCalled();
    });

    it("names the covering member in bold, with a destructive button", async () => {
      service.listOverrides.mockResolvedValue(ok([cover()]));
      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-cover-remove-ovr_1"]').trigger("click");
      await flushPromises();

      const name = wrapper.find('[data-test="oncall-cover-remove-name"]');
      expect(name.text()).toBe(cover().user_email);
      expect(name.classes()).toContain("font-semibold");
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((c) => c.attributes("data-test") === "oncall-cover-remove-dialog");
      expect(dialog!.props("primaryButtonVariant")).toBe("destructive");
    });

    it("keeps the sentence while the dialog fades out after the remove", async () => {
      service.listOverrides.mockResolvedValue(ok([cover()]));
      // Renders its body while closed, as the real dialog does during its fade.
      const FadingDialog = {
        name: "ODialog",
        props: ["open"],
        emits: ["click:primary", "click:secondary", "update:open"],
        template: `<div :data-open="String(open)"><slot />
          <button data-test="confirm" @click="$emit('click:primary')">ok</button></div>`,
      };
      const wrapper = mount(OnCallCoverList, {
        props: { teamId: "team_1", timezone: "UTC" },
        global: { plugins: [i18n, store], stubs: { ...stubs, ODialog: FadingDialog } },
      });
      await flushPromises();

      await wrapper.find('[data-test="oncall-cover-remove-ovr_1"]').trigger("click");
      await wrapper.find('[data-test="confirm"]').trigger("click");
      await flushPromises();

      expect(wrapper.find("[data-open]").attributes("data-open")).toBe("false");
      expect(wrapper.find('[data-test="oncall-cover-remove-name"]').text()).toBe("sam@o2.ai");
    });
  });

  /// A cover replaces the holder of ONE position and leaves the others alone,
  /// so "which covers apply to this rotation" is a real question — and on a
  /// team with three of them the unfiltered list answers it by making the
  /// reader check every chip.
  it("shows only the covers standing over the rotation it is scoped to", async () => {
    service.listOverrides.mockResolvedValue(
      ok([
        cover({ id: "ov_primary", rotation_id: "rot_primary" }),
        cover({ id: "ov_secondary", rotation_id: "rot_secondary" }),
      ]),
    );

    const wrapper = render({ rotationId: "rot_secondary" });
    await flushPromises();

    const rows = wrapper.findComponent({ name: "OTable" }).props("data") as Override[];
    expect(rows.map((r) => r.id)).toEqual(["ov_secondary"]);
  });

  /// The chip answers "which rotation is this standing over", which is not a
  /// question a one-rotation team can ask. It shows the rotation's NAME from
  /// its stored id — printing the id would be an identifier nobody can look up.
  it("names the rotation a cover stands over, by its name", async () => {
    service.listOverrides.mockResolvedValue(ok([cover({ rotation_id: "rot_secondary" })]));

    const rotations = [
      { id: "rot_primary", name: "Primary", shift_rules: [] },
      { id: "rot_secondary", name: "Secondary", shift_rules: [] },
    ];
    const two = render({ rotations });
    await flushPromises();
    expect(two.text()).toContain("Secondary");
  });

  /// A cover list that cannot load is not worth an error over the calendar it
  /// sits under: the calendar still answers who is on call.
  it("degrades to nothing rather than shouting when the read fails", async () => {
    service.listOverrides.mockRejectedValue(new Error("boom"));

    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-cover-list"]').exists()).toBe(false);
  });

  /// The timeline and its legend already show there are no covers, so an empty list says nothing at all.
  it("renders nothing when there are no covers in the window", async () => {
    service.listOverrides.mockResolvedValue(ok([]));
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-cover-list"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No covers in this window.");
  });

  it("heads the list with its count, and no explanation sentence", async () => {
    service.listOverrides.mockResolvedValue(ok([cover({ id: "ov_1" }), cover({ id: "ov_2" })]));
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-cover-list-title"]').text()).toBe("Covers (2)");
    expect(wrapper.text()).not.toContain("A cover wins over every rotation");
  });
});
