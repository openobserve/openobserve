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
  default: { listTeams: vi.fn(), whoIsOnCall: vi.fn() },
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
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="$emit('click')"><slot /></button>`,
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
});
