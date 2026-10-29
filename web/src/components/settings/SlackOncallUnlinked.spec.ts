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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import slack from "@/services/slack";
import { axiosError, installationView, makeSlackStore, ok } from "@/test/unit/helpers/slack";
import SlackOncallUnlinked from "./SlackOncallUnlinked.vue";

vi.mock("@/services/slack", () => ({
  default: { listOncallUnlinked: vi.fn(), remindOncallUnlinked: vi.fn() },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const members = [
  {
    email: "kim@acme.io",
    team_id: "t1",
    team_name: "Payments",
    next_shift_at: 1_760_950_800_000_000,
    reminded_at: 1_760_713_200_000_000,
  },
  {
    email: "sam@acme.io",
    team_id: "t2",
    team_name: "Search",
    next_shift_at: 1_761_123_600_000_000,
    reminded_at: null,
  },
];

const mountList = async () => {
  const w = mount(SlackOncallUnlinked, {
    props: { installation: installationView() },
    global: { plugins: [i18n, makeSlackStore()] },
  });
  await flushPromises();
  return w;
};

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  vi.mocked(slack.listOncallUnlinked).mockReturnValue(ok({ members }) as any);
  vi.mocked(slack.remindOncallUnlinked).mockReturnValue(ok({ sent: 1 }) as any);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("on-call members not linked to Slack (Q7, MK-15's admin side)", () => {
  it("lists each person with their team, next shift and the pre-shift DM", async () => {
    const w = await mountList();
    expect(slack.listOncallUnlinked).toHaveBeenCalledWith("acme", "inst-1");
    const section = w.find('[data-test="slack-oncall-unlinked"]');
    expect(section.text()).toContain("On-call members not linked to Slack");
    expect(section.text()).toContain("kim@acme.io");
    expect(section.text()).toContain("Payments");
    expect(w.find('[data-test="slack-oncall-unlinked-reminder-kim@acme.io"]').text()).toContain(
      "DM sent",
    );
    expect(w.find('[data-test="slack-oncall-unlinked-reminder-sam@acme.io"]').text()).toBe(
      "Not sent",
    );
  });

  it("Remind them sends the DMs again", async () => {
    const w = await mountList();
    await w.find('[data-test="slack-oncall-unlinked-remind"]').trigger("click");
    await flushPromises();
    expect(slack.remindOncallUnlinked).toHaveBeenCalledWith("acme", "inst-1");
  });

  it("stays hidden when everyone is linked or the server has no list yet", async () => {
    vi.mocked(slack.listOncallUnlinked).mockReturnValue(ok({ members: [] }) as any);
    expect((await mountList()).find('[data-test="slack-oncall-unlinked"]').exists()).toBe(false);
    queryClient.clear();
    vi.mocked(slack.listOncallUnlinked).mockReturnValue(Promise.reject(axiosError(404)) as any);
    expect((await mountList()).find('[data-test="slack-oncall-unlinked"]').exists()).toBe(false);
  });
});
