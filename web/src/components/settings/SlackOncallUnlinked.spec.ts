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
import { axiosReply } from "@/test/unit/helpers/mockService";

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
    expect(section.text()).toContain("On-call people not linked to Slack");
    expect(section.text()).not.toContain("Until they link");
    expect(w.find('[data-test="slack-oncall-unlinked-count"]').text()).toBe("2 people");
    expect(section.text()).toContain("kim@acme.io");
    expect(section.text()).toContain("Payments");
    expect(w.find('[data-test="slack-oncall-unlinked-reminder-kim@acme.io"]').text()).toBe(
      "Oct 17, 2025",
    );
    expect(w.find('[data-test="slack-oncall-unlinked-reminder-sam@acme.io"]').text()).toBe(
      "Not sent",
    );
  });

  it("shows one row per person with every team as a chip, on call now first", async () => {
    const nowUs = Date.now() * 1000;
    vi.mocked(slack.listOncallUnlinked).mockResolvedValue(
      axiosReply({
        members: [
          {
            email: "bob@acme.io",
            team_id: "t1",
            team_name: "Payments",
            next_shift_at: nowUs + 3_600_000_000,
            reminded_at: null,
          },
          {
            email: "bob@acme.io",
            team_id: "t2",
            team_name: "Search",
            next_shift_at: nowUs + 7_200_000_000,
            reminded_at: nowUs - 120_000_000,
          },
          {
            email: "zed@acme.io",
            team_id: "t1",
            team_name: "Payments",
            next_shift_at: nowUs - 60_000_000,
            reminded_at: null,
          },
          {
            email: "amy@acme.io",
            team_id: "t3",
            team_name: "Infra",
            next_shift_at: null,
            reminded_at: null,
          },
        ],
      }),
    );
    const w = await mountList();
    const people = w
      .findAll('[data-test^="slack-oncall-unlinked-person-"]')
      .map((cell) => cell.text());
    expect(people).toEqual(["zed@acme.io", "bob@acme.io", "amy@acme.io"]);
    expect(w.find('[data-test="slack-oncall-unlinked-count"]').text()).toBe("3 people");
    expect(w.find('[data-test="slack-oncall-unlinked-now-zed@acme.io"]').text()).toBe(
      "On call now",
    );
    expect(w.find('[data-test="slack-oncall-unlinked-now-bob@acme.io"]').exists()).toBe(false);
    const bobRow = w
      .find('[data-test="slack-oncall-unlinked-person-bob@acme.io"]')
      .element.closest("tr")!;
    expect(
      [...bobRow.querySelectorAll('[data-test="slack-oncall-unlinked-team"]')].map((c) =>
        c.textContent?.trim(),
      ),
    ).toEqual(["Payments", "Search"]);
    expect(w.find('[data-test="slack-oncall-unlinked-reminder-bob@acme.io"]').text()).toContain(
      "ago",
    );
    expect(w.find('[data-test="slack-oncall-unlinked-reminder-amy@acme.io"]').text()).toBe(
      "Not sent",
    );
  });

  /// Being on call is not an error, so the chip says it in the calm "on call" tone the rest of On-Call uses.
  it("marks on call now in the success tone, never as an error", async () => {
    vi.mocked(slack.listOncallUnlinked).mockResolvedValue(
      axiosReply({
        members: [
          {
            email: "zed@acme.io",
            team_id: "t1",
            team_name: "Payments",
            next_shift_at: Date.now() * 1000 - 60_000_000,
            reminded_at: null,
          },
        ],
      }),
    );
    const w = await mountList();
    const chip = w.find('[data-test="slack-oncall-unlinked-now-zed@acme.io"]');
    expect(chip.classes().join(" ")).not.toMatch(/error/);
    expect(
      w.findComponent('[data-test="slack-oncall-unlinked-now-zed@acme.io"]').props("variant"),
    ).toBe("success-soft");
  });

  /// One row of chips per person: the ones that fit, then "+N" naming them all.
  it("keeps every team on one line with a tooltip naming them all", async () => {
    vi.mocked(slack.listOncallUnlinked).mockResolvedValue(
      axiosReply({
        members: ["Payments", "Search", "Infra"].map((team, i) => ({
          email: "bob@acme.io",
          team_id: `t${i}`,
          team_name: team,
          next_shift_at: null,
          reminded_at: null,
        })),
      }),
    );
    const w = await mountList();
    const chips = w.findComponent({ name: "OnCallFitChips" });
    expect(chips.exists()).toBe(true);
    expect(chips.props("tooltip")).toBe("Payments, Search, Infra");
  });

  /// A long list pages inside the card rather than running the settings page long.
  it("pages a long list ten people at a time", async () => {
    vi.mocked(slack.listOncallUnlinked).mockResolvedValue(
      axiosReply({
        members: Array.from({ length: 12 }, (_, i) => ({
          email: `p${String(i).padStart(2, "0")}@acme.io`,
          team_id: "t1",
          team_name: "Payments",
          next_shift_at: null,
          reminded_at: null,
        })),
      }),
    );
    const w = await mountList();
    const table = w.findComponent({ name: "OTable" });
    expect(table.props("pagination")).toBe("client");
    expect(table.props("pageSize")).toBe(10);
    expect(w.findAll('[data-test^="slack-oncall-unlinked-person-"]')).toHaveLength(10);
  });

  it("shows no pager while the list fits one page", async () => {
    const w = await mountList();
    expect(w.findComponent({ name: "OTable" }).props("pagination")).toBe("none");
  });

  it("Remind by DM is a labelled icon button that sends the DMs again", async () => {
    const w = await mountList();
    const remind = w.find('[data-test="slack-oncall-unlinked-remind"]');
    expect(remind.text()).toBe("Remind by DM");
    expect(remind.find("svg").exists()).toBe(true);
    await remind.trigger("click");
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
