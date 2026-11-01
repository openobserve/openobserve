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
import { afterEach, describe, expect, it } from "vitest";

import { raw } from "@/types/i18n";

import AssistantVoiceAllowPopover from "./AssistantVoiceAllowPopover.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AssistantVoiceAllowPopover", () => {
  it("gives this browser's steps and the headphones sentence (B17)", async () => {
    const wrapper = mount(AssistantVoiceAllowPopover, {
      props: { steps: raw("Open site settings.") },
      attachTo: document.body,
    });
    await wrapper.get('[data-test="assistant-dictate-how"]').trigger("click");
    await flushPromises();
    const text = document.body.querySelector(
      '[data-test="assistant-dictate-how-popover"]',
    )?.textContent;
    expect(text).toContain("Open site settings.");
    expect(text).toContain("With a screen reader, use headphones while dictating.");
  });
});
