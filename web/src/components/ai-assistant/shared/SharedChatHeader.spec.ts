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

import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import type { SharedChat } from "@/services/ai_chat_share";

import SharedChatHeader from "./SharedChatHeader.vue";
import type { PollState } from "./usePollShared";

const chat = (over: Partial<SharedChat> = {}): SharedChat => ({
  title: "Checkout 5xx spike",
  mode: "snapshot",
  seq: 4,
  created_at: 1_760_000_000_000_000,
  shared_at: 1_760_000_000_000_000,
  owner_name: "Priya Raman",
  not_modified: false,
  turns: [],
  ...over,
});

const polling = (over: Partial<PollState> = {}): PollState => ({
  status: "idle",
  intervalMs: null,
  lastChangeAt: null,
  loadedAt: null,
  runningSince: null,
  retryInSecs: null,
  changes: 0,
  ...over,
});

function header(props: Record<string, unknown> = {}) {
  const shown = (props.chat as SharedChat | undefined) ?? chat();
  return mount(SharedChatHeader, {
    props: {
      variant: "org",
      chat: shown,
      share: { mode: shown.mode, visibility: "org" },
      viewer: "member",
      polling: polling(),
      timezone: "UTC",
      ...props,
    },
    slots: { continue: '<button data-test="shared-chat-continue">Continue in my chats</button>' },
    attachTo: document.body,
  });
}

const at = (wrapper: ReturnType<typeof header>, id: string) => wrapper.find(`[data-test="${id}"]`);

enableAutoUnmount(afterEach);

describe("SharedChatHeader", () => {
  it("names the title, owner and snapshot time with its zone, and offers no Refresh", () => {
    const wrapper = header();
    expect(at(wrapper, "assistant-shared-title").text()).toBe("Checkout 5xx spike");
    expect(at(wrapper, "assistant-shared-by").text()).toBe("Shared by Priya Raman");
    expect(at(wrapper, "assistant-shared-asof").text()).toMatch(
      /^Snapshot as of .*\d{2}:\d{2} UTC$/,
    );
    expect(wrapper.text()).not.toMatch(/refresh/i);
  });

  it("reads a live share's last change from the newest committed turn", () => {
    const wrapper = header({
      chat: chat({ mode: "live" }),
      polling: polling({ status: "live", lastChangeAt: Date.UTC(2026, 9, 14, 13, 59) }),
    });
    expect(at(wrapper, "assistant-shared-asof").text()).toMatch(/^Live · last change .*13:59 UTC$/);
  });

  it("says a running share updates on its own, and names a back-off", () => {
    const running = header({
      chat: chat({ mode: "live", active_turn: true }),
      polling: polling({ status: "running", runningSince: 1_000 }),
      now: 1_000 + 3 * 60_000,
    });
    expect(at(running, "assistant-shared-asof").text()).toMatch(
      /^Still answering · started .* · updates on its own$/,
    );
    const quiet = header({ chat: chat({ mode: "live" }), polling: polling({ status: "backoff" }) });
    expect(at(quiet, "assistant-shared-backoff").text()).toBe("Checking every minute");
  });

  it.each([
    ["owner", "org", true, "assistant-shared-open-mine"],
    ["member", "org", true, "shared-chat-continue"],
    ["member", "org", false, "assistant-shared-continue-locked"],
    ["signedOut", "public", true, "assistant-shared-signin"],
    ["member", "public", true, "assistant-shared-open-app"],
  ] as const)(
    "gives %s on the %s page (can continue: %s) its own primary",
    (viewer, variant, canContinue, id) => {
      const wrapper = header({ viewer, variant, canContinue });
      expect(at(wrapper, id).exists()).toBe(true);
      if (viewer === "owner") expect(at(wrapper, "shared-chat-continue").exists()).toBe(false);
    },
  );

  it("shows no sign-in, open or continue action while the reader's session is being checked", () => {
    const wrapper = header({ variant: "public", viewer: "checking" });
    for (const id of [
      "assistant-shared-signin",
      "assistant-shared-open-mine",
      "assistant-shared-open-app",
      "assistant-shared-continue-locked",
      "shared-chat-continue",
    ])
      expect(at(wrapper, id).exists()).toBe(false);
  });

  it("offers Continue on the public page once the share names its org", () => {
    const wrapper = header({ variant: "public", chat: chat({ org_identifier: "default" }) });
    expect(at(wrapper, "shared-chat-continue").exists()).toBe(true);
  });

  it("brands the public page and links the wordmark home", () => {
    const wrapper = header({ variant: "public", viewer: "signedOut" });
    expect(at(wrapper, "assistant-shared-brand").text()).toContain("Shared from OpenObserve");
    expect(at(wrapper, "assistant-shared-brand-home").attributes("aria-label")).toBe(
      "OpenObserve home",
    );
  });

  it("signs in through the app's return path, never a query string with the token", async () => {
    window.sessionStorage.removeItem("redirectURI");
    const wrapper = header({ variant: "public", viewer: "signedOut" });
    const link = at(wrapper, "assistant-shared-signin");
    expect(link.attributes("href")).toMatch(/\/login$/);
    link.element.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await link.trigger("click");
    expect(window.sessionStorage.getItem("redirectURI")).toBe(window.location.href);
    window.sessionStorage.removeItem("redirectURI");
  });

  it("starts focus on the heading", () => {
    const wrapper = header();
    expect(document.activeElement).toBe(at(wrapper, "assistant-shared-title").element);
  });
});
