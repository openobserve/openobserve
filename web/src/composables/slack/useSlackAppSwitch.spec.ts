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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useSlackAppSwitch } from "./useSlackAppSwitch";

const mocks = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn(), push: vi.fn() }));
vi.mock("@tanstack/vue-query", () => ({
  useMutation: () => ({ mutateAsync: mocks.save }),
  useQuery: vi.fn(),
}));
vi.mock("@/composables/query/useOrgId", () => ({ useOrgId: () => ref("org-test") }));
vi.mock("@/services/alert_destination.queries", () => ({ saveDestinationMutation: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mocks.toast }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/types/i18n", () => ({
  raw: (v: unknown) => v,
  useI18nTyped: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? { key, params, toString: () => `${key} ${JSON.stringify(params)}` } : key,
  }),
}));

const row = (name: string) => ({
  name,
  type: "http",
  url: "https://hooks.slack.com/services/T0000TEST/B0000TEST/secret",
  metadata: { slack_channel_id: "C0000TEST", slack_team_id: "T0000TEST" },
});
const refusal = (code: string, message?: string) => ({
  response: { data: { code, team: "Test team", destination: "oncall-test", message } },
});

beforeEach(() => vi.clearAllMocks());
describe("switch confirmation refusals", () => {
  it.each(["shared_channel_unconfirmed", "oncall_room_unconfirmed"])(
    "keeps %s and opens the prefilled form",
    async (code) => {
      mocks.save.mockRejectedValueOnce(refusal(code));
      const app = useSlackAppSwitch();
      expect(await app.switchOne(row("alerts-test"), "inst-test")).toBe(false);
      const notice = mocks.toast.mock.calls[0][0];
      expect(notice.message).not.toBe("slackApp.destination.saveFailed");
      expect(notice.action).toBeDefined();
      notice.action.handler();
      expect(mocks.push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "alertDestinations",
          query: expect.objectContaining({
            action: "update",
            name: "alerts-test",
            slack_app_installation: "inst-test",
            slack_app_refusal: code,
          }),
        }),
      );
    },
  );

  it("answers Switch all with one summary naming each failure and its reason", async () => {
    mocks.save
      .mockRejectedValueOnce(refusal("shared_channel_unconfirmed"))
      .mockRejectedValueOnce(refusal("oncall_room_unconfirmed"))
      .mockRejectedValueOnce(refusal("used_by_oncall", "Team A pages it; Team B too"))
      .mockResolvedValueOnce({});
    const app = useSlackAppSwitch();
    const rows = [row("shared-test"), row("oncall-test"), row("paged-test"), row("ok-test")];
    expect(await app.switchAll(rows, "inst-test")).toBe(1);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    const notice = mocks.toast.mock.calls[0][0];
    expect(notice.variant).toBe("warning");
    expect(notice.title).toMatchObject({
      key: "slackApp.switchAll.summary",
      params: { switched: 1, count: 3 },
    });
    const lines = String(notice.message).split("\n");
    expect(lines).toHaveLength(3);
    const expected = [
      ["shared-test", "sharedRequired"],
      ["oncall-test", "oncallRequired"],
      ["paged-test", "Team A pages it; Team B too"],
    ];
    expected.forEach(([name, reason], i) => {
      expect(lines[i]).toContain(name);
      expect(lines[i]).toContain(reason);
    });
    expect(String(notice.message)).not.toContain("ok-test");
    expect(notice.action).toBeUndefined();
    expect(app).not.toHaveProperty("results");
  });

  it("keeps Review on the summary when its one failure can be confirmed", async () => {
    mocks.save.mockRejectedValueOnce(refusal("oncall_room_unconfirmed")).mockResolvedValueOnce({});
    const app = useSlackAppSwitch();
    expect(await app.switchAll([row("oncall-test"), row("ok-test")], "inst-test")).toBe(1);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    const notice = mocks.toast.mock.calls[0][0];
    expect(notice.title.params).toEqual({ switched: 1, count: 1 });
    notice.action.handler();
    expect(mocks.push).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          name: "oncall-test",
          slack_app_installation: "inst-test",
          slack_app_refusal: "oncall_room_unconfirmed",
          slack_app_team: "Test team",
          slack_app_room: "oncall-test",
        }),
      }),
    );
  });

  it("says nothing failed when every Switch all row switched", async () => {
    mocks.save.mockResolvedValue({});
    const app = useSlackAppSwitch();
    expect(await app.switchAll([row("a-test"), row("b-test")], "inst-test")).toBe(2);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast.mock.calls[0][0].variant).toBe("success");
  });

  it.each([
    ["used_by_oncall", "slackApp.destination.oncallNotAllowed"],
    ["slack_unavailable", "slackApp.destination.unavailableReason"],
    ["version_mismatch", "slackApp.destination.versionMismatch"],
    ["slack_target", "slackApp.destination.saveFailed"],
  ])("keeps the %s code and says its own reason", async (code, reason) => {
    mocks.save.mockRejectedValueOnce(refusal(code));
    const app = useSlackAppSwitch();
    expect(await app.switchOne(row("alerts-test"), "inst-test")).toBe(false);
    const notice = mocks.toast.mock.calls[0][0];
    const said = notice.message.params.reason;
    expect(typeof said === "string" ? said : said.key).toBe(reason);
    expect(notice.action).toBeUndefined();
  });

  it("prefers the server's own words for a refusal that has them", async () => {
    mocks.save.mockRejectedValueOnce(refusal("used_by_oncall", "On-call team Test team pages"));
    const app = useSlackAppSwitch();
    await app.switchOne(row("alerts-test"), "inst-test");
    expect(mocks.toast.mock.calls[0][0].message.params.reason).toBe("On-call team Test team pages");
  });
});
