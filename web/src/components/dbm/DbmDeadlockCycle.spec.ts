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
import { describe, expect, it, vi } from "vitest";
import { createStore } from "vuex";

import i18n from "@/locales";
import { raw } from "@/types/i18n";

import DbmDeadlockCycle from "./DbmDeadlockCycle.vue";

vi.mock("@/components/ai-assistant/entry/AiEntryButton.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    __esModule: true,
    default: defineComponent({
      props: { dataTest: String },
      setup: (props) => () => h("button", { "data-test": props.dataTest }),
    }),
  };
});

const event = {
  id: "e1",
  timestamp: 0,
  db_system: "postgresql",
  objects: ["orders"],
  participants: [],
};
const aiDoor = { dataTest: "ai-entry-dbm-finding-fix", label: raw("Suggest fix") } as any;

const mountCycle = (features: Record<string, string>) =>
  mount(DbmDeadlockCycle, {
    props: { event: event as any, aiDoor },
    global: {
      plugins: [i18n, createStore({ state: { zoConfig: { features } } })],
      stubs: { DbmDeadlockSide: true },
    },
  });

describe("DbmDeadlockCycle fix button", () => {
  it("keeps the locked Suggest fix button without the license, and the door with it", async () => {
    const locked = mountCycle({ ai_assistant: "locked" });
    await flushPromises();
    expect(locked.find('[data-test="dbm-deadlock-cycle-ask-ai-locked"]').exists()).toBe(true);
    expect(locked.find('[data-test="ai-entry-dbm-finding-fix"]').exists()).toBe(false);

    const enabled = mountCycle({ ai_assistant: "enabled" });
    await flushPromises();
    expect(enabled.find('[data-test="dbm-deadlock-cycle-ask-ai-locked"]').exists()).toBe(false);
    expect(enabled.find('[data-test="ai-entry-dbm-finding-fix"]').exists()).toBe(true);
  });
});
