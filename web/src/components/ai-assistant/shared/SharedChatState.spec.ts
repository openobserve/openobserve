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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import SharedChatState from "./SharedChatState.vue";

vi.mock("@/components/ai-assistant/gate/AssistantGateState.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    __esModule: true,
    default: defineComponent({
      props: { reason: String, size: String },
      setup: (props) => () =>
        h("div", {
          "data-test": "assistant-gate-state",
          "data-gate": props.reason,
          "data-size": props.size,
        }),
    }),
  };
});

const state = (props: Record<string, unknown>) =>
  mount(SharedChatState, { props: { variant: "org", ...props } });

enableAutoUnmount(afterEach);

describe("SharedChatState", () => {
  it("names a forbidden org share and offers no Retry", async () => {
    const wrapper = state({ state: "forbidden" });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-gate-state"]').attributes("data-gate")).toBe(
      "no_share_read",
    );
    expect(wrapper.find('[data-test="assistant-gate-state"]').attributes("data-size")).toBe("hero");
    expect(wrapper.find('[data-test="assistant-shared-state-retry"]').exists()).toBe(false);
  });

  it("reads the same for every unavailable link", () => {
    const org = state({ state: "not_found", signedIn: true });
    expect(org.text()).toContain("This shared chat isn't available");
    expect(org.text()).toContain(
      "The link may be wrong, revoked or expired, or the chat was deleted.",
    );
    expect(org.find('[data-test="assistant-shared-state-go-to-chats"]').exists()).toBe(true);
    const pub = state({ state: "not_found", variant: "public" });
    expect(pub.find('[data-test="assistant-shared-state-go-to-app"]').text()).toBe(
      "Go to OpenObserve",
    );
  });

  it("offers Retry offline and on a server error", async () => {
    const offline = state({ state: "offline" });
    expect(offline.text()).toContain("You're offline");
    await offline.find('[data-test="assistant-shared-state-retry"]').trigger("click");
    expect(offline.emitted("retry")).toHaveLength(1);
    expect(state({ state: "error" }).text()).toContain("Couldn't load this shared chat");
  });

  it("explains the OSS build with See plans instead of a router 404", () => {
    const wrapper = state({ state: "oss", variant: "public" });
    expect(wrapper.text()).toContain("Shared chats are part of OpenObserve Enterprise and Cloud");
    expect(
      wrapper.find('[data-test="assistant-shared-state-see-plans"]').attributes("rel"),
    ).toContain("noopener");
  });

  it("shows a skeleton while loading, never a blank page", () => {
    expect(state({ state: "loading" }).attributes("data-state")).toBe("loading");
  });
});
