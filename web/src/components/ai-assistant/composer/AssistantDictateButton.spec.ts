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

import AssistantDictateButton, {
  type AssistantDictateButtonProps,
} from "./AssistantDictateButton.vue";

function render(props: Partial<AssistantDictateButtonProps> = {}) {
  return mount(AssistantDictateButton, {
    props: { pressed: false, denied: false, primerOpen: false, sentence: null, ...props },
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
    const button = render({ disabledReason: raw("Blocked") }).get(mic);
    expect(button.attributes("aria-disabled")).toBe("true");
    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("emits press with the click, for the composer to read pointer or keyboard", async () => {
    const wrapper = render();
    await wrapper.get(mic).trigger("click");
    expect(wrapper.emitted("press")).toHaveLength(1);
  });

  it("names the engine in the primer and answers Not now and Continue", async () => {
    const wrapper = render({ primerOpen: true, sentence: raw("Edge uses Microsoft.") });
    await flushPromises();
    const engine = '[data-test="assistant-dictate-primer-engine"]';
    expect(document.body.querySelector(engine)?.textContent).toContain(
      "Edge uses Microsoft. OpenObserve doesn't store the audio.",
    );
    const click = (id: string) =>
      document.body.querySelector<HTMLElement>(`[data-test="${id}"]`)!.click();
    click("assistant-dictate-primer-accept");
    click("assistant-dictate-primer-decline");
    expect(wrapper.emitted("accept")).toHaveLength(1);
    expect(wrapper.emitted("decline")).toHaveLength(1);
  });
});
