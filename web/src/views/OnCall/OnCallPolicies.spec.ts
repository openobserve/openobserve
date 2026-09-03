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
import OnCallPolicies from "@/views/OnCall/OnCallPolicies.vue";

vi.mock("@/services/oncall", () => ({
  default: { listTeams: vi.fn(), getPolicy: vi.fn(), whoIsOnCall: vi.fn() },
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const service = vi.mocked(oncallService);

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot /></div>" },
  OTable: {
    name: "OTable",
    props: ["data", "columns"],
    template: "<div><slot name='subheader' /></div>",
  },
  OStatStrip: { name: "OStatStrip", props: ["items"], template: "<div />" },
  OSearchInput: { name: "OSearchInput", template: "<div />" },
  OButton: { name: "OButton", template: "<button />" },
  OTooltip: { name: "OTooltip", template: "<div />" },
  OEmptyState: { name: "OEmptyState", template: "<div />" },
};

const TEAMS = [
  { id: "t1", name: "Payments" },
  { id: "t2", name: "Platform" },
];

function rung(priority: number, targets: unknown[] | null) {
  return {
    priority,
    channels: ["email"],
    steps: targets === null ? [] : [{ after_micros: 0, targets }],
  };
}

function render() {
  return mount(OnCallPolicies, { global: { plugins: [i18n, store], stubs } });
}

const rowsOf = (w: any) => w.findComponent({ name: "OTable" }).props("data") as any[];
const statsOf = (w: any) =>
  Object.fromEntries(
    (w.findComponent({ name: "OStatStrip" }).props("items") as any[]).map((i) => [
      i.key,
      i.value,
    ]),
  );

describe("OnCallPolicies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.listTeams.mockResolvedValue({ data: TEAMS } as any);
    service.whoIsOnCall.mockResolvedValue({
      data: [{ rotation: "Weekdays", user_email: "ana@o2.ai", next_user_email: "bob@o2.ai" }],
    } as any);
    service.getPolicy.mockResolvedValue({
      data: { rungs: [rung(1, [{ kind: "on_call_now" }])] },
    } as any);
  });

  /// The audit this page exists for: a priority with no rungs wakes nobody,
  /// however it is delivered, and finding it meant opening every team.
  it("names the priorities a team pages nobody at", async () => {
    service.getPolicy.mockResolvedValue({
      data: { rungs: [rung(1, [{ kind: "on_call_now" }]), rung(2, null)] },
    } as any);
    const wrapper = render();
    await flushPromises();

    expect(rowsOf(wrapper)[0].silent).toEqual([2]);
    expect(statsOf(wrapper).silent).toBe(2);
  });

  /// Configured and useless: a next-on-call rung on a one-person rotation.
  it("names the priorities whose rung resolves to nobody", async () => {
    service.whoIsOnCall.mockResolvedValue({
      data: [{ rotation: "Solo", user_email: "ana@o2.ai", next_user_email: null }],
    } as any);
    service.getPolicy.mockResolvedValue({
      data: { rungs: [rung(1, [{ kind: "next_on_call" }])] },
    } as any);
    const wrapper = render();
    await flushPromises();

    expect(rowsOf(wrapper)[0].unreachable).toEqual([1]);
  });

  // A team nobody is on call for is the loudest fact on the page.
  it("counts a team with no rotation as a coverage gap", async () => {
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
    const wrapper = render();
    await flushPromises();

    expect(rowsOf(wrapper)[0].onCall).toBe("");
    expect(statsOf(wrapper).gaps).toBe(2);
  });

  /// A policy we could not read is NOT a policy that pages nobody, and showing
  /// it as one would send somebody to fix a team that is fine.
  it("leaves out a team whose policy failed to load", async () => {
    service.getPolicy
      .mockResolvedValueOnce({ data: { rungs: [rung(1, [{ kind: "on_call_now" }])] } } as any)
      .mockRejectedValueOnce(new Error("boom"));
    const wrapper = render();
    await flushPromises();

    const rows = rowsOf(wrapper);
    expect(rows).toHaveLength(1);
    expect(rows[0].teamName).toBe("Payments");
  });

  // The rotation is context; losing it must not hide the ladder itself.
  it("still lists a team whose rotation failed to load", async () => {
    service.whoIsOnCall.mockRejectedValue(new Error("boom"));
    const wrapper = render();
    await flushPromises();

    expect(rowsOf(wrapper)).toHaveLength(2);
    expect(rowsOf(wrapper)[0].onCall).toBe("");
  });

  /// On-Call owns one rail entry, so a sub-page with no Back is a dead end.
  /// Mounted through the REAL page layout: the button lives in OPageHeader, and
  /// a stubbed layout would report success while nothing rendered.
  it("offers a way back to the teams list it was opened from", async () => {
    const { OPageLayout: _stubbedLayout, ...realLayout } = stubs;
    const wrapper = mount(OnCallPolicies, {
      global: { plugins: [i18n, store], stubs: realLayout },
    });
    await flushPromises();

    const back = wrapper.find('[data-test="oncall-policies-back-btn"]');
    expect(back.exists()).toBe(true);
    await back.trigger("click");

    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "onCallTeams" }));
  });

  /// I13: the tab is called Escalation, so that is what the link says. The old
  /// `policy` spelling still resolves for links already saved, but nothing we
  /// generate should keep minting the word the screen does not use.
  it("opens the team on its escalation tab, in the word the tab uses", async () => {
    const wrapper = render();
    await flushPromises();

    wrapper.findComponent({ name: "OTable" }).vm.$emit("row-click", rowsOf(wrapper)[0]);

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onCallTeamDetail",
        params: { teamId: "t1", tab: "escalation" },
      }),
    );
  });
});
