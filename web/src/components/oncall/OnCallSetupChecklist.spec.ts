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
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnCallSetupChecklist from "@/components/oncall/OnCallSetupChecklist.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const stubs = {
  OBanner: { name: "OBanner", template: "<div><slot /><slot name='actions' /></div>" },
  OProgressBar: { name: "OProgressBar", props: ["value"], template: "<div />" },
  OIcon: { name: "OIcon", props: ["name"], template: "<i />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
};

/// `data-state` per step, in order — the whole visual contract of the list.
function states(wrapper: ReturnType<typeof render>): string[] {
  return wrapper
    .findAll("[data-test^='oncall-setup-step-']")
    .map((el) => el.attributes("data-state") ?? "");
}

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallSetupChecklist, {
    props: {
      hasTeam: false,
      hasStaffedRotation: false,
      hasRouting: false,
      ...props,
    },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallSetupChecklist", () => {
  beforeEach(() => vi.clearAllMocks());

  /// S15: the old guide was a static list that ticked nothing off.
  it("marks each step done from live data", () => {
    const wrapper = render({ hasTeam: true, hasStaffedRotation: true, hasRouting: false });

    expect(states(wrapper)).toEqual(["done", "done", "active"]);
  });

  /// The steps genuinely depend on each other: a rotation needs a team, and
  /// routing needs somebody to route to. Exactly one is actionable.
  it("locks every step after the first undone one", () => {
    const wrapper = render();

    expect(states(wrapper)).toEqual(["active", "locked", "locked"]);
    expect(wrapper.find('[data-test="oncall-setup-cta-team"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-setup-cta-rotation"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-setup-locked-rotation"]').text()).toContain("team");
    expect(wrapper.find('[data-test="oncall-setup-locked-routing"]').text()).toContain("rotation");
  });

  /// Which shape shows is the page's call, not progress: an org with nothing to
  /// triage gets the whole checklist however far along it is, and an org with a
  /// live list gets one line however little is done.
  it("shows the full checklist until the page says pages exist", () => {
    const full = render({ hasTeam: true, hasStaffedRotation: true });
    expect(full.find('[data-test="oncall-setup-checklist"]').exists()).toBe(true);
    expect(full.find('[data-test="oncall-setup-banner"]').exists()).toBe(false);

    const compact = render({ compact: true });
    expect(compact.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    expect(compact.find('[data-test="oncall-setup-banner"]').exists()).toBe(true);
  });

  /// The bar is only useful if it names the step actually left to do.
  it("names the next undone step on the compact bar and acts on it", async () => {
    const wrapper = render({ compact: true, hasTeam: true, firstTeamId: "team_1" });

    expect(wrapper.find('[data-test="oncall-setup-next"]').text()).toContain(
      "Add people and a rotation",
    );

    await wrapper.find('[data-test="oncall-setup-bar-cta-rotation"]').trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onCallTeamDetail",
        params: { teamId: "team_1", tab: "schedule" },
      }),
    );
  });

  it("reopens from the bar and can be collapsed again", async () => {
    const wrapper = render({ compact: true, hasTeam: true });

    await wrapper.find('[data-test="oncall-setup-expand"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(true);

    await wrapper.find('[data-test="oncall-setup-collapse"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-setup-banner"]').exists()).toBe(true);
  });

  /// Nothing to get back to when the checklist owns the screen.
  it("offers no collapse while it is the whole page", () => {
    expect(render().find('[data-test="oncall-setup-collapse"]').exists()).toBe(false);
  });

  it("asks the page to open the team form rather than routing itself", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-setup-cta-team"]').trigger("click");

    expect(wrapper.emitted("create-team")).toHaveLength(1);
  });

  /// A finished step's button must not reopen the form that created it.
  it("sends a done team step to the teams list, not the create form", async () => {
    const wrapper = render({ hasTeam: true });
    await wrapper.find('[data-test="oncall-setup-change-team"]').trigger("click");

    expect(wrapper.emitted("create-team")).toBeUndefined();
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "onCallTeams" }));
  });

  /// The rotation step is only useful if it lands on a team's schedule tab.
  it("opens the first team's schedule tab when it knows one", async () => {
    const wrapper = render({ hasTeam: true, firstTeamId: "team_1" });
    await wrapper.find('[data-test="oncall-setup-cta-rotation"]').trigger("click");

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onCallTeamDetail",
        params: { teamId: "team_1", tab: "schedule" },
      }),
    );
  });

  it("sends the routing step to the routing screen", async () => {
    const wrapper = render({ hasTeam: true, hasStaffedRotation: true });
    await wrapper.find('[data-test="oncall-setup-cta-routing"]').trigger("click");

    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "onCallRouting" }));
  });

  /// Every step is an `oncall` write. Offering the button to somebody who
  /// cannot do it only produces a 403.
  it("hides the calls to action without the configuration permission", () => {
    const wrapper = render({ canConfigure: false });

    expect(wrapper.find('[data-test="oncall-setup-cta-team"]').exists()).toBe(false);
  });
});
