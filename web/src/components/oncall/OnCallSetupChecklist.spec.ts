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
  OStepper: { name: "OStepper", props: ["modelValue"], template: "<div><slot /></div>" },
  OStep: {
    name: "OStep",
    props: ["name", "title", "done", "icon"],
    template: "<div :data-done='done'><slot /></div>",
  },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
};

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
  it("marks each step done from live data", async () => {
    const wrapper = render({ hasTeam: true, hasStaffedRotation: true, hasRouting: false });
    await wrapper.find('[data-test="oncall-setup-expand"]').trigger("click");
    const done = wrapper
      .findAllComponents({ name: "OStep" })
      .map((s) => s.props("done") as boolean);

    expect(done).toEqual([true, true, false]);
  });

  /// A fresh install has to be shown the whole thing; anything further along
  /// must not have a wizard covering its triage list.
  it("shows the full checklist at zero progress and collapses once past step one", () => {
    expect(render().find('[data-test="oncall-setup-checklist"]').exists()).toBe(true);

    const partial = render({ hasTeam: true });
    expect(partial.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
    expect(partial.find('[data-test="oncall-setup-banner"]').exists()).toBe(true);
  });

  it("reopens from the banner and can be collapsed again", async () => {
    const wrapper = render({ hasTeam: true });

    await wrapper.find('[data-test="oncall-setup-expand"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(true);

    await wrapper.find('[data-test="oncall-setup-collapse"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-setup-banner"]').exists()).toBe(true);
  });

  it("asks the page to open the team form rather than routing itself", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-setup-cta-team"]').trigger("click");

    expect(wrapper.emitted("create-team")).toHaveLength(1);
  });

  /// The rotation step is only useful if it lands on a team's schedule tab.
  it("opens the first team's schedule tab when it knows one", async () => {
    const wrapper = render({ hasTeam: true, firstTeamId: "team_1" });
    await wrapper.find('[data-test="oncall-setup-expand"]').trigger("click");
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
    await wrapper.find('[data-test="oncall-setup-expand"]').trigger("click");
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
