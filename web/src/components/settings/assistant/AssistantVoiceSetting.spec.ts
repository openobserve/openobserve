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

import { fakeAssistant } from "@/components/ai-assistant/__tests__/fakeAssistant";
import { fakeVoiceEngine } from "@/components/ai-assistant/__tests__/fakeVoice";
import { resetVoiceForTests } from "@/components/ai-assistant/composer/useAssistantVoice";
import { readVoiceOptIn } from "@/composables/assistant";

import AssistantVoiceSetting from "./AssistantVoiceSetting.vue";
import { settingsHarness } from "./assistantSettings.test-helpers";

const { fake } = vi.hoisted(() => ({
  fake: {
    current: null as ReturnType<
      typeof import("@/components/ai-assistant/__tests__/fakeAssistant").fakeAssistant
    > | null,
  },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => fake.current!.handle,
  useAssistantStore: () => fake.current!.store,
}));

function render(over: Parameters<typeof fakeAssistant>[1] = {}) {
  fake.current = fakeAssistant("available", over);
  return mount(AssistantVoiceSetting, {
    global: { plugins: settingsHarness().plugins },
    attachTo: document.body,
  });
}

const option = (value: string) => `[data-test="settings-assistant-voice-${value}"]`;
const pressed = (w: ReturnType<typeof render>, value: string) =>
  w.get(option(value)).attributes("data-state");

beforeEach(() => {
  localStorage.clear();
  resetVoiceForTests(fakeVoiceEngine());
});

afterEach(() => {
  resetVoiceForTests();
  document.body.innerHTML = "";
});

describe("AssistantVoiceSetting", () => {
  it("defaults to Off on self-hosted (A5)", () => {
    const wrapper = render();
    expect(pressed(wrapper, "off")).toBe("on");
    expect(wrapper.text()).toContain("No mic button in the composer.");
  });

  it("lets an admin turn on this browser, saved per user+org", async () => {
    const wrapper = render();
    await wrapper.get(option("browser")).trigger("click");
    await flushPromises();
    expect(readVoiceOptIn("k1")).toBe(true);
    expect(pressed(wrapper, "browser")).toBe("on");
    expect(wrapper.get('[data-test="settings-assistant-voice-note"]').text()).toContain(
      "Saved in this browser, for you only.",
    );
  });

  it("is read-only for a non-admin", async () => {
    const wrapper = render({ isAdmin: false });
    await wrapper.get(option("browser")).trigger("click");
    await flushPromises();
    expect(readVoiceOptIn("k1")).toBe(false);
  });

  it("is read-only at In the browser on Cloud", async () => {
    const wrapper = render({ edition: "cloud" });
    expect(pressed(wrapper, "browser")).toBe("on");
    await wrapper.get(option("off")).trigger("click");
    await flushPromises();
    expect(pressed(wrapper, "browser")).toBe("on");
    expect(wrapper.get('[data-test="settings-assistant-voice-note"]').text()).toBe(
      "Server speech-to-text needs a newer server version.",
    );
  });
});
