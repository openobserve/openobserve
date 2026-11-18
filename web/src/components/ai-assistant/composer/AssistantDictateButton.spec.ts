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

import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw } from "@/types/i18n";

import AssistantDictateButton, {
  type AssistantDictateButtonProps,
} from "./AssistantDictateButton.vue";

function render(props: Partial<AssistantDictateButtonProps> = {}) {
  return mount(AssistantDictateButton, {
    props: { phase: "idle", ...props },
    attachTo: document.body,
  });
}

const mic = '[data-test="assistant-dictate"]';

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AssistantDictateButton", () => {
  it("keeps the name Dictate in every state; aria-pressed carries listening", () => {
    expect(render().get(mic).attributes()).toMatchObject({
      "aria-label": "Dictate",
      "aria-pressed": "false",
      "data-size": "sm",
    });
    expect(render({ phase: "listening" }).get(mic).attributes()).toMatchObject({
      "aria-label": "Dictate",
      "aria-pressed": "true",
    });
  });

  it("never changes shape: the same 28 px square in every phase", () => {
    for (const phase of [
      "idle",
      "requesting",
      "listening",
      "processing",
      "denied",
      "off",
    ] as const) {
      const button = render({ phase }).get(mic);
      expect(button.classes()).not.toContain("rounded-full");
      expect(button.attributes("data-size")).toBe("sm");
    }
  });

  it("uses aria-disabled with a reason, so the mic stays focusable", () => {
    const button = render({ phase: "denied", disabledReason: raw("Blocked") }).get(mic);
    expect(button.attributes("aria-disabled")).toBe("true");
    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("shows each phase with its own glyph", () => {
    const glyph = (phase: AssistantDictateButtonProps["phase"]) =>
      render({ phase }).findComponent(OIcon).props("name");
    expect(glyph("idle")).toBe("mic");
    expect(glyph("listening")).toBe("stop");
    expect(glyph("denied")).toBe("mic-off");
    expect(glyph("unavailable")).toBe("mic-off");
    expect(glyph("off")).toBe("mic-off");
  });

  it("is busy while the browser asks and while the last words settle", () => {
    expect(render({ phase: "requesting" }).get(mic).attributes("aria-busy")).toBe("true");
    const processing = render({ phase: "processing" }).get(mic);
    expect(processing.attributes("aria-busy")).toBe("true");
  });

  it("emits press with the click, for the composer to read pointer or keyboard", async () => {
    const wrapper = render();
    await wrapper.get(mic).trigger("click");
    expect(wrapper.emitted("press")).toHaveLength(1);
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
