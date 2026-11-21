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

import SharedChatNotices from "./SharedChatNotices.vue";
import type { PollState } from "./usePollShared";

const chat = (over: Partial<SharedChat> = {}): SharedChat => ({
  title: "t",
  mode: "live",
  seq: 1,
  created_at: 1,
  shared_at: 1,
  not_modified: false,
  ...over,
});

const polling = (over: Partial<PollState> = {}): PollState => ({
  status: "live",
  intervalMs: 30_000,
  lastChangeAt: null,
  loadedAt: Date.UTC(2026, 9, 14, 13, 59),
  runningSince: null,
  retryInSecs: null,
  changes: 0,
  ...over,
});

const kinds = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('[data-test="assistant-shared-notice"]').map((n) => n.attributes("data-kind"));

enableAutoUnmount(afterEach);

describe("SharedChatNotices", () => {
  it("renders nothing for a plain share", () => {
    const wrapper = mount(SharedChatNotices, {
      props: { chat: chat(), polling: polling(), timezone: "UTC" },
    });
    expect(kinds(wrapper)).toEqual([]);
  });

  it("shows each notice once, in order", () => {
    const wrapper = mount(SharedChatNotices, {
      props: {
        chat: chat({
          redact_tools: true,
          hide_attachments: true,
          truncated: true,
          hidden: { c1: { reason: "stream_forbidden", stream: "payments" } },
        }),
        polling: polling(),
        timezone: "UTC",
      },
    });
    expect(kinds(wrapper)).toEqual(["redacted", "attachments", "truncated", "streamHidden"]);
    expect(wrapper.text()).toContain(
      "Tool inputs and outputs were hidden by the owner. You see the answers and which tools ran.",
    );
  });

  it("keeps content and says when it loaded while offline, with Retry", async () => {
    const wrapper = mount(SharedChatNotices, {
      props: { chat: chat(), polling: polling({ status: "offline" }), timezone: "UTC" },
    });
    expect(wrapper.text()).toMatch(/You're offline · showing what loaded at .*13:59 UTC/);
    await wrapper.find('[data-test="assistant-shared-notice-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("prints the load time in the org's zone when the org page passes no zone", () => {
    const wrapper = mount(SharedChatNotices, {
      props: { chat: chat(), polling: polling({ status: "offline" }), timezone: "" },
    });
    expect(wrapper.text()).toMatch(/showing what loaded at \S.*\d{2}:\d{2}/);
  });

  it("names the wait when readers are rate limited", () => {
    const wrapper = mount(SharedChatNotices, {
      props: {
        chat: chat(),
        polling: polling({ status: "rateLimited", retryInSecs: 12 }),
        timezone: "UTC",
      },
    });
    expect(wrapper.text()).toContain("Too many readers right now · checking again in 12 s");
  });
});
