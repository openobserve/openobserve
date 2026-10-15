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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import type { ChatInstallView, SlackAvailability } from "@/ts/interfaces/oncall";
import { SLACK_OAUTH_MESSAGE_TYPE } from "@/utils/slackOAuth";
import SlackSettings from "./SlackSettings.vue";

vi.mock("@/services/oncall", () => ({
  default: {
    listChatInstalls: vi.fn(),
    startSlackInstall: vi.fn(),
    exchangeSlackInstall: vi.fn(),
    deleteChatInstall: vi.fn(),
  },
}));

const service = vi.mocked(oncallService);
const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize?state=s1";
const NOT_ADMIN = "Only org admins can connect Slack";
const IN_11 =
  "Also remove the app in Slack. Reconnecting needs the app invited to each team's Slack channel again.";
const ACTIVE: ChatInstallView = {
  workspace_id: "T1",
  workspace_name: "Acme Corp",
  status: "active",
  installed_by: "ana@o2.ai",
  installed_at: 1,
};
const REVOKED: ChatInstallView = { ...ACTIVE, status: "revoked" };

const originalZoConfig = store.state.zoConfig;
const popup = {} as Window;
let openSpy: ReturnType<typeof vi.spyOn>;

function failure(status: number, message = "") {
  return { response: { status, data: { code: status, message } } };
}

