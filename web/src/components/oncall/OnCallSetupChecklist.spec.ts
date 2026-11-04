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

import { flushPromises } from "@vue/test-utils";

import OnCallSetupChecklist from "@/components/oncall/OnCallSetupChecklist.vue";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import { resetOnCallPolicyReviewed } from "@/composables/useOnCallPolicyReviewed";
import { resetOnCallSetupDismissed } from "@/composables/useOnCallSetupDismissed";
import store from "@/test/unit/helpers/store";
import { axiosReply } from "@/test/unit/helpers/mockService";

vi.mock("@/services/oncall", () => ({ default: { testPage: vi.fn() } }));

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
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "message"],
    emits: ["update:ok", "update:cancel"],
    template: "<div v-if='modelValue' data-test='confirm'>{{ message }}</div>",
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
      hasPolicy: false,
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

    expect(states(wrapper)).toEqual(["done", "done", "active", "todo", "todo"]);
  });

  /// No artificial lock: every undone step can be opened out of order, and only the next one is loud.
  it("offers a button on every undone step", () => {
    const wrapper = render();

    expect(states(wrapper)).toEqual(["active", "todo", "todo", "todo", "todo"]);
    for (const key of ["team", "rotation", "policy", "routing", "test"]) {
      expect(wrapper.find(`[data-test="oncall-setup-cta-${key}"]`).exists()).toBe(true);
    }
    expect(wrapper.find('[data-test^="oncall-setup-locked-"]').exists()).toBe(false);
  });

  /// A done step is one line: its name and a Change button, no description.
  it("collapses a done step to one line naming the team", () => {
    const wrapper = render({ hasTeam: true, firstTeamName: "Checkout" });
    const team = wrapper.find('[data-test="oncall-setup-step-team"]');

    expect(team.text()).toContain("Create your team · Checkout");
    expect(team.find('[data-test="oncall-setup-body-team"]').exists()).toBe(false);
    expect(team.find('[data-test="oncall-setup-change-team"]').exists()).toBe(true);
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
      "Add members and who's on first",
    );
    expect(wrapper.find('[data-test="oncall-setup-bar-cta-rotation"]').text()).toContain(
      "Add members",
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

  it("sends the policy step to the first team's escalation tab", async () => {
    const wrapper = render({ hasTeam: true, hasStaffedRotation: true, firstTeamId: "team_1" });
    await wrapper.find('[data-test="oncall-setup-cta-policy"]').trigger("click");

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ params: { teamId: "team_1", tab: "escalation" } }),
    );
  });

  /// The test page is a real page, so it asks first, and the step is done only once a send landed.
  it("ticks the test step only once a test page actually lands", async () => {
    const result = (delivered: boolean) =>
      axiosReply({
        reached_anyone: delivered,
        channels: ["email"],
        attempts: [{ channel: "email", recipient: "a@o2.ai", reason: "", delivered }],
      });
    vi.mocked(oncallService.testPage).mockResolvedValueOnce(result(false));
    const wrapper = render({ hasTeam: true, firstTeamId: "team_1", firstTeamName: "Checkout" });

    await wrapper.find('[data-test="oncall-setup-cta-test"]').trigger("click");
    expect(oncallService.testPage).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="confirm"]').text()).toContain("Checkout");
    wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();
    expect(states(wrapper).at(-1)).not.toBe("done");

    vi.mocked(oncallService.testPage).mockResolvedValueOnce(result(true));
    await wrapper.find('[data-test="oncall-setup-cta-test"]').trigger("click");
    wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();
    expect(states(wrapper).at(-1)).toBe("done");
  });

  /// Every step is an `oncall` write. Offering the button to somebody who
  /// cannot do it only produces a 403.
  it("hides the calls to action without the configuration permission", () => {
    const wrapper = render({ canConfigure: false });

    expect(wrapper.find('[data-test="oncall-setup-cta-team"]').exists()).toBe(false);
  });
  describe("the escalation step", () => {
    const ready = { hasTeam: true, hasStaffedRotation: true, firstTeamId: "team_1" };
    const reviewedKey = () =>
      `oncall-setup-policy-reviewed:${store.state.selectedOrganization.identifier}:team_1`;

    beforeEach(() => {
      resetOnCallPolicyReviewed();
      window.localStorage.clear();
    });

    it("is done when a team has a policy", () => {
      const wrapper = render({ ...ready, hasPolicy: true });
      expect(wrapper.find('[data-test="oncall-setup-step-policy"]').attributes("data-state")).toBe(
        "done",
      );
    });

    /// The title says enough, and the button names the screen it opens.
    it("reads Review escalation with no sub-line", () => {
      const wrapper = render(ready);
      expect(wrapper.find('[data-test="oncall-setup-cta-policy"]').text()).toBe(
        "Review escalation",
      );
      expect(wrapper.find('[data-test="oncall-setup-body-policy"]').exists()).toBe(false);
    });

    /// Reviewing is the step; a returning reader must find it ticked.
    it("is done once reviewed, and stays done on the next mount", async () => {
      const wrapper = render(ready);
      await wrapper.find('[data-test="oncall-setup-cta-policy"]').trigger("click");

      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ params: { teamId: "team_1", tab: "escalation" } }),
      );
      expect(window.localStorage.getItem(reviewedKey())).toBe("1");

      resetOnCallPolicyReviewed();
      const again = render(ready);
      expect(again.find('[data-test="oncall-setup-step-policy"]').attributes("data-state")).toBe(
        "done",
      );
      expect(again.find('[data-test="oncall-setup-progress"]').text()).toContain("3 of 5");
    });

    it("can be marked done without leaving the page, then Change opens escalation", async () => {
      const wrapper = render(ready);
      await wrapper.find('[data-test="oncall-setup-mark-done-policy"]').trigger("click");

      expect(push).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(reviewedKey())).toBe("1");
      expect(wrapper.find('[data-test="oncall-setup-step-policy"]').attributes("data-state")).toBe(
        "done",
      );
      expect(wrapper.find('[data-test="oncall-setup-mark-done-policy"]').exists()).toBe(false);

      await wrapper.find('[data-test="oncall-setup-change-policy"]').trigger("click");
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ params: { teamId: "team_1", tab: "escalation" } }),
      );
      expect(window.localStorage.getItem(reviewedKey())).toBe("1");
    });

    /// Only this step is the reader's call; the others are facts the server holds.
    it("offers Mark as done on no other step", () => {
      const wrapper = render();
      expect(
        wrapper
          .findAll('[data-test^="oncall-setup-mark-done-"]')
          .map((b) => b.attributes("data-test")),
      ).toEqual(["oncall-setup-mark-done-policy"]);
    });

    /// Reviewing one team says nothing about another.
    it("keeps the review per team", () => {
      window.localStorage.setItem(reviewedKey(), "1");
      const wrapper = render({ ...ready, firstTeamId: "team_2" });
      expect(
        wrapper.find('[data-test="oncall-setup-step-policy"]').attributes("data-state"),
      ).not.toBe("done");
    });

    /// No read answered: the step is neither next nor counted.
    it("is left out while the policy is unknown", () => {
      const wrapper = render({ ...ready, hasPolicy: null });

      expect(wrapper.find('[data-test="oncall-setup-step-policy"]').exists()).toBe(false);
      expect(states(wrapper)).toEqual(["done", "done", "active", "todo"]);
      expect(wrapper.find('[data-test="oncall-setup-progress"]').text()).toContain("2 of 4");
      expect(wrapper.find('[data-test="oncall-setup-step-routing"]').attributes("data-state")).toBe(
        "active",
      );
    });

    it("shows as done when unknown but reviewed", () => {
      window.localStorage.setItem(reviewedKey(), "1");
      resetOnCallPolicyReviewed();
      const wrapper = render({ ...ready, hasPolicy: null });
      expect(wrapper.find('[data-test="oncall-setup-step-policy"]').attributes("data-state")).toBe(
        "done",
      );
    });
  });

  describe("hiding the compact bar", () => {
    beforeEach(() => {
      resetOnCallSetupDismissed();
      window.localStorage.clear();
    });

    it("offers no close button unless the page asks for one", () => {
      const wrapper = render({ compact: true });
      expect(wrapper.find('[data-test="oncall-setup-dismiss"]').exists()).toBe(false);
    });

    it("hides for this person and org once closed", async () => {
      const wrapper = render({ compact: true, dismissible: true });
      await wrapper.find('[data-test="oncall-setup-dismiss"]').trigger("click");

      expect(wrapper.find('[data-test="oncall-setup-banner"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(false);
      const keys = Object.keys(window.localStorage);
      expect(keys.some((key) => key.startsWith("oncall-setup-dismissed:"))).toBe(true);
    });

    /// Closing the bar never removes the first-run checklist: with no page yet it is the whole screen.
    it("still shows the full checklist when it is the screen", () => {
      window.localStorage.setItem(
        `oncall-setup-dismissed:${store.state.selectedOrganization.identifier}:${String(store.state.userInfo.email).toLowerCase()}`,
        "1",
      );
      const wrapper = render({ dismissible: true });
      expect(wrapper.find('[data-test="oncall-setup-checklist"]').exists()).toBe(true);
    });
  });
});
