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

import OnCallSlackCard from "@/components/oncall/OnCallSlackCard.vue";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { ChatLinkView } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({
  default: { getMySlackLink: vi.fn(), startSlackLink: vi.fn(), unlinkMySlack: vi.fn() },
}));

const service = vi.mocked(oncallService);
const EMAIL = store.state.userInfo.email;

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OIcon: { name: "OIcon", template: "<i />" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OBanner: { name: "OBanner", template: "<div><slot /></div>" },
  OButton: {
    name: "OButton",
    props: ["disabled", "loading"],
    emits: ["click"],
    template: `<button :disabled="disabled" @click="$emit('click', $event)"><slot /></button>`,
  },
};

function link(connected: boolean): ChatLinkView {
  return {
    workspace_id: "T1",
    workspace_name: "Acme Corp",
    connected,
    slack_user_id: "U1",
    email: EMAIL,
    linked_at: 1,
  };
}

function refusal(status: number, message: string) {
  return { response: { status, data: { code: status, message } } };
}

async function render(read: ChatLinkView | null) {
  service.getMySlackLink.mockResolvedValue({ data: read } as any);
  const wrapper = mount(OnCallSlackCard, { global: { plugins: [i18n, store], stubs } });
  await flushPromises();
  return wrapper;
}

const find = (w: Awaited<ReturnType<typeof render>>, id: string) =>
  w.find(`[data-test="oncall-slack-${id}"]`);

describe("OnCallSlackCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it("offers Link Slack, naming the email it looks the caller up by", async () => {
    const wrapper = await render(null);
    expect(find(wrapper, "link").attributes("disabled")).toBeUndefined();
    expect(find(wrapper, "hint").text()).toBe(
      `We find you by ${EMAIL} and DM you a Confirm button.`,
    );
    expect(find(wrapper, "state").exists()).toBe(false);
  });

  it("says to check Slack after the DM is sent, and Send again repeats the same call", async () => {
    service.startSlackLink.mockResolvedValue({ data: { sent: true } } as any);
    const wrapper = await render(null);

    await find(wrapper, "link").trigger("click");
    await flushPromises();

    expect(find(wrapper, "state").text()).toBe("Not linked yet");
    expect(find(wrapper, "check-slack").text()).toBe(
      "Check Slack: we sent you a DM. Press Confirm in it to finish.",
    );
    expect(wrapper.text()).toContain("The link works for 10 minutes.");
    expect(find(wrapper, "link").exists()).toBe(false);

    await find(wrapper, "send-again").trigger("click");
    await flushPromises();
    expect(service.startSlackLink).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      404,
      `No Slack account uses ${EMAIL} in Acme Corp. Type /oncall link in Slack to link the account you use there.`,
    ],
    [409, "Slack wouldn't deliver a direct message to you."],
  ])("shows a %s from Link Slack word for word and keeps the button", async (status, message) => {
    service.startSlackLink.mockRejectedValue(refusal(status, message));
    const wrapper = await render(null);

    await find(wrapper, "link").trigger("click");
    await flushPromises();

    expect(find(wrapper, "error").text()).toBe(message);
    expect(find(wrapper, "link").attributes("disabled")).toBeUndefined();
    expect(find(wrapper, "check-slack").exists()).toBe(false);
  });

  it("disables Link Slack under the not-connected banner once Link Slack answers 400", async () => {
    service.startSlackLink.mockRejectedValue(refusal(400, "Slack is not connected"));
    const wrapper = await render(null);

    await find(wrapper, "link").trigger("click");
    await flushPromises();

    expect(find(wrapper, "link").attributes("disabled")).toBeDefined();
    expect(find(wrapper, "not-connected").text()).toBe(
      "Slack is not connected. Ask an organisation admin to connect it in Settings → Slack.",
    );
    expect(find(wrapper, "error").exists()).toBe(false);
  });

  it("shows a link as Linked as its email, with Unlink and no confirm step", async () => {
    const wrapper = await render(link(true));
    expect(find(wrapper, "state").text()).toBe("Linked");
    expect(find(wrapper, "linked-as").text()).toBe(`Linked as ${EMAIL}`);
    expect(wrapper.text()).toContain("Page buttons and /oncall now work for you.");
    expect(find(wrapper, "not-connected").exists()).toBe(false);

    service.unlinkMySlack.mockResolvedValue({ data: { unlinked: true } } as any);
    service.getMySlackLink.mockResolvedValue({ data: null } as any);
    await find(wrapper, "unlink").trigger("click");
    await flushPromises();

    expect(service.unlinkMySlack).toHaveBeenCalledWith({ org_identifier: expect.any(String) });
    expect(find(wrapper, "link").exists()).toBe(true);
  });

  it("keeps a link from before a Disconnect as Linked, with the not-connected banner", async () => {
    const wrapper = await render(link(false));
    expect(find(wrapper, "linked-as").text()).toBe(`Linked as ${EMAIL}`);
    expect(find(wrapper, "not-connected").exists()).toBe(true);
  });

  it("says so when Unlink fails, and keeps the link on screen", async () => {
    service.unlinkMySlack.mockRejectedValue(new Error("network"));
    const wrapper = await render(link(true));

    await find(wrapper, "unlink").trigger("click");
    await flushPromises();

    expect(find(wrapper, "error").text()).toBe("Slack could not be unlinked. Try again.");
    expect(find(wrapper, "linked-as").exists()).toBe(true);
  });

  it("says the link could not be loaded when its read fails", async () => {
    service.getMySlackLink.mockRejectedValue(new Error("network"));
    const wrapper = mount(OnCallSlackCard, { global: { plugins: [i18n, store], stubs } });
    await flushPromises();

    expect(find(wrapper, "load-failed").text()).toBe("Your Slack link could not be loaded.");
    expect(find(wrapper, "link").exists()).toBe(false);
  });
});
