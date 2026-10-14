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
import SlackChannelDefaults from "./SlackChannelDefaults.vue";
import { ConfirmDialogStub, OTableStub, makeSlackStore, ok } from "@/test/unit/helpers/slack";
import type { SlackChannelDefaultRow } from "@/types/slack";

vi.mock("@/services/slack", () => ({
  default: {
    listChannelDefaults: vi.fn(),
    putChannelDefault: vi.fn(),
    deleteChannelDefault: vi.fn(),
    listChannels: vi.fn(),
  },
}));

const rows: SlackChannelDefaultRow[] = [
  {
    channel_id: "C1",
    channel_name: "sre-prod",
    answer_mode: "thread",
    set_from: "destination",
    set_by_this_org: true,
  },
  {
    channel_id: "C2",
    channel_name: "staging-alerts",
    answer_mode: "private",
    set_from: "settings",
    set_by_this_org: false,
  },
];

const body = () => new DOMWrapper(document.body);

const mountDefaults = async (list = rows) => {
  vi.mocked(slack.listChannelDefaults).mockReturnValue(ok({ defaults: list }) as any);
  const w = mount(SlackChannelDefaults, {
    props: { installationId: "inst-1" },
    attachTo: document.body,
    global: {
      plugins: [i18n, makeSlackStore()],
      stubs: { OTable: OTableStub, ConfirmDialog: ConfirmDialogStub },
    },
  });
  await flushPromises();
  return w;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(slack.putChannelDefault).mockReturnValue(ok(rows[0]) as any);
  vi.mocked(slack.deleteChannelDefault).mockReturnValue(ok(undefined) as any);
  vi.mocked(slack.listChannels).mockReturnValue(
    ok({
      channels: [
        { id: "C3", name: "payments-oncall", is_private: false, is_member: true, is_shared: false },
      ],
      next_cursor: null,
    }) as any,
  );
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SlackChannelDefaults (rows 21-22)", () => {
  it("lists each channel with its answer mode, who set it and a dash for Phase 2 alert routes", async () => {
    const w = await mountDefaults();
    expect(slack.listChannelDefaults).toHaveBeenCalledWith("acme", "inst-1");
    const [mine, theirs] = w.findAll('[data-test-stub="otable-row"]');
    expect(mine.text()).toContain("#sre-prod");
    expect(mine.text()).toContain("In thread");
    expect(mine.text()).toContain("This org");
    expect(mine.text()).toContain("From an alert destination");
    expect(mine.find('[data-col="alert_routes"]').text()).toBe("—");
    expect(theirs.text()).toContain("Private only");
    expect(theirs.text()).toContain("Another org");
  });

  it("AC-5.5 offers Edit and Remove only on rows this org set", async () => {
    const w = await mountDefaults();
    expect(w.find('[data-test="slack-channel-edit-C1"]').exists()).toBe(true);
    expect(w.find('[data-test="slack-channel-remove-C1"]').exists()).toBe(true);
    expect(w.find('[data-test="slack-channel-edit-C2"]').exists()).toBe(false);
    expect(w.find('[data-test="slack-channel-remove-C2"]').exists()).toBe(false);
  });

  it("removes a default after a confirm (row 22 DELETE)", async () => {
    const w = await mountDefaults();
    await w.find('[data-test="slack-channel-remove-C1"]').trigger("click");
    expect(w.find('[data-test-stub="confirm-title"]').text()).toContain("#sre-prod");
    await w.find('[data-test-stub="confirm-ok"]').trigger("click");
    await flushPromises();
    expect(slack.deleteChannelDefault).toHaveBeenCalledWith("acme", "inst-1", "C1");
  });

  it("edits a default in the drawer and saves it for this org (row 22 PUT)", async () => {
    const w = await mountDefaults();
    await w.find('[data-test="slack-channel-edit-C1"]').trigger("click");
    await flushPromises();
    await body().find('[data-test="slack-channel-answer-private"]').trigger("click");
    await body().find("form").trigger("submit");
    await vi.waitFor(() =>
      expect(slack.putChannelDefault).toHaveBeenCalledWith("acme", "inst-1", "C1", {
        org_id: "acme",
        answer_mode: "private",
      }),
    );
  });

  it("asks for a channel before setting a new default", async () => {
    const w = await mountDefaults();
    await w.find('[data-test="slack-channel-set-default"]').trigger("click");
    await flushPromises();
    expect(slack.listChannels).toHaveBeenCalledWith("acme", "inst-1", { q: "", cursor: "" });
    await body().find("form").trigger("submit");
    await vi.waitFor(() => expect(body().text()).toContain("Pick a channel"));
    expect(slack.putChannelDefault).not.toHaveBeenCalled();
  });

  it("explains an empty list", async () => {
    const w = await mountDefaults([]);
    expect(w.text()).toContain("No channel has a default org yet");
  });
});
