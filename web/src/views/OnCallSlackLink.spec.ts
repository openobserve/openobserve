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

import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import OnCallSlackLink from "@/views/OnCallSlackLink.vue";

vi.mock("@/services/oncall", () => ({
  default: { confirmSlackLink: vi.fn(), previewSlackLink: vi.fn() },
}));

const push = vi.fn();
const query: Record<string, string> = {};
vi.mock("vue-router", () => ({ useRouter: () => ({ push }), useRoute: () => ({ query }) }));

const service = vi.mocked(oncallService);
const EMAIL = store.state.userInfo.email;

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot /></div>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OIcon: { name: "OIcon", template: "<i />" },
  OBanner: { name: "OBanner", props: ["variant"], template: "<div><slot /></div>" },
  OButton: {
    name: "OButton",
    props: ["loading"],
    emits: ["click"],
    template: `<button @click="$emit('click', $event)"><slot /></button>`,
  },
};

function open(params: Record<string, string>) {
  for (const key of Object.keys(query)) delete query[key];
  Object.assign(query, params);
  return mount(OnCallSlackLink, { global: { plugins: [i18n, store], stubs } });
}

const find = (w: ReturnType<typeof open>, id: string) =>
  w.find(`[data-test="oncall-slack-link-${id}"]`);

const preview = (data: { name?: string; email?: string; same_email: boolean }) =>
  service.previewSlackLink.mockResolvedValue({ data } as any);

const REFUSED_BODY = "It may have expired. Get a new link with /oncall link in Slack.";

describe("OnCallSlackLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview({ name: "Ann", email: EMAIL, same_email: true });
  });

  it("offers no Confirm until the preview answers", async () => {
    service.previewSlackLink.mockReturnValue(new Promise(() => {}));
    const wrapper = open({ t: "tok", org_identifier: "acme" });
    await flushPromises();

    expect(service.previewSlackLink).toHaveBeenCalledWith({ org_identifier: "acme", t: "tok" });
    expect(find(wrapper, "title").text()).toBe("Link your Slack account");
    expect(find(wrapper, "confirm").exists()).toBe(false);
  });

  it("names the Slack account with no warning when its confirmed email is the session's", async () => {
    const wrapper = open({ t: "tok", org_identifier: "acme" });
    await flushPromises();

    expect(find(wrapper, "account").text()).toBe(`Slack account: Ann (${EMAIL})`);
    expect(find(wrapper, "warning").exists()).toBe(false);
    expect(find(wrapper, "confirm").exists()).toBe(true);
    expect(service.confirmSlackLink).not.toHaveBeenCalled();
  });

  it("warns when the Slack account's email is not the session's, and still offers Confirm", async () => {
    preview({ name: "Bo", email: "bo@other.example", same_email: false });
    const wrapper = open({ t: "tok", org_identifier: "acme" });
    await flushPromises();

    expect(find(wrapper, "warning").text()).toBe(
      `This Slack account's email is not ${EMAIL}. Confirm only if you typed /oncall link in Slack yourself just now.`,
    );
    expect(find(wrapper, "confirm").exists()).toBe(true);
  });

  it.each([
    [{ name: "Bo" }, "Slack account: Bo"],
    [{ email: "bo@other.example" }, "Slack account: bo@other.example"],
    [{}, "Slack account: no name or email in Slack"],
  ])("names the account from whichever of name and email exist (%o)", async (fields, line) => {
    preview({ ...fields, same_email: false });
    const wrapper = open({ t: "tok", org_identifier: "acme" });
    await flushPromises();

    expect(find(wrapper, "account").text()).toBe(line);
  });

  it("shows the refusal when the preview answers 400, with no Confirm", async () => {
    service.previewSlackLink.mockRejectedValue({
      response: { status: 400, data: { code: 400, message: "This link can't be used." } },
    });
    const wrapper = open({ t: "tok", org_identifier: "acme" });
    await flushPromises();

    expect(find(wrapper, "title").text()).toBe("This link can't be used");
    expect(find(wrapper, "body").text()).toBe(REFUSED_BODY);
    expect(find(wrapper, "confirm").exists()).toBe(false);
  });

  it("shows passing trouble when the preview fails otherwise, with no Confirm", async () => {
    service.previewSlackLink.mockRejectedValue({
      response: {
        status: 502,
        data: { code: 502, message: "Slack could not be reached. Try again." },
      },
    });
    const wrapper = open({ t: "tok", org_identifier: "acme" });
    await flushPromises();

    expect(find(wrapper, "error").text()).toBe("Slack could not be reached. Try again.");
    expect(find(wrapper, "title").text()).toBe("Link your Slack account");
    expect(find(wrapper, "confirm").exists()).toBe(false);
  });

  it("posts the token to the link's own org, then shows Linked as the answered email", async () => {
    service.confirmSlackLink.mockResolvedValue({
      data: {
        workspace_id: "T1",
        connected: true,
        slack_user_id: "U1",
        email: "ann@example.com",
        linked_at: 1,
      },
    } as any);
    const wrapper = open({ t: "tok", org_identifier: "acme" });
    await flushPromises();

    await find(wrapper, "confirm").trigger("click");
    await flushPromises();

    expect(service.confirmSlackLink).toHaveBeenCalledWith({ org_identifier: "acme", t: "tok" });
    expect(find(wrapper, "title").text()).toBe("Linked as ann@example.com");
    expect(find(wrapper, "body").text()).toBe("Page buttons and /oncall now work for you.");

    await find(wrapper, "go-mine").trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "onCallMine", query: { org_identifier: "acme" } });
  });

  it("shows the refusal when Confirm answers 400, and offers no second Confirm", async () => {
    service.confirmSlackLink.mockRejectedValue({
      response: { status: 400, data: { code: 400, message: "This link can't be used." } },
    });
    const wrapper = open({ t: "tok", org_identifier: "acme" });
    await flushPromises();

    await find(wrapper, "confirm").trigger("click");
    await flushPromises();

    expect(find(wrapper, "title").text()).toBe("This link can't be used");
    expect(find(wrapper, "body").text()).toBe(REFUSED_BODY);
    expect(find(wrapper, "confirm").exists()).toBe(false);
  });

  it("keeps Confirm for a retry when Slack could not be reached", async () => {
    service.confirmSlackLink.mockRejectedValue({
      response: {
        status: 502,
        data: { code: 502, message: "Slack could not be reached. Try again." },
      },
    });
    const wrapper = open({ t: "tok", org_identifier: "acme" });
    await flushPromises();

    await find(wrapper, "confirm").trigger("click");
    await flushPromises();

    expect(find(wrapper, "error").text()).toBe("Slack could not be reached. Try again.");
    expect(find(wrapper, "confirm").exists()).toBe(true);
  });

  it.each([[{ org_identifier: "acme" }], [{ t: "tok" }]])(
    "treats a URL missing its token or org (%o) as refused, without a call",
    async (params) => {
      const wrapper = open(params);
      await flushPromises();

      expect(find(wrapper, "title").text()).toBe("This link can't be used");
      expect(find(wrapper, "confirm").exists()).toBe(false);
      expect(service.previewSlackLink).not.toHaveBeenCalled();
      expect(service.confirmSlackLink).not.toHaveBeenCalled();
    },
  );
});
