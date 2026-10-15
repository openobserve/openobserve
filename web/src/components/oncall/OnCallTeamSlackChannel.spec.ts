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
import { copyToClipboard } from "@/utils/clipboard";

vi.mock("@/services/oncall", () => ({ default: { testTeamSlackChannel: vi.fn() } }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn() }));

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
  OBanner: { name: "OBanner", template: "<div><slot /></div>" },
  OTooltip: { name: "OTooltip", template: "<span />" },
};

// A team channel read: Slack channel #pay in the connected workspace, webhooks `destinations`.
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

  it("not set: guides to /oncall here with the team name and copies the command", async () => {
    const wrapper = render(
      channel({ slack_channel_set: false, slack_channel_name: null, slack_native: false }),
    );

    expect(find(wrapper, "unset").text()).toBe("Not set");
    expect(find(wrapper, "guidance").text()).toContain(
      "Set a Slack channel with /oncall here Cloud SRE",
    );
    expect(find(wrapper, "guidance").text()).toContain(
      "It needs your Slack account linked on My on-call.",
    );
    expect(find(wrapper, "test").exists()).toBe(false);
    await find(wrapper, "copy").trigger("click");
    expect(copyToClipboard).toHaveBeenCalledWith("/oncall here Cloud SRE", expect.anything());
  });

  it("no Slack connected: says so instead of the guidance", () => {
    const wrapper = render(
      channel({ slack_channel_set: false, slack_native: false, slack_connected: false }),
    );

    expect(find(wrapper, "off").text()).toBe(
      "Slack is not connected. Ask an organisation admin to connect it in Settings → Slack.",
    );
    expect(find(wrapper, "guidance").exists()).toBe(false);
  });

  it("set: shows the name with Send test message and Clear, and Clear sends clear_slack", async () => {
    const wrapper = render(channel());

    expect(find(wrapper, "name").text()).toBe("#pay");
    expect(find(wrapper, "test").exists()).toBe(true);
    await find(wrapper, "clear").trigger("click");
    expect(wrapper.emitted("save")).toEqual([[{ clear_slack: true }]]);
  });

  it("workspace mismatch: the warning and Clear only", () => {
    const wrapper = render(channel({ slack_native: false }));

    expect(find(wrapper, "mismatch").text()).toBe(
      "This Slack channel is in a workspace that is no longer connected.",
    );
    expect(find(wrapper, "clear").exists()).toBe(true);
    expect(find(wrapper, "test").exists()).toBe(false);
    expect(find(wrapper, "same-room").exists()).toBe(false);
  });

  it("offers stop-posting only when the team has a webhook destination", () => {
    expect(find(render(channel({ destinations: [] })), "same-room").exists()).toBe(false);
    const wrapper = render(channel());
    expect(find(wrapper, "same-room").text()).toContain("Stop posting pages through slack-old");
    expect(find(wrapper, "stop-pick").exists()).toBe(false);
  });

  it("one webhook: ticking names it, unticking sends none", async () => {
    const unticked = render(channel());
    await find(unticked, "stop").find("input").setValue(true);
    expect(unticked.emitted("save")).toEqual([[{ slack_same_room_destination: "slack-old" }]]);
    expect(find(unticked, "stop-risk").exists()).toBe(true);

    const ticked = render(channel({ slack_same_room_destination: "slack-old" }));
    expect(find(ticked, "stop-risk").exists()).toBe(false);
    await find(ticked, "stop").find("input").setValue(false);
    expect(ticked.emitted("save")).toEqual([[{}]]);
  });

  it("several webhooks: a picker, and picking while ticked saves the choice", async () => {
    const wrapper = render(
      channel({ destinations: ["slack-old", "pd"], slack_same_room_destination: "slack-old" }),
    );

    expect(find(wrapper, "same-room").text()).toContain("Stop posting pages through");
    const picker = wrapper.findComponent({ name: "OSelect" });
    expect(picker.props("modelValue")).toBe("slack-old");
    picker.vm.$emit("update:modelValue", "pd");
    expect(wrapper.emitted("save")).toEqual([[{ slack_same_room_destination: "pd" }]]);
  });

  it("read-only after a 403: the facts stay, every control is disabled", async () => {
    service.testTeamSlackChannel.mockRejectedValue({
      response: { status: 403, data: { message: "Forbidden" } },
    });
    const wrapper = render(channel({ destinations: ["a", "b"], slack_same_room_destination: "a" }));
    await find(wrapper, "test").trigger("click");
    await flushPromises();

    expect(find(wrapper, "name").text()).toBe("#pay");
    expect(find(wrapper, "test").attributes("disabled")).toBeDefined();
    expect(find(wrapper, "clear").attributes("disabled")).toBeDefined();
    expect(find(wrapper, "stop").find("input").attributes("disabled")).toBeDefined();
    expect(wrapper.findComponent({ name: "OSelect" }).props("disabled")).toBe(true);
  });

  /// RO-7: one line per class under the row; the failure lines are the server's words.
  it.each([
    [{ ok: true, class: "ok", advice: null }, "Test message sent to #pay"],
    [
      { ok: false, class: "channel_problem", advice: "Invite the app: /invite @openobserve" },
      "Invite the app: /invite @openobserve",
    ],
    [
      { ok: false, class: "not_connected", advice: "Slack is not connected" },
      "Slack is not connected",
    ],
    [
      {
        ok: false,
        class: "no_channel",
        advice: "Set a Slack channel with /oncall here Cloud SRE",
      },
      "Set a Slack channel with /oncall here Cloud SRE",
    ],
  ])("shows the test result %#", async (data, line) => {
    service.testTeamSlackChannel.mockResolvedValue({ data } as any);
    const wrapper = render(channel());

    await find(wrapper, "test").trigger("click");
    await flushPromises();

    expect(service.testTeamSlackChannel).toHaveBeenCalledWith({
      org_identifier: "default",
      team_id: "team_1",
    });
    expect(find(wrapper, "result").text()).toBe(line);
  });

  it("shows the server's refusal when the test cannot run", async () => {
    service.testTeamSlackChannel.mockRejectedValue({
      response: { status: 502, data: { message: "Slack could not be reached. Try again." } },
    });
    const wrapper = render(channel());

    await find(wrapper, "test").trigger("click");
    await flushPromises();

    expect(find(wrapper, "result").text()).toBe("Slack could not be reached. Try again.");
  });
});
