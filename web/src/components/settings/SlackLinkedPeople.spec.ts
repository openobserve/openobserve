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
import slack from "@/services/slack";
import SlackLinkedPeople from "./SlackLinkedPeople.vue";
import { ConfirmDialogStub, OTableStub, makeSlackStore, ok } from "@/test/unit/helpers/slack";
import type { SlackLinkRow } from "@/types/slack";

vi.mock("@/services/slack", () => ({ default: { listLinks: vi.fn(), deleteLink: vi.fn() } }));

const link = (over: Partial<SlackLinkRow> = {}): SlackLinkRow => ({
  id: "link-1",
  provider: "slack",
  installation_id: "inst-1",
  external_enterprise_id: "",
  external_team_id: "T0SAMPLE01",
  external_user_id: "U0SAMPLE01",
  user_email: "dana@acme.example",
  default_org_id: "acme",
  link_method: "oidc",
  created_at: 1_760_000_000_000_000,
  last_used_at: 1_760_000_500_000_000,
  revoked_at: null,
  revoked_reason: null,
  ...over,
});

const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "title"],
  template: '<div v-if="open" data-test-stub="drawer"><slot /></div>',
};

const mountPeople = () =>
  mount(SlackLinkedPeople, {
    props: { open: true, installationId: "inst-1" },
    global: {
      plugins: [i18n, makeSlackStore()],
      stubs: { OTable: OTableStub, ODrawer: ODrawerStub, ConfirmDialog: ConfirmDialogStub },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(slack.deleteLink).mockReturnValue(ok(undefined) as any);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SlackLinkedPeople", () => {
  it("lists this org's links for the installation, with the link method", async () => {
    vi.mocked(slack.listLinks).mockReturnValue(
      ok({
        links: [
          link(),
          link({ id: "link-2", user_email: "li@acme.example", link_method: "admin_bulk" }),
        ],
        next_cursor: null,
      }) as any,
    );
    const w = mountPeople();
    await flushPromises();
    expect(slack.listLinks).toHaveBeenCalledWith("acme", { installation_id: "inst-1", cursor: "" });
    const rows = w.findAll('[data-test-stub="otable-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("dana@acme.example");
    expect(rows[0].text()).toContain("Sign in with Slack");
    expect(rows[1].text()).toContain("Link all");
    expect(w.find('[data-test="slack-people-more"]').exists()).toBe(false);
  });

  it("pages with Load more while the server returns a cursor", async () => {
    vi.mocked(slack.listLinks)
      .mockReturnValueOnce(ok({ links: [link()], next_cursor: "c2" }) as any)
      .mockReturnValueOnce(
        ok({
          links: [link({ id: "link-3", user_email: "ravi@acme.example" })],
          next_cursor: null,
        }) as any,
      );
    const w = mountPeople();
    await flushPromises();
    await w.find('[data-test="slack-people-more"]').trigger("click");
    await flushPromises();
    expect(slack.listLinks).toHaveBeenLastCalledWith("acme", {
      installation_id: "inst-1",
      cursor: "c2",
    });
    expect(w.findAll('[data-test-stub="otable-row"]')).toHaveLength(2);
  });

  it("unlinks a person after a confirm", async () => {
    vi.mocked(slack.listLinks).mockReturnValue(ok({ links: [link()], next_cursor: null }) as any);
    const w = mountPeople();
    await flushPromises();
    await w.find('[data-test="slack-people-unlink-link-1"]').trigger("click");
    expect(w.find('[data-test-stub="confirm-title"]').text()).toContain("dana@acme.example");
    await w.find('[data-test-stub="confirm-ok"]').trigger("click");
    await flushPromises();
    expect(slack.deleteLink).toHaveBeenCalledWith("acme", "link-1");
  });

  it("says so when nobody linked yet", async () => {
    vi.mocked(slack.listLinks).mockReturnValue(ok({ links: [], next_cursor: null }) as any);
    const w = mountPeople();
    await flushPromises();
    expect(w.text()).toContain("Nobody in this org has linked Slack yet");
  });
});
