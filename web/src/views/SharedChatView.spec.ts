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

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

vi.mock("@/components/ai-assistant/shared/SharedChatPage.vue", () => ({
  default: defineComponent({
    name: "SharedChatPage",
    props: { token: String, isPublic: Boolean },
    setup: (props) => () =>
      h("div", { "data-test": "shared-chat-page-stub" }, `${props.token}:${props.isPublic}`),
  }),
}));

import SharedChatView from "./SharedChatView.vue";
import { sharedChatPollInterval } from "@/services/ai_chat_share.queries";

const sharedChat = {
  title: "Error spike",
  mode: "snapshot",
  seq: 3,
  created_at: 1_700_000_000_000_000,
  shared_at: 1_700_000_000_000_000,
  owner_name: "Ada",
  not_modified: false,
  turns: [],
};

describe("SharedChatView", () => {
  it("hands an org link to the shared chat page", () => {
    const wrapper = mount(SharedChatView, { props: { token: "tok" } });
    expect(wrapper.find('[data-test="shared-chat-page-stub"]').text()).toBe("tok:false");
  });

  it("hands a public link to the shared chat page", () => {
    const wrapper = mount(SharedChatView, { props: { token: "pub", isPublic: true } });
    expect(wrapper.find('[data-test="shared-chat-page-stub"]').text()).toBe("pub:true");
  });

  it("polls fast while a turn runs, slowly for a live share, never for a snapshot", () => {
    const base = { ...sharedChat, mode: "snapshot" as const };
    expect(sharedChatPollInterval(undefined)).toBe(false);
    expect(sharedChatPollInterval(base)).toBe(false);
    expect(sharedChatPollInterval({ ...base, mode: "live" })).toBe(30_000);
    expect(sharedChatPollInterval({ ...base, mode: "live", active_turn: true })).toBe(5_000);
  });
});
