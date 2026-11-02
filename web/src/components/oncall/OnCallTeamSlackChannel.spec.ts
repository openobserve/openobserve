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

import OnCallTeamSlackChannel from "@/components/oncall/OnCallTeamSlackChannel.vue";
import { resetOnCallPermissions } from "@/composables/useOnCallPermissions";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { TeamChannel } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({ default: { testTeamSlackChannel: vi.fn() } }));

const service = vi.mocked(oncallService);

const stubs = {
  OButton: {
    name: "OButton",
    props: ["disabled"],
    template: `<button :disabled="disabled"><slot /></button>`,
  },
  OCheckbox: {
    name: "OCheckbox",
    props: ["modelValue", "label", "disabled"],
    emits: ["update:modelValue"],
    template: `<label><input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.checked)" />{{ label }}</label>`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "disabled"],
    emits: ["update:modelValue"],
    template: `<select :disabled="disabled" />`,
  },
  OBanner: { name: "OBanner", props: ["variant"], template: "<div><slot /></div>" },
};

const NOT_SET_UP = "Slack is not set up. An admin sets it up in Settings › Slack.";
const OTHER_WORKSPACE =
  "This Slack channel is in a workspace that is no longer set up for this organisation.";
const POST_PROBLEM =
  "Pages can't post to #pay: the app is not in the channel. Invite it: /invite @OpenObserve.";

// A team channel read: Slack channel #pay served by the org's Slack app, one webhook destination.
function channel(over: Partial<TeamChannel> = {}): TeamChannel {
  return {
    team_id: "team_1",
    destinations: ["slack-old"],
    source: "team",
    slack_channel_set: true,
    slack_channel_name: "pay",
    slack_same_room_destination: null,
    slack_native: true,
    slack_connected: true,
    slack_unavailable_reason: null,
    slack_post_problem: null,
    ...over,
  };
}

function render(read: TeamChannel) {
  return mount(OnCallTeamSlackChannel, {
    props: { orgId: "default", teamId: "team_1", teamName: "Cloud SRE", channel: read },
    global: { plugins: [i18n, store], stubs },
  });
}

const find = (wrapper: ReturnType<typeof render>, id: string) =>
  wrapper.find(`[data-test="oncall-team-slack-${id}"]`);

