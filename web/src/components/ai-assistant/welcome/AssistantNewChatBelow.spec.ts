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
import { computed, reactive, ref } from "vue";

import type { HistoryRow } from "@/composables/assistant";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

import { historyRow } from "../__tests__/historyStubs";
import AssistantNewChatBelow, { RECENT_CARDS } from "./AssistantNewChatBelow.vue";

const fake = vi.hoisted(() => ({
  rows: null as unknown as { value: HistoryRow[] },
  status: null as unknown as { value: string },
  ensureLoaded: vi.fn(),
  retry: vi.fn(),
  sessions: {} as Record<string, { turn: { state: string } }>,
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantHistory: () => ({
    recent: (n: number) => computed(() => fake.rows.value.slice(0, n)),
    listState: computed(() => ({ status: fake.status.value })),
    ensureLoaded: fake.ensureLoaded,
    retry: fake.retry,
  }),
  useAssistantStore: () => ({ state: { sessions: fake.sessions } }),
}));

const row = (n: number, over: Partial<HistoryRow> = {}) =>
  historyRow({
    sid: `sid-${n}`,
    title: raw(`Chat ${n}`),
    updatedAt: Date.now() - n * 3_600_000,
    ...over,
  });

const mountBelow = () => mount(AssistantNewChatBelow, { global: { plugins: [i18n] } });

describe("AssistantNewChatBelow", () => {
  beforeEach(() => {
    fake.rows = ref<HistoryRow[]>([]);
    fake.status = ref("ready");
    fake.ensureLoaded.mockReset();
    for (const key of Object.keys(fake.sessions)) delete fake.sessions[key];
  });

  it("offers a returning user three recent chats with their age, and View all", async () => {
    fake.rows.value = [row(1), row(2), row(3), row(4)];
    const wrapper = mountBelow();
    await flushPromises();
    expect(fake.ensureLoaded).toHaveBeenCalledTimes(1);
    const section = wrapper.get('[data-test="assistant-recent-chats"]');
    expect(section.attributes("aria-labelledby")).toBe(section.get("h3").attributes("id"));
    expect(section.get("h3").text()).toBe("Recent chats");
    const cards = wrapper.findAll("li button");
    expect(cards).toHaveLength(RECENT_CARDS);
    expect(cards.map((card) => card.attributes("data-test"))).toEqual([
      "assistant-recent-chat-0",
      "assistant-recent-chat-1",
      "assistant-recent-chat-2",
    ]);
    expect(cards[0].text()).toContain("Chat 1");
    expect(cards[0].get('[data-test="assistant-recent-chat-age"]').text()).toMatch(/hr?\.? ago/);
    expect(wrapper.find('[data-test="assistant-first-chat-starter"]').exists()).toBe(false);
    await cards[1].trigger("click");
    expect(wrapper.emitted("open-chat")).toEqual([["sid-2"]]);
    await wrapper.get('[data-test="assistant-recent-chats-all"]').trigger("click");
    expect(wrapper.emitted("view-all")).toHaveLength(1);
  });

  it("puts a chat that waits or answers first and names its state instead of its age", async () => {
    fake.rows.value = [row(1), row(2), row(3), row(4, { pendingApproval: true })];
    const wrapper = mountBelow();
    await flushPromises();
    const first = wrapper.get('[data-test="assistant-recent-chat-0"]');
    expect(first.attributes("data-status")).toBe("needs_you");
    expect(first.get('[data-test="assistant-recent-chat-age"]').text()).toBe("Needs you");
    expect(wrapper.find('[data-test="assistant-recent-chat-1"]').attributes("data-status")).toBe(
      undefined,
    );
  });

  it("offers a first-time user one quiet chip that asks what the agent can do", async () => {
    const wrapper = mountBelow();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-recent-chats"]').exists()).toBe(false);
    const chip = wrapper.get('[data-test="assistant-first-chat-ask"]');
    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(chip.text()).toBe("What can you do?");
    await chip.trigger("click");
    expect(wrapper.emitted("ask")).toEqual([["What can you do?"]]);
  });

  it("holds the block's height while the list loads, so the composer above never moves", async () => {
    for (const status of ["idle", "loading"]) {
      fake.status = reactive({ value: status });
      const wrapper = mountBelow();
      await flushPromises();
      expect(wrapper.find("button").exists()).toBe(false);
      const root = wrapper.get('[data-test="assistant-new-chat-below"]');
      expect(root.attributes("aria-busy")).toBe("true");
      expect(root.classes()).toContain("md:min-h-33");
      wrapper.unmount();
    }
  });

  it("says a failed read quietly with Retry, never that there are no chats", async () => {
    fake.status = reactive({ value: "error" });
    const wrapper = mountBelow();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-first-chat-ask"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Couldn't load your chats");
    await wrapper.get('[data-test="assistant-recent-chats-retry"]').trigger("click");
    expect(fake.retry).toHaveBeenCalledTimes(1);
  });
});