async function render(installs: ChatInstallView[], availability: SlackAvailability = "on") {
  store.state.zoConfig = { ...originalZoConfig, oncall_slack: availability };
  service.listChatInstalls.mockResolvedValue({ data: installs } as any);
  const wrapper = mount(SlackSettings, {
    global: { plugins: [i18n, store, withQueryClient()] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const q = (id: string) => document.querySelector<HTMLElement>(`[data-test="slack-settings-${id}"]`);
const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

async function click(id: string) {
  q(id)!.click();
  await flushPromises();
}

// jsdom's MessageEvent refuses a plain object as `source`, so the popup is set on the event.
async function relay(data: unknown, source: unknown = popup) {
  const event = new MessageEvent("message", { data, origin: window.location.origin });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
  await flushPromises();
}

describe("SlackSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openSpy = vi.spyOn(window, "open").mockReturnValue(popup);
    service.startSlackInstall.mockResolvedValue({ data: { url: AUTHORIZE_URL } } as any);
    service.exchangeSlackInstall.mockResolvedValue({ data: ACTIVE } as any);
  });

  afterEach(() => {
    openSpy.mockRestore();
    store.state.zoConfig = originalZoConfig;
    document.body.innerHTML = "";
  });

  describe("page states", () => {
    it("1b: not connected shows the hero with one Connect Slack action", async () => {
      await render([]);
      expect(text("hero")).toContain("No Slack workspace connected");
      expect(text("hero")).toContain(
        "Connect Slack so pages post in your teams' Slack channels and people can acknowledge from Slack.",
      );
      expect(text("connect")).toContain("Connect Slack");
      expect(text("connect")).toContain("Approve four permissions in a Slack popup");
      expect(q("block")).toBeNull();
    });

    it("needs_key disables Connect Slack with the operator line and calls nothing", async () => {
      await render([], "needs_key");
      expect(q("connect")?.getAttribute("aria-disabled")).toBe("true");
      expect(text("block")).toBe("Ask your operator to set the encryption key.");
      await click("connect");
      expect(service.startSlackInstall).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it("connected shows the workspace, Disconnect and the next steps", async () => {
      await render([ACTIVE]);
      expect(text("connected")).toContain("Connected");
      expect(text("workspace")).toBe("Acme Corp");
      expect(q("disconnect")?.hasAttribute("disabled")).toBe(false);
      expect(text("next-steps")).toBe(
        "Next: in each team's Slack channel, type /oncall here <team>. People link their own Slack account on My on-call.",
      );
    });

    it("revoked shows Disconnected in Slack and a Reconnect that runs the connect flow", async () => {
      await render([REVOKED]);
      expect(text("revoked")).toContain("Disconnected in Slack");
      expect(text("workspace")).toBe("Acme Corp");
      expect(q("next-steps")).toBeNull();
      await click("reconnect");
      expect(service.startSlackInstall).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(AUTHORIZE_URL, expect.any(String), expect.any(String));
    });

    it("a failed read shows the load-failed banner", async () => {
      store.state.zoConfig = { ...originalZoConfig, oncall_slack: "on" };
      service.listChatInstalls.mockRejectedValue(failure(500));
      mount(SlackSettings, {
        global: { plugins: [i18n, store, withQueryClient()] },
        attachTo: document.body,
      });
      await vi.waitFor(() => expect(q("failed")).not.toBeNull());
      expect(text("failed")).toBe("The Slack connection could not be loaded.");
    });
  });

  describe("connect (IN-5, RB-12)", () => {
    it("calls install/start before opening the popup on the returned URL", async () => {
      await render([]);
      await click("connect");
      expect(openSpy).toHaveBeenCalledWith(AUTHORIZE_URL, expect.any(String), expect.any(String));
      expect(service.startSlackInstall.mock.invocationCallOrder[0]).toBeLessThan(
        openSpy.mock.invocationCallOrder[0],
      );
    });

    it("a 403 on install/start opens no popup and disables Connect Slack with the admin line", async () => {
      service.startSlackInstall.mockRejectedValue(failure(403, "Forbidden"));
      await render([]);
      await click("connect");
      expect(openSpy).not.toHaveBeenCalled();
      expect(q("connect")?.getAttribute("aria-disabled")).toBe("true");
      expect(text("block")).toBe(NOT_ADMIN);
    });

    it("a blocked popup tells the user to allow popups", async () => {
      openSpy.mockReturnValue(null);
      await render([]);
      await click("connect");
      expect(text("banner")).toBe(
        "Your browser blocked the Slack window. Allow popups for OpenObserve and try again.",
      );
    });

    it("exchanges the code and state its own popup relayed, and ignores any other window", async () => {
      await render([]);
      await click("connect");
      const message = { type: SLACK_OAUTH_MESSAGE_TYPE, code: "c1", state: "s1" };
      await relay(message, {});
      expect(service.exchangeSlackInstall).not.toHaveBeenCalled();
      await relay(message);
      expect(service.exchangeSlackInstall).toHaveBeenCalledWith({
        org_identifier: store.state.selectedOrganization.identifier,
        code: "c1",
        state: "s1",
      });
    });

    it("redeems a relayed code once, even if the popup sends it again", async () => {
      await render([]);
      await click("connect");
      const message = { type: SLACK_OAUTH_MESSAGE_TYPE, code: "c1", state: "s1" };
      await relay(message);
      await relay(message);
      expect(service.exchangeSlackInstall).toHaveBeenCalledTimes(1);
    });

    it("ignores an older popup's code while a new install/start is pending", async () => {
      await render([]);
      await click("connect");
      let answerStart: (value: unknown) => void = () => {};
      service.startSlackInstall.mockReturnValue(new Promise((resolve) => (answerStart = resolve)));
      await click("connect");
      await relay({ type: SLACK_OAUTH_MESSAGE_TYPE, code: "old", state: "s0" });
      expect(service.exchangeSlackInstall).not.toHaveBeenCalled();
      answerStart({ data: { url: AUTHORIZE_URL } });
      await flushPromises();
      expect(openSpy).toHaveBeenCalledTimes(2);
    });

    it("IN-9: a workspace held by another org shows the server's sentence in a banner", async () => {
      const held = "This Slack workspace is connected to another OpenObserve organization.";
      service.exchangeSlackInstall.mockRejectedValue(failure(409, held));
      await render([]);
      await click("connect");
      await relay({ type: SLACK_OAUTH_MESSAGE_TYPE, code: "c1", state: "s1" });
      expect(text("banner")).toBe(held);
      expect(q("hero")).not.toBeNull();
    });

    it("a 403 on install/exchange disables Connect Slack with the admin line", async () => {
      service.exchangeSlackInstall.mockRejectedValue(failure(403, "Forbidden"));
      await render([]);
      await click("connect");
      await relay({ type: SLACK_OAUTH_MESSAGE_TYPE, code: "c1", state: "s1" });
      expect(text("block")).toBe(NOT_ADMIN);
    });
  });

  describe("disconnect (IN-11, RB-12)", () => {
    it("the confirm says to remove the app in Slack, and confirming disconnects the workspace", async () => {
      service.deleteChatInstall.mockResolvedValue({ data: { message: IN_11 } } as any);
      await render([ACTIVE]);
      await click("disconnect");
      expect(document.body.textContent).toContain("Disconnect Slack?");
      expect(document.body.textContent).toContain(IN_11);
      document.querySelector<HTMLButtonElement>('[data-test="o-dialog-primary-btn"]')!.click();
      await flushPromises();
      expect(service.deleteChatInstall).toHaveBeenCalledWith({
        org_identifier: store.state.selectedOrganization.identifier,
        workspace_id: "T1",
      });
    });

    it("a 403 on Disconnect disables it with the admin line", async () => {
      service.deleteChatInstall.mockRejectedValue(failure(403, "Forbidden"));
      await render([ACTIVE]);
      await click("disconnect");
      document.querySelector<HTMLButtonElement>('[data-test="o-dialog-primary-btn"]')!.click();
      await flushPromises();
      expect(q("disconnect")?.hasAttribute("disabled")).toBe(true);
      expect(text("block")).toBe(NOT_ADMIN);
      expect(q("next-steps")).toBeNull();
    });
  });
});
