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
import i18n from "@/locales";
import O2AIChatHistoryMenu from "./O2AIChatHistoryMenu.vue";

// ODropdownItem needs an open reka-ui menu around it; render its slot inline instead.
vi.mock("@/lib/overlay/Dropdown/ODropdownItem.vue", () => ({
  default: defineComponent({
    emits: ["select"],
    setup(_, { slots, emit }) {
      return () =>
        h("div", { class: "stub-item", onClick: () => emit("select", new Event("select")) }, slots.default?.());
    },
  }),
}));
vi.mock("@/lib/overlay/Dropdown/ODropdownSeparator.vue", () => ({
  default: defineComponent({ setup: () => () => h("hr") }),
}));

const chats = [
  { id: 1, title: "First chat", timestamp: "2024-01-01T00:00:00.000Z" },
  { id: 2, title: "Second chat", timestamp: "2024-01-02T00:00:00.000Z" },
];

function mountMenu(list = chats) {
  return mount(O2AIChatHistoryMenu, {
    global: { plugins: [i18n] },
    props: { chats: list, searchTerm: "" },
  });
}

describe("O2AIChatHistoryMenu", () => {
  it("lists each chat with its title and localized time", () => {
    const w = mountMenu();
    const items = w.findAll(".stub-item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("First chat");
    expect(items[0].text()).toContain(new Date(chats[0].timestamp).toLocaleString());
  });

  it("emits select with the chat id, and delete without also selecting", async () => {
    const w = mountMenu();
    await w.findAll(".stub-item")[1].trigger("click");
    expect(w.emitted("select")).toEqual([[2]]);

    await w.findAll(".delete-history-btn")[0].trigger("click");
    expect(w.emitted("delete")).toEqual([[1]]);
    expect(w.emitted("select")).toHaveLength(1);
  });

  it("emits clear-all and hides it with the empty message when there are no chats", async () => {
    const w = mountMenu();
    await w.find(".clear-all-btn").trigger("click");
    expect(w.emitted("clear-all")).toHaveLength(1);

    const empty = mountMenu([]);
    expect(empty.find(".clear-all-container").exists()).toBe(false);
    expect(empty.text()).toContain(i18n.global.t("aiAssistant.noMatchingChatsFound"));
  });

  it("forwards search input through v-model:searchTerm", async () => {
    const w = mountMenu();
    await w.find("input").setValue("err");
    expect(w.emitted("update:searchTerm")?.at(-1)).toEqual(["err"]);
  });
});
