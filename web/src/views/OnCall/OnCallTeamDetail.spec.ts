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
import OnCallTeamDetail from "@/views/OnCall/OnCallTeamDetail.vue";

vi.mock("@/services/oncall", () => ({
  default: {
    getTeam: vi.fn(),
    listMembers: vi.fn(),
    getSchedule: vi.fn(),
    getPolicy: vi.fn(),
    whoIsOnCall: vi.fn(),
    listTeams: vi.fn(),
    listOwnershipRules: vi.fn(),
  },
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { teamId: "team_1" } }),
  useRouter: () => ({ push: vi.fn() }),
}));

const service = vi.mocked(oncallService);

// The tab strip and stat strip are the two things under test, so they render
// for real; everything they contain is a panel with its own spec.
const stubs = {
  OPageLayout: {
    name: "OPageLayout",
    template: "<div><slot name='title-trail' /><slot name='actions' /><slot /></div>",
  },
  OnCallMembers: true,
  OnCallScheduleEditor: true,
  OnCallPolicyEditor: true,
  OnCallOwnership: true,
  OnCallTeamForm: true,
};

function render() {
  return mount(OnCallTeamDetail, { global: { plugins: [i18n, store], stubs } });
}

describe("OnCallTeamDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getTeam.mockResolvedValue({
      data: { id: "team_1", name: "Platform", timezone: "UTC" },
    } as any);
    service.listMembers.mockResolvedValue({ data: [{ user_email: "ana@corp.com" }] } as any);
    service.getSchedule.mockResolvedValue({ data: { rotations: [] } } as any);
    service.getPolicy.mockResolvedValue({ data: { rungs: [] } } as any);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
    service.listTeams.mockResolvedValue({ data: [] } as any);
    service.listOwnershipRules.mockResolvedValue({ data: [] } as any);
  });

  /// Left to right is the order a team has to be built in — people first,
  /// because a schedule with nobody in it is not something anyone can act on.
  it("orders the tabs the way a team is actually set up", async () => {
    const wrapper = render();
    await flushPromises();

    const names = wrapper
      .findAllComponents({ name: "OTab" })
      .map((tab) => tab.props("name"));
    expect(names).toEqual(["members", "schedule", "policy", "ownership"]);
  });

  /// A warning tile stated a problem and then left the reader to find the tab
  /// that fixes it.
  ///
  /// `startsEmpty` picks a landing tab that DIFFERS from the expected one — an
  /// unstaffed team lands on Members, a staffed one on Schedule — so each case
  /// proves the tile moved the tab rather than agreeing with where it already was.
  it.each([
    ["rotations", "schedule", true],
    ["oncall", "schedule", true],
    ["members", "members", false],
    ["rules", "ownership", false],
  ])("opens the tab that answers the %s tile", async (statKey, expectedTab, startsEmpty) => {
    if (startsEmpty) service.listMembers.mockResolvedValue({ data: [] } as any);
    const wrapper = render();
    await flushPromises();

    const panels = wrapper.findComponent({ name: "OTabPanels" });
    expect(panels.props("modelValue")).not.toBe(expectedTab);

    wrapper.findComponent({ name: "OStatStrip" }).vm.$emit("select", statKey);
    await flushPromises();

    expect(panels.props("modelValue")).toBe(expectedTab);
  });

  // Nothing is "current" on this strip, so no tile should render as chosen.
  it("marks no tile as selected", async () => {
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OStatStrip" }).props("selectedKey")).toBeNull();
  });
});
