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
import {
  ConfirmDialogStub,
  OTableStub,
  axiosError,
  makeSlackStore,
  ok,
} from "@/test/unit/helpers/slack";
import type { SlackAdminLink } from "@/types/slack";

vi.mock("@/services/slack", () => ({ default: { listLinks: vi.fn(), deleteLink: vi.fn() } }));

// The admin list row (ENT `links::AdminLinkView`): no other org's id, team or enterprise.
const link = (over: Partial<SlackAdminLink> = {}): SlackAdminLink => ({
  id: "link-1",
  slack_user_id: "U0SAMPLE01",
  user_email: "dana@acme.example",
  link_method: "oidc",
  created_at: 1_760_000_000_000_000,
  last_used_at: 1_760_000_500_000_000,
  default_org_is_this_org: true,
  ...over,
});

const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "title"],
  template: '<div v-if="open" data-test-stub="drawer"><slot /></div>',
};

const mountPeople = (realTable = false) =>
  mount(SlackLinkedPeople, {
    props: { open: true, installationId: "inst-1" },
    global: {
      plugins: [i18n, makeSlackStore()],
      stubs: realTable
        ? { ODrawer: ODrawerStub, ConfirmDialog: ConfirmDialogStub }
        : { OTable: OTableStub, ODrawer: ODrawerStub, ConfirmDialog: ConfirmDialogStub },
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
    expect(rows[0].find('[data-col="slack_user_id"]').text()).toBe("U0SAMPLE01");
    expect(rows[0].text()).toContain("Sign in with Slack");
    expect(rows[1].text()).toContain("Link all");
    expect(w.find('[data-test="slack-people-more"]').exists()).toBe(false);
  });

  it("EC-B2 says whether each person's questions run in this org by default", async () => {
    vi.mocked(slack.listLinks).mockReturnValue(
      ok({
        links: [link(), link({ id: "link-2", default_org_is_this_org: false })],
        next_cursor: null,
      }) as any,
    );
    const w = mountPeople();
    await flushPromises();
    const cells = w.findAll('[data-col="default_org"]').map((c) => c.text());
    expect(cells).toEqual(["This org", "Another org"]);
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

  it("W-S7 shows no empty state while the links load", async () => {
    vi.mocked(slack.listLinks).mockReturnValue(new Promise(() => undefined) as any);
    const w = mountPeople();
    await flushPromises();
    expect(w.find('[data-test-stub="otable-loading"]').exists()).toBe(true);
    expect(w.text()).not.toContain("Nobody in this org has linked Slack yet");
  });

  it("W-S6 a failed load shows a retryable error instead of the empty state (real OTable)", async () => {
    vi.mocked(slack.listLinks).mockReturnValue(Promise.reject(axiosError(500)) as any);
    const w = mountPeople(true);
    await flushPromises();
    // OTable holds its skeleton for 50 ms before any end state.
    await vi.waitFor(() => expect(w.find('[data-test="slack-people-error"]').exists()).toBe(true));
    const error = w.find('[data-test="slack-people-error"]');
    expect(w.text()).not.toContain("Nobody in this org has linked Slack yet");

    vi.mocked(slack.listLinks).mockReturnValue(ok({ links: [link()], next_cursor: null }) as any);
    await error.find("button").trigger("click");
    await flushPromises();
    expect(slack.listLinks).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(w.find('[data-test="slack-people-error"]').exists()).toBe(false));
  });

  it("W-S6 a 403 shows no access instead of the empty state (real OTable)", async () => {
    vi.mocked(slack.listLinks).mockReturnValue(Promise.reject(axiosError(403)) as any);
    const w = mountPeople(true);
    await flushPromises();
    await vi.waitFor(() => expect(w.find('[data-test="o2-table-forbidden"]').exists()).toBe(true));
    expect(w.text()).not.toContain("Nobody in this org has linked Slack yet");
  });
});
