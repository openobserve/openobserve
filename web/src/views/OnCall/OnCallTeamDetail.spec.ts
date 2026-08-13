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
    listResponses: vi.fn(),
    resolvedSchedule: vi.fn(),
    escalationPreview: vi.fn(),
    createOverride: vi.fn(),
    teamOverview: vi.fn(),
    teamReachability: vi.fn(),
    teamConfigRisks: vi.fn(),
    teamLoad: vi.fn(),
  },
}));

const routeParams: Record<string, string> = { teamId: "team_1" };
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: routeParams }),
  useRouter: () => ({ push: vi.fn() }),
}));

const service = vi.mocked(oncallService);

// The tab strip and the attention banner are what is under test, so they
// render for real; everything they sit beside is a panel with its own spec.
const stubs = {
  OPageLayout: {
    name: "OPageLayout",
    template: "<div><slot name='title-trail' /><slot name='actions' /><slot /></div>",
  },
  OTable: { name: "OTable", props: ["data", "columns"], template: "<div />" },
  OnCallScheduleTimeline: true,
  OnCallRotationsTable: true,
  OnCallScheduleEditor: true,
  OnCallEscalationLadder: true,
  OnCallEscalationDryRun: true,
  OnCallCoverForm: true,
  OnCallTeamPulse: true,
  OnCallMembers: true,
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
    delete routeParams.tab;
    service.getTeam.mockResolvedValue({
      data: { id: "team_1", name: "Platform", timezone: "UTC" },
    } as any);
    service.listMembers.mockResolvedValue({ data: [{ user_email: "ana@corp.com" }] } as any);
    service.getSchedule.mockResolvedValue({ data: { rotations: [] } } as any);
    service.getPolicy.mockResolvedValue({ data: { rungs: [] } } as any);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
    service.listTeams.mockResolvedValue({ data: [] } as any);
    service.listOwnershipRules.mockResolvedValue({ data: [] } as any);
    service.listResponses.mockResolvedValue({ data: [] } as any);
    service.resolvedSchedule.mockResolvedValue({ data: [] } as any);
    service.escalationPreview.mockResolvedValue({ data: null } as any);
    service.teamOverview.mockResolvedValue({ data: null } as any);
    service.teamReachability.mockResolvedValue({ data: null } as any);
    service.teamConfigRisks.mockResolvedValue({ data: null } as any);
    service.teamLoad.mockResolvedValue({ data: null } as any);
  });

  /// Overview first — what the team HAS been doing — then the chain that
  /// decides it: when each person is on, what happens if nobody answers, what
  /// reaches the team at all, and finally who the people are.
  it("orders the tabs the way a team is actually set up", async () => {
    const wrapper = render();
    await flushPromises();

    const names = wrapper
      .findAllComponents({ name: "OTab" })
      .map((tab) => tab.props("name"));
    expect(names).toEqual(["overview", "schedule", "policy", "ownership", "members"]);
  });

  /// A team with nobody in it cannot have an overview worth reading, so it
  /// lands where the work is instead.
  it("lands on members while the team is still empty", async () => {
    service.listMembers.mockResolvedValue({ data: [] } as any);
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OTabPanels" }).props("modelValue")).toBe("members");
  });

  /// The setup checklist and the policies list both deep-link here with a
  /// `tab` param. The view was not reading it — the links only appeared to work
  /// because the default landing tab happened to be the one they asked for.
  it("opens the tab the URL asked for", async () => {
    routeParams.tab = "policy";
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OTabPanels" }).props("modelValue")).toBe("policy");
  });

  it("ignores a tab the URL invented", async () => {
    routeParams.tab = "not-a-tab";
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OTabPanels" }).props("modelValue")).toBe("overview");
  });

  describe("the schedule tab", () => {
    async function openSchedule() {
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();
      return wrapper;
    }

    /// The editor carries its OWN draft calendar and rotation table, so showing
    /// it beneath the resolved pair put two of each on the screen.
    it("shows the resolved schedule, not the editor, by default", async () => {
      const wrapper = await openSchedule();

      expect(wrapper.findComponent({ name: "OnCallScheduleTimeline" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallRotationsTable" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallScheduleEditor" }).exists()).toBe(false);
    });

    it("swaps to the editor on demand, and never renders both", async () => {
      const wrapper = await openSchedule();
      wrapper.findComponent({ name: "OnCallRotationsTable" }).vm.$emit("edit", "Primary");
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallScheduleEditor" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallScheduleTimeline" }).exists()).toBe(false);
      expect(wrapper.findComponent({ name: "OnCallRotationsTable" }).exists()).toBe(false);
    });

    /// The point of saving is to see what the engine now says.
    it("returns to the resolved view once the schedule is saved", async () => {
      const wrapper = await openSchedule();
      wrapper.findComponent({ name: "OnCallRotationsTable" }).vm.$emit("add");
      await flushPromises();

      wrapper.findComponent({ name: "OnCallScheduleEditor" }).vm.$emit("saved");
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallScheduleTimeline" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallScheduleEditor" }).exists()).toBe(false);
    });
  });

  describe("the escalation tab", () => {
    async function openEscalation() {
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "policy");
      await flushPromises();
      return wrapper;
    }

    /// Same shape as Schedule: reading the policy tells you its shape, the dry
    /// run tells you whether it reaches anybody.
    it("shows the dry run, not the editor, by default", async () => {
      const wrapper = await openEscalation();

      expect(wrapper.findComponent({ name: "OnCallEscalationLadder" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallEscalationDryRun" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallPolicyEditor" }).exists()).toBe(false);
    });

    it("swaps to the editor on demand, and never renders both", async () => {
      const wrapper = await openEscalation();
      wrapper.findComponent({ name: "OnCallEscalationLadder" }).vm.$emit("edit");
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallPolicyEditor" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallEscalationLadder" }).exists()).toBe(false);
    });

    /// The answer depends on who is on call at THIS instant, so switching
    /// priority has to re-ask rather than filter something already fetched.
    it("re-asks the server when the priority changes", async () => {
      const wrapper = await openEscalation();
      const before = service.escalationPreview.mock.calls.length;

      wrapper.findComponent({ name: "OnCallEscalationLadder" }).vm.$emit("update:selected", "P3");
      await flushPromises();

      expect(service.escalationPreview.mock.calls.length).toBeGreaterThan(before);
      expect(service.escalationPreview).toHaveBeenLastCalledWith(
        expect.objectContaining({ priority: 3 }),
      );
    });
  });

  /// The banner maps each finding's `kind` to the tab that repairs it and emits
  /// that tab, so the view only has to obey.
  it.each([["policy"], ["schedule"], ["ownership"]])(
    "opens the %s tab the banner asked for",
    async (expectedTab) => {
    const wrapper = render();
    await flushPromises();

    const panels = wrapper.findComponent({ name: "OTabPanels" });
    expect(panels.props("modelValue")).not.toBe(expectedTab);

      wrapper.findComponent({ name: "OnCallTeamAttention" }).vm.$emit("act", expectedTab);
      await flushPromises();

      expect(panels.props("modelValue")).toBe(expectedTab);
    },
  );

  /// The panel and the overview list both read this team's own pages; asking
  /// for the whole org's would count other teams' work as this team's.
  it("asks only for this team's pages", async () => {
    render();
    await flushPromises();

    expect(service.listResponses).toHaveBeenCalledWith(
      expect.objectContaining({ team_id: "team_1", include_resolved: true }),
    );
  });

  /// A failed page fetch costs the activity panel, never the rest of the page.
  it("still renders the team when its pages cannot be loaded", async () => {
    service.listResponses.mockRejectedValue(new Error("boom"));
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OnCallTeamPulse" }).exists()).toBe(true);
  });
});
