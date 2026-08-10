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

import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import OnCallResponses from "@/views/OnCall/OnCallResponses.vue";

vi.mock("@/services/oncall", () => ({
  default: {
    listResponses: vi.fn(),
    listTeams: vi.fn(),
    acknowledgeResponse: vi.fn(),
    resolveResponse: vi.fn(),
  },
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const service = vi.mocked(oncallService);

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot name='actions' /><slot /></div>" },
  OTable: {
    name: "OTable",
    props: ["data", "rowClass", "getRowStyle", "columns", "selectedIds", "isRowSelectable"],
    emits: ["update:selectedIds"],
    template: "<div><slot name='toolbar' /><slot name='subheader' /><slot name='empty' /></div>",
  },
  OStatStrip: {
    name: "OStatStrip",
    props: ["items", "selectedKey"],
    emits: ["select"],
    template: "<div />",
  },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OEmptyState: { name: "OEmptyState", props: ["preset"], template: "<div :data-preset='preset' />" },
  OSelect: { name: "OSelect", template: "<select />" },
  OSearchInput: { name: "OSearchInput", template: "<input />" },
  OTooltip: { name: "OTooltip", template: "<span />" },
  // Mirrors the real OButton: `emits` declared (without it the listener also
  // falls through and every handler runs twice), and the event is passed on,
  // which row actions need in order to stop the row-click navigating.
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="(e) => $emit('click', e)"><slot /></button>`,
  },
};

const team = {
  id: "team_1",
  org_id: "default",
  name: "Platform",
  timezone: "UTC",
  created_at: 0,
  updated_at: 0,
};

function render() {
  return mount(OnCallResponses, { global: { plugins: [i18n, store], stubs } });
}

describe("OnCallResponses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.listResponses.mockResolvedValue({ data: [] } as any);
  });

  // The bug this pins: "Nothing is paging" is only reassuring once something
  // COULD page. On a fresh install it is indistinguishable from "nothing is
  // set up", and the page offered no way forward.
  function page(over: Record<string, unknown> = {}) {
    return {
      id: "resp_1",
      org_id: "default",
      subject: { subject_type: "alert", source_id: "al_ckt", firing: 1 },
      team_id: "team_1",
      priority: 1,
      state: "triggered",
      title: "checkout_failing",
      opened_at: 1_700_000_000_000_000,
      acked_by: null,
      acked_at: null,
      closed_at: null,
      ...over,
    };
  }

  async function withPages(rows: Record<string, unknown>[]) {
    service.listTeams.mockResolvedValue({ data: [team] } as any);
    service.listResponses.mockResolvedValue({ data: rows } as any);
    const wrapper = render();
    await flushPromises();
    return wrapper;
  }

  const stats = (w: any) =>
    Object.fromEntries(
      (w.findComponent({ name: "OStatStrip" }).props("items") as any[]).map((i) => [
        i.key,
        i.value,
      ]),
    );

  /// The strip claims to describe the rows below it, so a snoozed page must
  /// not also be counted as one nobody has picked up.
  it("counts a snoozed page as snoozed, not as unacknowledged", async () => {
    const wrapper = await withPages([
      page({ id: "a" }),
      page({ id: "b", snoozed_until: (Date.now() + 60_000) * 1000 }),
    ]);

    expect(stats(wrapper)).toMatchObject({ unacked: 1, snoozed: 1, all: 2 });
  });

  it("does not count an acknowledged page as unacknowledged", async () => {
    const wrapper = await withPages([page({ acked_by: "engineer@example.com" })]);
    expect(stats(wrapper).unacked).toBe(0);
  });

  /// Re-clicking the live tile clears the facet, and "All" only ever clears —
  /// otherwise there is no way back to the full list.
  it("toggles a facet off and lets All clear it", async () => {
    const wrapper = await withPages([page()]);
    const strip = wrapper.findComponent({ name: "OStatStrip" });

    strip.vm.$emit("select", "unacked");
    await flushPromises();
    expect(strip.props("selectedKey")).toBe("unacked");

    strip.vm.$emit("select", "unacked");
    await flushPromises();
    expect(strip.props("selectedKey")).toBe(null);

    strip.vm.$emit("select", "p1");
    await flushPromises();
    strip.vm.$emit("select", "all");
    await flushPromises();
    expect(strip.props("selectedKey")).toBe(null);
  });

  /// The tile counts must not move as you click them, or the strip becomes
  /// unreadable — they answer to the other filters, not to their own facet.
  it("keeps the tile counts steady while a facet is applied", async () => {
    const wrapper = await withPages([
      page({ id: "a" }),
      page({ id: "b", priority: 3, acked_by: "engineer@example.com" }),
    ]);
    const before = stats(wrapper);

    wrapper.findComponent({ name: "OStatStrip" }).vm.$emit("select", "unacked");
    await flushPromises();

    expect(stats(wrapper)).toEqual(before);
    expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(1);
  });

  /// A resolved record has no severity left to signal; a stale rail would say
  /// it still does.
  it("rails open rows by severity and leaves closed ones bare", async () => {
    const wrapper = await withPages([page()]);
    const style = wrapper.findComponent({ name: "OTable" }).props("getRowStyle") as any;

    expect(style(page({ priority: 1 })).boxShadow).toContain("error");
    expect(style(page({ priority: 2 })).boxShadow).toContain("orange");
    expect(style(page({ state: "resolved" }))).toEqual({});
  });

  it("shows the setup guide when the org has no teams", async () => {
    service.listTeams.mockResolvedValue({ data: [] } as any);
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-setup-guide"]').exists()).toBe(true);
    expect(wrapper.find('[data-preset="no-oncall-responses"]').exists()).toBe(false);
  });

  it("shows the calm empty state once a team exists", async () => {
    service.listTeams.mockResolvedValue({ data: [team] } as any);
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-setup-guide"]').exists()).toBe(false);
    expect(wrapper.find('[data-preset="no-oncall-responses"]').exists()).toBe(true);
  });

  // A guide that flashes on every load would read as "your setup vanished".
  it("does not show the guide before the first fetch resolves", () => {
    service.listTeams.mockReturnValue(new Promise(() => {}) as any);
    const wrapper = render();
    expect(wrapper.find('[data-test="oncall-setup-guide"]').exists()).toBe(false);
  });

  it("always offers a route to Teams", async () => {
    service.listTeams.mockResolvedValue({ data: [team] } as any);
    const wrapper = render();
    await flushPromises();

    await wrapper.find('[data-test="oncall-responses-teams-btn"]').trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "onCallTeams" }),
    );
  });

  // A failed fetch must not be mistaken for an empty org and answered with a
  // setup guide the user does not need.
  it("does not show the guide when the fetch failed", async () => {
    service.listTeams.mockRejectedValue(new Error("boom"));
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-setup-guide"]').exists()).toBe(false);
  });

  /// During an incident the list IS the work surface. Opening 200 pages one at
  /// a time to claim them is not triage.
  describe("acting from the list", () => {
    const cell = (w: any, id: string, row: any) => {
      const col = (w.findComponent({ name: "OTable" }).props("columns") as any[]).find(
        (c) => c.id === id,
      );
      return mount({ render: () => col.cell({ row: { original: row } }) }, {
        global: { plugins: [i18n], stubs },
      });
    };

    it("acknowledges a single page without opening it", async () => {
      service.acknowledgeResponse.mockResolvedValue({ data: {} } as any);
      const wrapper = await withPages([page()]);

      await cell(wrapper, "actions", page())
        .find('[data-test="oncall-row-ack-resp_1"]')
        .trigger("click");
      await flushPromises();

      expect(service.acknowledgeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ response_id: "resp_1" }),
      );
      // The row's own click navigates; the button must not also navigate.
      expect(push).not.toHaveBeenCalled();
    });

    /// A page somebody already owns cannot be claimed again, so offering the
    /// button would only produce an error.
    it("offers acknowledge only while the page is escalating", async () => {
      const wrapper = await withPages([page()]);
      const acked = page({ state: "acknowledged", acked_by: "engineer@example.com" });

      expect(
        cell(wrapper, "actions", page()).find('[data-test="oncall-row-ack-resp_1"]').exists(),
      ).toBe(true);
      expect(
        cell(wrapper, "actions", acked).find('[data-test="oncall-row-ack-resp_1"]').exists(),
      ).toBe(false);
      // Resolve stays: an acknowledged page still has to be closed.
      expect(
        cell(wrapper, "actions", acked).find('[data-test="oncall-row-resolve-resp_1"]').exists(),
      ).toBe(true);
    });

    it("bulk acknowledges the selection", async () => {
      service.acknowledgeResponse.mockResolvedValue({ data: {} } as any);
      const wrapper = await withPages([page({ id: "a" }), page({ id: "b" })]);

      wrapper.findComponent({ name: "OTable" }).vm.$emit("update:selectedIds", ["a", "b"]);
      await flushPromises();
      await wrapper.find('[data-test="oncall-bulk-ack"]').trigger("click");
      await flushPromises();

      expect(service.acknowledgeResponse).toHaveBeenCalledTimes(2);
    });

    /// One page failing must not silently abandon the other ninety-nine.
    it("reports partial failure and still acknowledges the rest", async () => {
      service.acknowledgeResponse
        .mockResolvedValueOnce({ data: {} } as any)
        .mockRejectedValueOnce(new Error("boom"));
      const wrapper = await withPages([page({ id: "a" }), page({ id: "b" })]);

      wrapper.findComponent({ name: "OTable" }).vm.$emit("update:selectedIds", ["a", "b"]);
      await flushPromises();
      await wrapper.find('[data-test="oncall-bulk-ack"]').trigger("click");
      await flushPromises();

      expect(service.acknowledgeResponse).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[data-test="oncall-bulk-ack"]').exists()).toBe(false);
    });

    /// The whole point of the Alert column: a woken engineer cannot act on a
    /// ksuid.
    it("shows the alert name, not the ksuid, and searches it", async () => {
      const wrapper = await withPages([page({ title: "checkout_failing" })]);
      const columns = wrapper.findComponent({ name: "OTable" }).props("columns") as any[];
      const subject = columns.find((c) => c.id === "subject");

      expect(subject.accessorFn(page({ title: "checkout_failing" }))).toBe("checkout_failing");
      // No title (an older record) still identifies itself somehow.
      expect(subject.accessorFn(page({ title: null }))).toBe("al_ckt");
    });
  });
});