describe("OnCallTeamSlackChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOnCallPermissions();
  });

  it("no channel: names /o2 oncall here with the team, and the /o2 link hint", () => {
    const wrapper = render(
      channel({ slack_channel_set: false, slack_channel_name: null, slack_native: false }),
    );

    expect(find(wrapper, "guidance").text()).toContain(
      "Set a Slack channel with /o2 oncall here Cloud SRE",
    );
    expect(find(wrapper, "guidance").text()).toContain("/o2 link");
    expect(find(wrapper, "name").exists()).toBe(false);
    expect(find(wrapper, "test").exists()).toBe(false);
    expect(find(wrapper, "clear").exists()).toBe(false);
  });

  it("set: shows #name with Send test message and Clear, and Clear sends clear_slack", async () => {
    const wrapper = render(channel());

    expect(find(wrapper, "name").text()).toBe("#pay");
    expect(find(wrapper, "test").text()).toBe("Send test message");
    await find(wrapper, "clear").trigger("click");
    expect(wrapper.emitted("save")).toEqual([[{ clear_slack: true }]]);
  });

  /// SA-8 / RO-2: the server's own words, a plain line when Slack is not set up, a warning otherwise.
  it.each([
    [
      "not set up",
      { slack_channel_set: false, slack_native: false, slack_connected: false },
      NOT_SET_UP,
      "default",
    ],
    ["another workspace", { slack_native: false }, OTHER_WORKSPACE, "warning"],
  ])("unavailable (%s): shows the server's text", (_, over, text, variant) => {
    const wrapper = render(channel({ ...over, slack_unavailable_reason: text }));

    const banner = find(wrapper, "unavailable");
    expect(banner.text()).toBe(text);
    expect(wrapper.findComponent({ name: "OBanner" }).props("variant")).toBe(variant);
    expect(find(wrapper, "guidance").exists()).toBe(false);
    expect(find(wrapper, "test").exists()).toBe(false);
    expect(find(wrapper, "same-room").exists()).toBe(false);
  });

  it("another workspace: the channel can still be cleared", () => {
    const wrapper = render(
      channel({ slack_native: false, slack_unavailable_reason: OTHER_WORKSPACE }),
    );
    expect(find(wrapper, "clear").exists()).toBe(true);
  });

  it("a post problem: shows the server's text as an error", () => {
    const wrapper = render(channel({ slack_post_problem: POST_PROBLEM }));

    expect(find(wrapper, "post-problem").text()).toBe(POST_PROBLEM);
    expect(wrapper.findComponent({ name: "OBanner" }).props("variant")).toBe("error");
  });

  it("offers the backup webhook only when the team has a webhook destination", () => {
    expect(find(render(channel({ destinations: [] })), "same-room").exists()).toBe(false);
    const wrapper = render(channel());
    expect(find(wrapper, "same-room").text()).toBe("Use slack-old only as a backup");
    expect(find(wrapper, "same-room-pick").exists()).toBe(false);
  });

  it("one webhook: ticking names it, unticking sends an empty name", async () => {
    const unticked = render(channel());
    await find(unticked, "same-room").find("input").setValue(true);
    expect(unticked.emitted("save")).toEqual([[{ slack_same_room_destination: "slack-old" }]]);

    const ticked = render(channel({ slack_same_room_destination: "slack-old" }));
    await find(ticked, "same-room").find("input").setValue(false);
    expect(ticked.emitted("save")).toEqual([[{ slack_same_room_destination: "" }]]);
  });

  it("several webhooks: a picker names the box, and picking while ticked saves it", async () => {
    const wrapper = render(
      channel({ destinations: ["slack-old", "pd"], slack_same_room_destination: "slack-old" }),
    );

    const picker = wrapper.findComponent({ name: "OSelect" });
    expect(picker.props("modelValue")).toBe("slack-old");
    picker.vm.$emit("update:modelValue", "pd");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("save")).toEqual([[{ slack_same_room_destination: "pd" }]]);
    expect(find(wrapper, "same-room").text()).toBe("Use pd only as a backup");
  });

  it("several webhooks, unticked: picking only changes the box's name", async () => {
    const wrapper = render(channel({ destinations: ["slack-old", "pd"] }));

    wrapper.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", "pd");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("save")).toBeUndefined();
    await find(wrapper, "same-room").find("input").setValue(true);
    expect(wrapper.emitted("save")).toEqual([[{ slack_same_room_destination: "pd" }]]);
  });

  it("read-only after a 403: the channel shows, actions are hidden, the box is disabled", async () => {
    service.testTeamSlackChannel.mockRejectedValue({
      response: { status: 403, data: { message: "Forbidden" } },
    });
    const wrapper = render(channel({ destinations: ["a", "b"], slack_same_room_destination: "a" }));
    await find(wrapper, "test").trigger("click");
    await flushPromises();

    expect(find(wrapper, "name").text()).toBe("#pay");
    expect(find(wrapper, "test").exists()).toBe(false);
    expect(find(wrapper, "clear").exists()).toBe(false);
    expect(find(wrapper, "same-room").find("input").attributes("disabled")).toBeDefined();
    expect(wrapper.findComponent({ name: "OSelect" }).props("disabled")).toBe(true);
  });

  /// RO-6: the advice is the server's words, for every class.
  it.each([
    [{ ok: true, class: "ok", advice: "Sent a test message to #pay." }],
    [{ ok: false, class: "channel_problem", advice: "Invite the app: /invite @OpenObserve" }],
    [{ ok: false, class: "not_connected", advice: "Slack is not set up." }],
    [{ ok: false, class: "no_channel", advice: "Set a channel with /o2 oncall here Cloud SRE" }],
  ])("shows the test advice %#", async (data) => {
    service.testTeamSlackChannel.mockResolvedValue({ data } as any);
    const wrapper = render(channel());

    await find(wrapper, "test").trigger("click");
    await flushPromises();

    expect(service.testTeamSlackChannel).toHaveBeenCalledWith({
      org_identifier: "default",
      team_id: "team_1",
    });
    const result = find(wrapper, "result");
    expect(result.text()).toBe(data.advice);
    expect(result.classes()).toContain(
      data.ok ? "text-status-success-text" : "text-status-error-text",
    );
  });

  it("shows the server's refusal when the test cannot run", async () => {
    service.testTeamSlackChannel.mockRejectedValue({
      response: { status: 502, data: { message: "Slack could not be reached." } },
    });
    const wrapper = render(channel());

    await find(wrapper, "test").trigger("click");
    await flushPromises();

    expect(find(wrapper, "result").text()).toBe("Slack could not be reached.");
  });
});
