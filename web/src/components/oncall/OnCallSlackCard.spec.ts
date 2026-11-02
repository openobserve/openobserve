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

import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import slack from "@/services/slack";
import { axiosError, makeSlackStore, ok } from "@/test/unit/helpers/slack";
import type { SlackMyLink } from "@/types/slack";
import OnCallSlackCard from "./OnCallSlackCard.vue";

vi.mock("@/services/slack", () => ({ default: { getMyLinks: vi.fn() } }));

const myLink = (over: Partial<SlackMyLink> = {}): SlackMyLink => ({
  id: "link-1",
  team_name: "Acme Corp",
  slack_display_name: "ana",
  default_org_id: "acme",
  link_method: "oidc",
  created_at: 1_760_000_000_000_000,
  last_used_at: 1_760_000_500_000_000,
  ...over,
});

const render = () => mount(OnCallSlackCard, { global: { plugins: [i18n, makeSlackStore()] } });

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

describe("OnCallSlackCard (LN-1)", () => {
  it("LN-1 names the reader's email and the workspace of their link", async () => {
    vi.mocked(slack.getMyLinks).mockReturnValue(
      ok({ links: [myLink()], slack_serves_org: true }) as any,
    );
    const w = render();
    await flushPromises();

    expect(slack.getMyLinks).toHaveBeenCalledWith("acme");
    expect(w.find('[data-test="oncall-slack-linked-link-1"]').text()).toBe(
      "Linked as ana@acme.example in Acme Corp",
    );
  });

  it("LN-1 gives each link its own line", async () => {
    vi.mocked(slack.getMyLinks).mockReturnValue(
      ok({
        links: [myLink(), myLink({ id: "link-2", team_name: "Beta Inc" })],
        slack_serves_org: true,
      }) as any,
    );
    const w = render();
    await flushPromises();

    expect(w.find('[data-test="oncall-slack-linked-link-1"]').text()).toContain("Acme Corp");
    expect(w.find('[data-test="oncall-slack-linked-link-2"]').text()).toBe(
      "Linked as ana@acme.example in Beta Inc",
    );
  });

  it("SA-8 says Slack is not set up when no workspace serves the org", async () => {
    vi.mocked(slack.getMyLinks).mockReturnValue(ok({ links: [], slack_serves_org: false }) as any);
    const w = render();
    await flushPromises();

    expect(w.find('[data-test="oncall-slack-not-set-up"]').text()).toBe(
      "Slack is not set up. An admin sets it up in Settings › Slack.",
    );
    expect(w.find('[data-test="oncall-slack-not-linked"]').exists()).toBe(false);
  });

  it("LN-1 tells an unlinked reader how to link, with no link button", async () => {
    vi.mocked(slack.getMyLinks).mockReturnValue(ok({ links: [], slack_serves_org: true }) as any);
    const w = render();
    await flushPromises();

    expect(w.find('[data-test="oncall-slack-not-linked"]').text()).toBe(
      "Not linked. Type /o2 link in Slack.",
    );
    expect(w.find("button").exists()).toBe(false);
  });

  /// A failed read is not "Not linked": that would send a linked person to link again.
  it("says the link could not be read when the request fails", async () => {
    vi.mocked(slack.getMyLinks).mockReturnValue(Promise.reject(axiosError(403)) as any);
    const w = render();
    await flushPromises();

    expect(w.find('[data-test="oncall-slack-not-linked"]').exists()).toBe(false);
    expect(w.find('[data-test="oncall-slack-load-failed"]').text()).toBe(
      "Could not read your Slack link. Refresh to try again.",
    );
  });
});
