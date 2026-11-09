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
    props: { mic: "live", pressed: false, ...props },
    attachTo: document.body,
  });
}

const mic = '[data-test="assistant-dictate"]';

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AssistantDictateButton", () => {
  it("keeps the name Dictate in both states; aria-pressed carries the state", () => {
    expect(render().get(mic).attributes()).toMatchObject({
      "aria-label": "Dictate",
      "aria-pressed": "false",
    });
    expect(render({ pressed: true }).get(mic).attributes()).toMatchObject({
      "aria-label": "Dictate",
      "aria-pressed": "true",
    });
  });

  it("uses aria-disabled with a reason, so the mic stays focusable", () => {
    const button = render({ mic: "crossed", disabledReason: raw("Blocked") }).get(mic);
    expect(button.attributes("aria-disabled")).toBe("true");
    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("crosses the mic only where a new press cannot help", () => {
    const glyph = (state: AssistantDictateButtonProps["mic"]) =>
      render({ mic: state }).findComponent(OIcon).props("name");
    expect(glyph("live")).toBe("mic");
    expect(glyph("off")).toBe("mic");
    expect(glyph("crossed")).toBe("mic-off");
  });

  it("emits press with the click, for the composer to read pointer or keyboard", async () => {
    const wrapper = render();
    await wrapper.get(mic).trigger("click");
    expect(wrapper.emitted("press")).toHaveLength(1);
  });

  it("emits press for an admin's off mic too, so the composer offers Turn on in its strip", async () => {
    const wrapper = render({ mic: "off" });
    await wrapper.get(mic).trigger("click");
    await flushPromises();
    expect(wrapper.emitted("press")).toHaveLength(1);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("turns into a filled round Stop in the same slot while dictating, with no primer", () => {
    const button = render({ pressed: true }).get(mic);
    expect(button.attributes("data-on")).toBeDefined();
    expect(button.classes()).toContain("rounded-full");
    expect(button.findComponent(OIcon).props("name")).toBe("stop");
    expect(document.body.querySelector('[data-test="assistant-dictate-primer"]')).toBeNull();
  });
});
