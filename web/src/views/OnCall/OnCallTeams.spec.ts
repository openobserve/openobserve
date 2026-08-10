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
import OnCallTeams from "@/views/OnCall/OnCallTeams.vue";

vi.mock("@/services/oncall", () => ({
  default: { listTeams: vi.fn(), whoIsOnCall: vi.fn(), deleteTeam: vi.fn() },
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const service = vi.mocked(oncallService);

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot name='actions' /><slot /></div>" },
  OTable: {
    name: "OTable",
    props: ["data", "columns"],
    template: "<div><slot name='empty' /></div>",
  },
  OEmptyState: { name: "OEmptyState", template: "<div />" },
  OSearchInput: { name: "OSearchInput", template: "<input />" },
  OTooltip: { name: "OTooltip", template: "<span />" },
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
  OnCallTeamForm: { name: "OnCallTeamForm", template: "<div />" },
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "message"],
    emits: ["update:ok", "update:cancel"],
    template: "<div v-if='modelValue' data-test='confirm'>{{ message }}</div>",
  },
  // Mirrors the real OButton: emits declared (otherwise the listener also
  // falls through and handlers run twice) and the event passed on.
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="(e) => $emit('click', e)"><slot /></button>`,
  },
};

function team(id: string, name: string) {
  return { id, org_id: "default", name, timezone: "UTC", created_at: 0, updated_at: 0 };
}

function render() {
  return mount(OnCallTeams, { global: { plugins: [i18n, store], stubs } });
}

/// Renders the on-call column's cell for a given row, which is where the
/// coverage signal lives.
function onCallCell(wrapper: any, row: unknown) {
  const columns = wrapper.findComponent({ name: "OTable" }).props("columns") as any[];
  const col = columns.find((c) => c.id === "on_call_now");
  return mount({ render: () => col.cell({ row: { original: row } }) }, {
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallTeams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
  });

  it("shows who is on call for each team", async () => {
    service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
    service.whoIsOnCall.mockResolvedValue({
      data: [{ level: "primary", user_email: "engineer@example.com" }],
    } as any);

    const wrapper = render();
    await flushPromises();

    expect(onCallCell(wrapper, team("team_1", "Platform")).text()).toContain(
      "engineer@example.com",
    );
  });

  /// A team nobody staffs will page no one, so it earns the one colour on this
  /// page rather than an empty cell.
  it("flags a team with nobody on call", async () => {
    service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);

    const wrapper = render();
    await flushPromises();

    const cell = onCallCell(wrapper, team("team_1", "Platform"));
    expect(cell.text()).toContain("Nobody on call");
    expect(cell.findComponent({ name: "OTag" }).props("variant")).toBe("warning-soft");
  });

  /// "We could not load it" and "nobody is on call" are different claims, and
  /// showing the second for the first sends someone chasing a phantom gap.
  it("does not call a failed lookup a coverage gap", async () => {
    service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
    service.whoIsOnCall.mockRejectedValue(new Error("boom"));

    const wrapper = render();
    await flushPromises();

    expect(onCallCell(wrapper, team("team_1", "Platform")).text()).not.toContain(
      "Nobody on call",
    );
  });

  it("looks up every team", async () => {
    service.listTeams.mockResolvedValue({
      data: [team("team_1", "Platform"), team("team_2", "Payments")],
    } as any);

    render();
    await flushPromises();

    expect(service.whoIsOnCall).toHaveBeenCalledTimes(2);
  });

  it("opens a team on row click", async () => {
    service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
    const wrapper = render();
    await flushPromises();

    wrapper.findComponent({ name: "OTable" }).vm.$emit("row-click", team("team_1", "Platform"));
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "onCallTeamDetail" }),
    );
  });

  /// Named in review: every mistake was permanent, because the delete endpoint
  /// and its service method both existed and nothing called them.
  describe("deleting a team", () => {
    async function open() {
      service.listTeams.mockResolvedValue({ data: [team("team_1", "Platform")] } as any);
      const wrapper = render();
      await flushPromises();
      const columns = wrapper.findComponent({ name: "OTable" }).props("columns") as any[];
      const col = columns.find((c) => c.id === "actions");
      const cell = mount(
        { render: () => col.cell({ row: { original: team("team_1", "Platform") } }) },
        { global: { plugins: [i18n], stubs } },
      );
      await cell.find('[data-test="oncall-team-delete-team_1"]').trigger("click");
      await flushPromises();
      return wrapper;
    }

    /// Deleting the wrong rotation silently stops paging, and the name is the
    /// only thing distinguishing two otherwise identical rows.
    it("names the team and the consequence before deleting", async () => {
      const wrapper = await open();
      const confirm = wrapper.find('[data-test="confirm"]');

      expect(confirm.exists()).toBe(true);
      expect(confirm.text()).toContain("Platform");
      expect(confirm.text()).toContain("page nobody");
      expect(service.deleteTeam).not.toHaveBeenCalled();
    });

    it("deletes on confirm and reloads", async () => {
      service.deleteTeam.mockResolvedValue({ data: {} } as any);
      const wrapper = await open();

      wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
      await flushPromises();

      expect(service.deleteTeam).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: "team_1" }),
      );
      expect(service.listTeams).toHaveBeenCalledTimes(2);
    });

    it("does nothing on cancel", async () => {
      const wrapper = await open();

      wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:cancel");
      await flushPromises();

      expect(service.deleteTeam).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="confirm"]').exists()).toBe(false);
    });
  });
});
