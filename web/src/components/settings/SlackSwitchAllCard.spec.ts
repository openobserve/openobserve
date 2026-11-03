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
import destinationService from "@/services/alert_destination";
import oncallService from "@/services/oncall";
import { installationView, makeSlackStore, ok } from "@/test/unit/helpers/slack";
import SlackSwitchAllCard from "./SlackSwitchAllCard.vue";

vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(), update: vi.fn() },
}));
vi.mock("@/services/oncall", () => ({
  default: { listTeams: vi.fn(), getTeamChannel: vi.fn() },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const HOOK = "https://hooks.slack.com/services/T0SAMPLE01/B000/xyz";
const hook = (name: string, team = "T0SAMPLE01", channel = "C1") => ({
  name,
  type: "http",
  url: HOOK,
  method: "post",
  template: "prebuilt_slack",
  metadata: { prebuilt_type: "slack", slack_team_id: team, slack_channel_id: channel },
});

const mountCard = async () => {
  const w = mount(SlackSwitchAllCard, {
    props: { installation: installationView() },
    global: { plugins: [i18n, makeSlackStore()] },
  });
  await flushPromises();
  return w;
};

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  vi.mocked(destinationService.update).mockReturnValue(ok({}) as any);
  vi.mocked(oncallService.listTeams).mockReturnValue(ok([]) as any);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Settings › Slack switch-all card (MK-6b)", () => {
  it("counts and names the webhook destinations that post to this workspace", async () => {
    vi.mocked(destinationService.list).mockReturnValue(
      ok([hook("payments-slack"), hook("search-slack"), hook("labs-slack", "T0LABS")]) as any,
    );
    const w = await mountCard();
    const card = w.find('[data-test="slack-switch-all"]');
    expect(card.text()).toContain("2 webhook destinations post to this workspace.");
    expect(card.text()).toContain("Switch them to the Slack app");
    expect(card.text()).toContain("payments-slack · search-slack");
    expect(card.text()).not.toContain("labs-slack");
  });

  it("leaves out a webhook an on-call team pages through, so its pages keep working", async () => {
    vi.mocked(destinationService.list).mockReturnValue(
      ok([hook("payments-slack"), hook("payments-oncall-slack", "T0SAMPLE01", "C7")]) as any,
    );
    vi.mocked(oncallService.listTeams).mockReturnValue(ok([{ id: "t1", name: "payments" }]) as any);
    vi.mocked(oncallService.getTeamChannel).mockReturnValue(
      ok({ team_id: "t1", destinations: ["payments-oncall-slack"], source: "team" }) as any,
    );
    const w = await mountCard();
    const card = w.find('[data-test="slack-switch-all"]');
    expect(card.text()).toContain("1 webhook destination posts to this workspace.");
    expect(card.text()).toContain("Switch it to the Slack app");
    expect(card.text()).toContain("Its name, template and alerts stay the same");
    expect(card.text()).not.toContain("Switch them");
    expect(card.text()).not.toContain("payments-oncall-slack");
  });

  it("is hidden while no webhook destination posts to this workspace", async () => {
    vi.mocked(destinationService.list).mockReturnValue(ok([hook("labs-slack", "T0LABS")]) as any);
    const w = await mountCard();
    expect(w.find('[data-test="slack-switch-all"]').exists()).toBe(false);
  });

  it("Switch all edits each destination in place onto this installation", async () => {
    vi.mocked(destinationService.list).mockReturnValue(
      ok([hook("payments-slack"), hook("search-slack", "T0SAMPLE01", "C2")]) as any,
    );
    const w = await mountCard();
    await w.find('[data-test="slack-switch-all-action"]').trigger("click");
    await flushPromises();
    const calls = vi.mocked(destinationService.update).mock.calls.map((c) => c[0]);
    expect(calls.map((c: any) => c.destination_name)).toEqual(["payments-slack", "search-slack"]);
    expect(calls[1]).toMatchObject({
      data: { type: "slack_app", installation_id: "inst-1", channel_id: "C2" },
    });
  });
});
