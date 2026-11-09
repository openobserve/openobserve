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
import { describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";

import AssistantHeaderSees from "./AssistantHeaderSees.vue";
import { composerStripHoldsSees } from "./headerSees";

const { state } = vi.hoisted(() => ({
  state: { sessions: {} as Record<string, unknown> },
}));

vi.mock("@/composables/assistant", async () => {
  const { reactive } = await import("vue");
  const live = reactive(state);
  return { useAssistantStore: () => ({ state: live }) };
});
vi.mock("@/components/ai-assistant/context/AssistantContextSeesPopover.vue", () => ({
  default: {
    name: "AssistantContextSeesPopover",
    props: ["sid", "placement"],
    template: '<button data-test="sees-stub" :data-sid="sid" :data-placement="placement" />',
  },
}));

const timeChip = { kind: "time", provenance: "page" };
const streamChip = { kind: "stream", provenance: "mention" };

describe("AssistantHeaderSees", () => {
  it("holds the ⓘ in the header when the composer strip has only the time chip", () => {
    reactive(state).sessions = { s1: { composer: { chips: [timeChip], images: [] } } };
    const wrapper = mount(AssistantHeaderSees, { props: { sid: "s1" } });
    const sees = wrapper.get('[data-test="assistant-shell-sees"]');
    expect(sees.attributes("data-sid")).toBe("s1");
    expect(sees.attributes("data-placement")).toBe("bottom");
  });

  it("hands the ⓘ to the composer strip once a staged chip or image sits there", async () => {
    const live = reactive(state);
    live.sessions = { s1: { composer: { chips: [timeChip], images: [] } } };
    const wrapper = mount(AssistantHeaderSees, { props: { sid: "s1" } });
    (live.sessions.s1 as { composer: { chips: unknown[] } }).composer.chips.push(streamChip);
    await nextTick();
    expect(wrapper.find('[data-test="assistant-shell-sees"]').exists()).toBe(false);
  });

  it("shows the header ⓘ when there is no session yet", () => {
    reactive(state).sessions = {};
    const wrapper = mount(AssistantHeaderSees, { props: { sid: null } });
    expect(wrapper.find('[data-test="assistant-shell-sees"]').exists()).toBe(true);
  });
});

describe("composerStripHoldsSees", () => {
  it("matches the composer strip: images or staged non-time, non-page chips", () => {
    expect(composerStripHoldsSees(null)).toBe(false);
    expect(composerStripHoldsSees({ chips: [timeChip], images: [] })).toBe(false);
    expect(composerStripHoldsSees({ chips: [{ kind: "stream", provenance: "page" }] })).toBe(false);
    expect(composerStripHoldsSees({ chips: [streamChip] })).toBe(true);
    expect(composerStripHoldsSees({ chips: [], images: [{}] })).toBe(true);
  });
});
