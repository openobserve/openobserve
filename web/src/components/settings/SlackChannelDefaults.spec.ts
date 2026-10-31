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
import { createStore } from "vuex";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import slack from "@/services/slack";
import destinationService from "@/services/alert_destination";
import SlackChannelDefaults from "./SlackChannelDefaults.vue";
import {
  ConfirmDialogStub,
  OTableStub,
  axiosError,
  installationView,
  instanceView,
  makeSlackStore,
  managedView,
  ok,
  orgAccessView,
} from "@/test/unit/helpers/slack";
import type { InstallationView, SlackChannelDefaultRow } from "@/types/slack";

vi.mock("@/services/alert_destination", () => ({ default: { list: vi.fn() } }));

vi.mock("@/services/slack", () => ({
  default: {
    listChannelDefaults: vi.fn(),
    putChannelDefault: vi.fn(),
    deleteChannelDefault: vi.fn(),
    listChannels: vi.fn(),
    listInstallations: vi.fn(),
    getOrgAccess: vi.fn(),
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

const mountDefaults = async (list = rows, realTable = false) => {
  vi.mocked(slack.listChannelDefaults).mockReturnValue(ok({ defaults: list }) as any);
  return mountWith(realTable);
};

const metaStore = () =>
  createStore({
    state: {
      selectedOrganization: { identifier: "_meta", name: "_meta" },
      userInfo: { email: "root@acme.example" },
      zoConfig: { slack_enabled: true, meta_org: "_meta" },
    },
  });

/** Row 21 as `_meta` sees an instance workspace: each row names its owning org. */
const metaRows: SlackChannelDefaultRow[] = [
  { ...rows[0], org_id: "_meta", org_name: "_meta" },
  { ...rows[1], org_id: "staging", org_name: "Staging" },
];

const mountOn = async (
  installation: InstallationView,
  store = makeSlackStore(),
  list: SlackChannelDefaultRow[] = rows,
) => {
  queryClient.clear();
  vi.mocked(slack.listChannelDefaults).mockReturnValue(ok({ defaults: list }) as any);
  vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [installation] }) as any);
  const w = mount(SlackChannelDefaults, {
    props: { installationId: installation.id },
    attachTo: document.body,
    global: {
      plugins: [i18n, store],
      stubs: { OTable: OTableStub, ConfirmDialog: ConfirmDialogStub },
    },
  });
  await flushPromises();
  return w;
};

const mountWith = async (realTable = false) => {
  const w = mount(SlackChannelDefaults, {
    props: { installationId: "inst-1" },
    attachTo: document.body,
    global: {
      plugins: [i18n, makeSlackStore()],
      stubs: realTable
        ? { ConfirmDialog: ConfirmDialogStub }
        : { OTable: OTableStub, ConfirmDialog: ConfirmDialogStub },
    },
  });
  await flushPromises();
  return w;
};

const appDestination = (name: string, channel: string, installation = "inst-1") => ({
  name,
  type: "slack_app",
  installation_id: installation,
  channel_id: channel,
  channel_name: channel,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(destinationService.list).mockReturnValue(ok([]) as any);
  vi.mocked(slack.listInstallations).mockReturnValue(
    ok({ installations: [installationView()] }) as any,
  );
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
  it("lists each channel with its answer mode, who set it and a dash when no alert routes", async () => {
    const w = await mountDefaults();
    expect(slack.listChannelDefaults).toHaveBeenCalledWith("acme", "inst-1");
    const [mine, theirs] = w.findAll('[data-test-stub="otable-row"]');
    expect(mine.text()).toContain("#sre-prod");
    expect(mine.text()).toContain("In thread");
    expect(mine.find('[data-col="default_org"]').text()).toBe("This org");
    expect(mine.find('[data-col="set_by"]').text()).toBe("From an alert destination");
    expect(mine.find('[data-col="alert_routes"]').text()).toBe("—");
    expect(theirs.text()).toContain("Private only");
    expect(theirs.text()).toContain("Another org");
  });

  it("fills Alert routes with this workspace's Slack app destinations per channel (MK-6b)", async () => {
    vi.mocked(destinationService.list).mockReturnValue(
      ok([
        appDestination("a", "C1"),
        appDestination("b", "C1"),
        appDestination("c", "C1", "inst-2"),
        appDestination("d", "C2"),
      ]) as any,
    );
    const w = await mountDefaults();
    const [mine, theirs] = w.findAll('[data-test-stub="otable-row"]');
    expect(mine.find('[data-col="alert_routes"]').text()).toBe("2 destinations");
    expect(theirs.find('[data-col="alert_routes"]').text()).toBe("1 destination");
    expect(w.text()).not.toMatch(/failing/i);
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
    const confirmDialog = w.find('[data-test-stub="confirm-dialog"]');
    expect(confirmDialog.attributes("message-keypath")).toBe("slackApp.channels.removeMessage");
    expect(confirmDialog.attributes("message-name")).toBe("#sre-prod");
    expect(i18n.global.t("slackApp.channels.removeMessage", { name: "#sre-prod" })).toBe(
      "Questions in #sre-prod then go to each person's default org (they can change it with /o2 org).",
    );
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

  it("W-S13 shows the server's 403 in the drawer and keeps it open", async () => {
    vi.mocked(slack.putChannelDefault).mockReturnValue(
      Promise.reject(
        axiosError(403, "Only an admin of org prod can change this channel's default"),
      ) as any,
    );
    const w = await mountDefaults();
    await w.find('[data-test="slack-channel-edit-C1"]').trigger("click");
    await flushPromises();
    await body().find("form").trigger("submit");
    await vi.waitFor(() =>
      expect(body().find('[data-test="slack-channel-save-error"]').text()).toBe(
        "Only an admin of org prod can change this channel's default",
      ),
    );
    expect(body().find("form").exists()).toBe(true);
  });

  it("W-S13 disables channels whose default another org owns", async () => {
    vi.mocked(slack.listChannels).mockReturnValue(
      ok({
        channels: [
          {
            id: "C2",
            name: "staging-alerts",
            is_private: false,
            is_member: true,
            is_shared: false,
          },
          {
            id: "C3",
            name: "payments-oncall",
            is_private: false,
            is_member: true,
            is_shared: false,
          },
        ],
        next_cursor: null,
      }) as any,
    );
    const w = await mountDefaults();
    await w.find('[data-test="slack-channel-set-default"]').trigger("click");
    await flushPromises();
    const options = w.findComponent({ name: "OSelect" }).props("options") as {
      value: string;
      disabled?: boolean;
    }[];
    expect(options.find((o) => o.value === "C2")?.disabled).toBe(true);
    expect(options.find((o) => o.value === "C3")?.disabled).toBeFalsy();
  });

  it("W-S8 searches channels on the server as the admin types", async () => {
    const w = await mountDefaults();
    await w.find('[data-test="slack-channel-set-default"]').trigger("click");
    await flushPromises();
    const select = w.findComponent({ name: "OSelect" });
    expect(select.props("searchDebounce")).toBeGreaterThan(0);
    select.vm.$emit("search", "pay");
    await flushPromises();
    expect(slack.listChannels).toHaveBeenLastCalledWith("acme", "inst-1", { q: "pay", cursor: "" });
  });

  it("W-S8 loads the next page of channels on demand", async () => {
    vi.mocked(slack.listChannels)
      .mockReturnValueOnce(
        ok({
          channels: [
            {
              id: "C3",
              name: "payments-oncall",
              is_private: false,
              is_member: true,
              is_shared: false,
            },
          ],
          next_cursor: "c2",
        }) as any,
      )
      .mockReturnValueOnce(
        ok({
          channels: [
            { id: "C4", name: "zz-last", is_private: false, is_member: true, is_shared: false },
          ],
          next_cursor: null,
        }) as any,
      );
    const w = await mountDefaults();
    await w.find('[data-test="slack-channel-set-default"]').trigger("click");
    await flushPromises();
    await body().find('[data-test="slack-channel-more"]').trigger("click");
    await flushPromises();
    expect(slack.listChannels).toHaveBeenLastCalledWith("acme", "inst-1", { q: "", cursor: "c2" });
    const values = (
      w.findComponent({ name: "OSelect" }).props("options") as { value: string }[]
    ).map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(["C3", "C4"]));
    expect(body().find('[data-test="slack-channel-more"]').exists()).toBe(false);
  });

  it("asks for a channel before setting a new default", async () => {
    const w = await mountDefaults();
    await w.find('[data-test="slack-channel-set-default"]').trigger("click");
    await flushPromises();
    expect(slack.listChannels).toHaveBeenCalledWith("acme", "inst-1", { q: "", cursor: "" });
    expect(body().text()).toContain("can take up to 10 minutes");
    await body().find("form").trigger("submit");
    await vi.waitFor(() => expect(body().text()).toContain("Pick a channel"));
    expect(slack.putChannelDefault).not.toHaveBeenCalled();
  });

  it("explains an empty list", async () => {
    const w = await mountDefaults([]);
    expect(w.text()).toContain("No channel has a default org yet");
    expect(w.text()).toContain("go to each person's default org");
  });

  it("W-S7 shows no empty state while the defaults load", async () => {
    vi.mocked(slack.listChannelDefaults).mockReturnValue(new Promise(() => undefined) as any);
    const w = await mountWith();
    expect(w.find('[data-test-stub="otable-loading"]').exists()).toBe(true);
    expect(w.text()).not.toContain("No channel has a default org yet");
  });

  it("W-S6 a failed load shows a retryable error instead of the empty state (real OTable)", async () => {
    vi.mocked(slack.listChannelDefaults).mockReturnValue(Promise.reject(axiosError(500)) as any);
    const w = await mountWith(true);
    // OTable holds its skeleton for 50 ms before any end state.
    await vi.waitFor(() =>
      expect(w.find('[data-test="slack-channel-defaults-error"]').exists()).toBe(true),
    );
    const error = w.find('[data-test="slack-channel-defaults-error"]');
    expect(w.text()).not.toContain("No channel has a default org yet");

    vi.mocked(slack.listChannelDefaults).mockReturnValue(ok({ defaults: rows }) as any);
    await error.find("button").trigger("click");
    await flushPromises();
    expect(slack.listChannelDefaults).toHaveBeenCalledTimes(2);
    await vi.waitFor(() =>
      expect(w.find('[data-test="slack-channel-defaults-error"]').exists()).toBe(false),
    );
  });

  it("W-S6 a 403 shows no access instead of the empty state (real OTable)", async () => {
    vi.mocked(slack.listChannelDefaults).mockReturnValue(Promise.reject(axiosError(403)) as any);
    const w = await mountWith(true);
    await vi.waitFor(() => expect(w.find('[data-test="o2-table-forbidden"]').exists()).toBe(true));
    expect(w.text()).not.toContain("No channel has a default org yet");
  });

  it("another org's channel reads Instance admin only with no Edit for an org admin", async () => {
    const w = await mountOn(managedView());
    const [mine, theirs] = w.findAll('[data-test-stub="otable-row"]');
    expect(theirs.find('[data-col="default_org"]').text()).toBe("Another org");
    expect(theirs.find('[data-test="slack-channel-instance-only"]').text()).toBe(
      "Instance admin only",
    );
    expect(w.find('[data-test="slack-channel-edit-C2"]').exists()).toBe(false);
    expect(w.find('[data-test="slack-channel-remove-C2"]').exists()).toBe(false);
    expect(mine.find('[data-test="slack-channel-instance-only"]').exists()).toBe(false);
    expect(w.find('[data-test="slack-channel-edit-C1"]').exists()).toBe(true);
    const orgWorkspace = await mountOn(installationView());
    expect(orgWorkspace.find('[data-test="slack-channel-instance-only"]').exists()).toBe(false);
  });

  it("the drawer offers only this org on an instance workspace", async () => {
    const w = await mountOn(managedView());
    await w.find('[data-test="slack-channel-set-default"]').trigger("click");
    await flushPromises();
    const org = body().find('[data-test="slack-channel-default-org"]');
    expect((org.find("input").element as HTMLInputElement).value).toBe("acme (this org)");
    expect(org.text()).toContain("On an instance workspace you map channels to your own org");
    expect(body().text()).toContain("Unclaimed channels and channels acme owns");
    await w.find('[data-test="slack-channel-edit-C1"]').trigger("click");
    await flushPromises();
    await body().find("form").trigger("submit");
    await vi.waitFor(() =>
      expect(slack.putChannelDefault).toHaveBeenCalledWith("acme", "inst-1", "C1", {
        org_id: "acme",
        answer_mode: "thread",
      }),
    );
    w.unmount();
    const orgWorkspace = await mountOn(installationView());
    await orgWorkspace.find('[data-test="slack-channel-set-default"]').trigger("click");
    await flushPromises();
    expect(body().find("form").exists()).toBe(true);
    expect(body().find('[data-test="slack-channel-default-org"]').exists()).toBe(false);
    expect(body().text()).not.toContain("On an instance workspace");
  });

  it("a _meta admin can edit any channel", async () => {
    const w = await mountOn(instanceView(), metaStore());
    expect(w.find('[data-test="slack-channel-instance-only"]').exists()).toBe(false);
    expect(w.find('[data-test="slack-channel-remove-C2"]').exists()).toBe(true);
    await w.find('[data-test="slack-channel-edit-C2"]').trigger("click");
    await flushPromises();
    await body().find('[data-test="slack-channel-answer-thread"]').trigger("click");
    await body().find("form").trigger("submit");
    await vi.waitFor(() =>
      expect(slack.putChannelDefault).toHaveBeenCalledWith("_meta", "inst-1", "C2", {
        org_id: "_meta",
        answer_mode: "thread",
      }),
    );
  });

  it("a _meta admin picks the default org from every served org", async () => {
    vi.mocked(slack.getOrgAccess).mockReturnValue(ok(orgAccessView()) as any);
    const w = await mountOn(instanceView(), metaStore(), metaRows);
    await w.find('[data-test="slack-channel-edit-C2"]').trigger("click");
    await flushPromises();
    expect(slack.getOrgAccess).toHaveBeenCalledWith("_meta", "inst-1");
    const picker = w
      .findAllComponents({ name: "OSelect" })
      .find((c) => c.attributes("data-test") === "slack-channel-org-select");
    expect(picker).toBeDefined();
    const options = picker!.props("options") as { label: string; value: string }[];
    expect(options.map((o) => o.value)).toEqual(["_meta", "prod", "staging", "payments"]);
    expect(picker!.props("modelValue")).toBe("staging");
    expect(body().find('[data-test="slack-channel-default-org"]').exists()).toBe(false);
    picker!.vm.$emit("update:modelValue", "prod");
    await flushPromises();
    await body().find("form").trigger("submit");
    await vi.waitFor(() =>
      expect(slack.putChannelDefault).toHaveBeenCalledWith("_meta", "inst-1", "C2", {
        org_id: "prod",
        answer_mode: "private",
      }),
    );

    w.unmount();
    vi.mocked(slack.getOrgAccess).mockReturnValue(ok(orgAccessView({ all: true })) as any);
    const all = await mountOn(instanceView({ org_access: "all" }), metaStore(), metaRows);
    await all.find('[data-test="slack-channel-set-default"]').trigger("click");
    await flushPromises();
    const everyOrg = all
      .findAllComponents({ name: "OSelect" })
      .find((c) => c.attributes("data-test") === "slack-channel-org-select");
    expect((everyOrg!.props("options") as unknown[]).length).toBe(8);
    expect(everyOrg!.props("modelValue")).toBe("_meta");
  });

  it("other viewers keep This org", async () => {
    const w = await mountOn(managedView());
    await w.find('[data-test="slack-channel-set-default"]').trigger("click");
    await flushPromises();
    expect(body().find('[data-test="slack-channel-default-org"]').exists()).toBe(true);
    expect(body().find('[data-test="slack-channel-org-select"]').exists()).toBe(false);
    w.unmount();
    const orgWorkspace = await mountOn(installationView(), metaStore());
    await orgWorkspace.find('[data-test="slack-channel-set-default"]').trigger("click");
    await flushPromises();
    expect(body().find('[data-test="slack-channel-org-select"]').exists()).toBe(false);
    expect(slack.getOrgAccess).not.toHaveBeenCalled();
  });

  it("the table names the owning org for _meta", async () => {
    const w = await mountOn(instanceView(), metaStore(), metaRows);
    const [mine, theirs] = w.findAll('[data-test-stub="otable-row"]');
    expect(mine.find('[data-col="default_org"]').text()).toBe("_meta");
    expect(theirs.find('[data-col="default_org"]').text()).toBe("Staging");
    w.unmount();
    const managed = await mountOn(managedView());
    const cells = managed.findAll('[data-col="default_org"]').map((c) => c.text());
    expect(cells).toEqual(["This org", "Another org"]);
  });
});
