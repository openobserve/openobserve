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
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import slack from "@/services/slack";
import { makeSlackStore, ok } from "@/test/unit/helpers/slack";
import type { SlackMyLink } from "@/types/slack";
import LinkedAccountsDialog from "./LinkedAccountsDialog.vue";

vi.mock("@/services/slack", () => ({ default: { getMyLinks: vi.fn(), deleteLink: vi.fn() } }));

const myLink = (over: Partial<SlackMyLink> = {}): SlackMyLink => ({
  id: "link-1",
  team_name: "Acme Corp",
  slack_display_name: "alice",
  default_org_id: "prod",
  link_method: "oidc",
  created_at: 1_760_000_000_000_000,
  last_used_at: 1_760_000_500_000_000,
  ...over,
});

const body = () => new DOMWrapper(document.body);
const testId = (id: string) => `[data-test="${id}"]`;

const mountDialog = (open = true) =>
  mount(LinkedAccountsDialog, {
    props: { open },
    attachTo: document.body,
    global: { plugins: [i18n, makeSlackStore()] },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(slack.deleteLink).mockReturnValue(ok(undefined) as any);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("LinkedAccountsDialog (L3)", () => {
  it("AC-12.3 lists each link with team, Slack name, default org and method", async () => {
    vi.mocked(slack.getMyLinks).mockReturnValue(
      ok({
        links: [
          myLink(),
          myLink({
            id: "link-2",
            team_name: "Beta Inc",
            slack_display_name: "al",
            link_method: "email",
          }),
        ],
      }) as any,
    );
    mountDialog();
    await flushPromises();

    expect(slack.getMyLinks).toHaveBeenCalledWith("acme");
    const first = body().find(testId("linked-accounts-item-link-1"));
    expect(first.text()).toContain("Slack · Acme Corp");
    expect(first.text()).toContain("@alice · org prod · Sign in with Slack");
    expect(first.text()).toContain("Last used");
    expect(body().find(testId("linked-accounts-item-link-2")).text()).toContain(
      "@al · org prod · Email match",
    );
    expect(body().text()).toContain("To link another workspace, mention @OpenObserve there");
  });

  it("AC-12.3 Unlink deletes that link and refetches the list", async () => {
    vi.mocked(slack.getMyLinks)
      .mockReturnValueOnce(ok({ links: [myLink()] }) as any)
      .mockReturnValue(ok({ links: [] }) as any);
    mountDialog();
    await flushPromises();

    await body().find(testId("linked-accounts-unlink-link-1")).trigger("click");
    await flushPromises();

    expect(slack.deleteLink).toHaveBeenCalledWith("acme", "link-1");
    expect(slack.getMyLinks).toHaveBeenCalledTimes(2);
    expect(body().find(testId("linked-accounts-item-link-1")).exists()).toBe(false);
    expect(body().find(testId("linked-accounts-empty")).exists()).toBe(true);
  });

  it("AC-12.3 shows the empty state when nothing is linked", async () => {
    vi.mocked(slack.getMyLinks).mockReturnValue(ok({ links: [] }) as any);
    mountDialog();
    await flushPromises();
    const empty = body().find(testId("linked-accounts-empty"));
    expect(empty.text()).toContain("No linked accounts");
    expect(empty.text()).toContain("Mention @OpenObserve in Slack");
    expect(body().find(testId("linked-accounts-note")).exists()).toBe(false);
  });

  it("shows a load error with Retry", async () => {
    vi.mocked(slack.getMyLinks)
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockReturnValue(ok({ links: [myLink()] }) as any);
    mountDialog();
    await flushPromises();
    const error = body().find(testId("linked-accounts-error"));
    expect(error.text()).toContain("Couldn't load your linked accounts");

    await error.find("button").trigger("click");
    await flushPromises();
    expect(body().find(testId("linked-accounts-item-link-1")).exists()).toBe(true);
  });

  it("does not fetch while closed", async () => {
    vi.mocked(slack.getMyLinks).mockReturnValue(ok({ links: [] }) as any);
    mountDialog(false);
    await flushPromises();
    expect(slack.getMyLinks).not.toHaveBeenCalled();
  });
});
