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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { historyStubs } from "../__tests__/historyStubs";
import AssistantLocalOnlyHeader, {
  NEAR_CAP,
  type AssistantLocalOnlyHeaderProps,
} from "./AssistantLocalOnlyHeader.vue";

const setup = (props: Partial<AssistantLocalOnlyHeaderProps> = {}) =>
  mount(AssistantLocalOnlyHeader, {
    props: { count: 37, cap: 100, isAdmin: false, clearOnSignOut: false, ...props },
    global: { stubs: historyStubs },
  });

describe("AssistantLocalOnlyHeader", () => {
  it("names the mode with the count and cap", () => {
    const line = setup().get('[data-test="assistant-local-only-line"]');
    expect(line.text()).toBe("Saved in this browser only · 37 of 100");
    expect(line.classes()).not.toContain("text-status-warning-text");
  });

  it("turns warm, never red, near the cap", () => {
    const line = setup({ count: NEAR_CAP }).get('[data-test="assistant-local-only-line"]');
    expect(line.text()).toBe("95 of 100 · the oldest unpinned chat is removed when you reach 100");
    expect(line.classes()).toContain("text-status-warning-text");
    expect(line.classes().some((c) => c.includes("error"))).toBe(false);
  });

  it("explains browser history and keeps the sign-out preference", async () => {
    const wrapper = setup();
    await wrapper.get('[data-test="assistant-local-info"]').trigger("click");
    expect(wrapper.get('[data-test="assistant-local-info-help"]').text()).toMatch(
      /^Chats stay in this browser\./,
    );
    expect(wrapper.find('[data-test="assistant-local-info-admin"]').exists()).toBe(false);
    await wrapper
      .get('[data-test="assistant-local-clear-on-signout"] [role="checkbox"]')
      .trigger("click");
    expect(wrapper.emitted("update:clearOnSignOut")).toEqual([[true]]);
  });

  it("tells an admin how to turn account history on", async () => {
    const wrapper = setup({ isAdmin: true });
    await wrapper.get('[data-test="assistant-local-info"]').trigger("click");
    expect(wrapper.get('[data-test="assistant-local-info-admin"]').text()).toContain(
      "O2_AI_CHAT_PERSISTENCE_ENABLED",
    );
    expect(wrapper.get('[data-test="assistant-local-info-admin-link"]').attributes("target")).toBe(
      "_blank",
    );
  });
});
