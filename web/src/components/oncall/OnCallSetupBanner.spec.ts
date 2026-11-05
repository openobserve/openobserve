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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OnCallSetupBanner from "@/components/oncall/OnCallSetupBanner.vue";
import { queryClient } from "@/composables/query/queryClient";
import { resetOnCallPolicyReviewed } from "@/composables/useOnCallPolicyReviewed";
import { resetOnCallSetupDismissed } from "@/composables/useOnCallSetupDismissed";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import { axiosReply } from "@/test/unit/helpers/mockService";

vi.mock("@/services/oncall", () => ({
  default: {
    listTeams: vi.fn(),
    coverageGaps: vi.fn(),
    listOwnershipRules: vi.fn(),
    listResponses: vi.fn(),
    getPolicy: vi.fn(),
    testPage: vi.fn(),
  },
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const service = vi.mocked(oncallService);

const stubs = {
  OBanner: { name: "OBanner", template: "<div><slot /><slot name='actions' /></div>" },
  OIcon: { name: "OIcon", props: ["name"], template: "<i />" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  ConfirmDialog: { name: "ConfirmDialog", template: "<div />" },
};

function answer({
  teams = [{ id: "team_1", name: "Checkout" }],
  gaps = 0,
  rules = [] as unknown[],
  pages = [] as unknown[],
} = {}) {
  service.listTeams.mockResolvedValue(axiosReply(teams));
  service.coverageGaps.mockResolvedValue(axiosReply({ total: gaps }));
  service.listOwnershipRules.mockResolvedValue(axiosReply(rules));
  service.listResponses.mockResolvedValue(axiosReply(pages));
  service.getPolicy.mockResolvedValue(axiosReply({ rungs: [] }));
}

async function render(attrs: Record<string, unknown> = {}) {
  const wrapper = mount(OnCallSetupBanner, {
    attrs,
    global: { plugins: [i18n, store], stubs },
  });
  await flushPromises();
  return wrapper;
}

describe("OnCallSetupBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    resetOnCallSetupDismissed();
    resetOnCallPolicyReviewed();
    window.localStorage.clear();
  });
  afterEach(() => window.localStorage.clear());

  it.each([
    "listTeams",
    "coverageGaps",
    "listOwnershipRules",
    "listResponses",
    "getPolicy",
  ] as const)("tells the page when the license refuses %s", async (read) => {
    answer();
    service[read].mockRejectedValueOnce({
      response: { status: 403, data: { code: 40001, error_detail: "oncall" } },
    });
    const wrapper = await render();

    expect(wrapper.emitted("licenseDenied")).toEqual([[["oncall"]]]);
  });

  it("does not report any other failed read as a denial", async () => {
    answer();
    service.listTeams.mockRejectedValueOnce({ response: { status: 403, data: {} } });
    const wrapper = await render();

    expect(wrapper.emitted("licenseDenied")).toBeUndefined();
  });

  /// Answered from its own reads, so the bar names the same next step the Pages checklist would.
  it("names the next undone step while setup is unfinished", async () => {
    answer();
    const wrapper = await render();

    expect(wrapper.find('[data-test="oncall-setup-banner"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-setup-next"]').text()).toBe(
      "Next: Send alerts to this team",
    );
  });

  it("says nothing once every step is done", async () => {
    answer({ rules: [{ rule_id: "r1" }] });
    const wrapper = await render();

    expect(wrapper.find('[data-test="oncall-setup-banner-host"]').exists()).toBe(false);
  });

  /// A page bound straight to a team is routing without a rule, as on Pages.
  it("counts a page that reached a team as routing", async () => {
    answer({ pages: [{ id: "p1", team_id: "team_1" }] });
    const wrapper = await render();

    expect(wrapper.find('[data-test="oncall-setup-banner-host"]').exists()).toBe(false);
  });

  /// One answering policy settles the step, so an org with many teams costs one policy read, not one per team.
  it("stops reading policies at the first team that has one", async () => {
    answer({
      teams: [
        { id: "team_1", name: "A" },
        { id: "team_2", name: "B" },
        { id: "team_3", name: "C" },
      ],
    });
    await render();
    expect(service.getPolicy).toHaveBeenCalledTimes(1);
  });

  /// A dismissed bar never shows, so it asks the server nothing.
  it("reads nothing once dismissed", async () => {
    answer();
    const wrapper = await render();
    await wrapper.find('[data-test="oncall-setup-dismiss"]').trigger("click");
    vi.clearAllMocks();
    queryClient.clear();
    await render();
    expect(service.listTeams).not.toHaveBeenCalled();
    expect(service.getPolicy).not.toHaveBeenCalled();
  });

  /// A read that failed is not a step left undone, so the bar stays away.
  it("stays away when a read fails", async () => {
    answer();
    service.listOwnershipRules.mockRejectedValue(new Error("down"));
    const wrapper = await render();

    expect(wrapper.find('[data-test="oncall-setup-banner-host"]').exists()).toBe(false);
  });

  it("hides for this person after the close button, and stays hidden on the next mount", async () => {
    answer();
    const wrapper = await render();

    await wrapper.find('[data-test="oncall-setup-dismiss"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-setup-banner-host"]').exists()).toBe(false);

    resetOnCallSetupDismissed();
    const again = await render();
    expect(again.find('[data-test="oncall-setup-banner-host"]').exists()).toBe(false);
  });

  /// The Teams page opens its own create form; elsewhere the button leads there.
  it("hands Create a team to the page when it listens, else opens Teams", async () => {
    answer({ teams: [] });
    const onCreateTeam = vi.fn();
    const handled = await render({ onCreateTeam });
    await handled.find('[data-test="oncall-setup-bar-cta-team"]').trigger("click");
    expect(onCreateTeam).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();

    const plain = await render();
    await plain.find('[data-test="oncall-setup-bar-cta-team"]').trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onCallTeams",
        query: expect.objectContaining({ action: "add" }),
      }),
    );
  });

  /// No policy read answered: the step is unknown, so it is not what the bar asks for next.
  it("skips the escalation step when no policy can be read", async () => {
    answer();
    service.coverageGaps.mockResolvedValue(axiosReply({ total: 1 }));
    service.getPolicy.mockRejectedValue(new Error("down"));
    const wrapper = await render();

    expect(wrapper.find('[data-test="oncall-setup-next"]').text()).toContain(
      "Add members and who's on first",
    );
    expect(wrapper.find('[data-test="oncall-setup-expand"]').text()).toContain("1 of 4");
  });

  /// Unknown is not owed: with every other step done the bar stays away.
  it("stays away when only the unknown escalation step is left", async () => {
    answer({ rules: [{ rule_id: "r1" }] });
    service.getPolicy.mockRejectedValue(new Error("down"));
    const wrapper = await render();

    expect(wrapper.find('[data-test="oncall-setup-banner-host"]').exists()).toBe(false);
  });

  /// Opening escalation from the expanded list ticks the step, and the bar moves on.
  it("moves past the escalation step once it is reviewed", async () => {
    answer();
    service.getPolicy.mockResolvedValue(axiosReply(null));
    const wrapper = await render();
    expect(wrapper.find('[data-test="oncall-setup-next"]').text()).toContain(
      "Check how they're woken",
    );

    await wrapper.find('[data-test="oncall-setup-bar-cta-policy"]').trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ params: { teamId: "team_1", tab: "escalation" } }),
    );
    expect(wrapper.find('[data-test="oncall-setup-next"]').text()).toBe(
      "Next: Send alerts to this team",
    );
  });
});
