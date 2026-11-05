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

import AssistantDictationTail from "./AssistantDictationTail.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

function render(tail: string) {
  const field = document.createElement("textarea");
  document.body.appendChild(field);
  const wrapper = mount(AssistantDictationTail, {
    props: { field, before: "why ", tail },
    attachTo: document.body,
  });
  return { wrapper, field };
}

describe("AssistantDictationTail", () => {
  it("renders nothing without a tail", () => {
    expect(render("").wrapper.find('[data-test="assistant-dictate-tail"]').exists()).toBe(false);
  });

  it("underlines only the tail, hidden from assistive technology", () => {
    const mirror = render("cart fail").wrapper.get('[data-test="assistant-dictate-tail"]');
    expect(mirror.attributes("aria-hidden")).toBe("true");
    expect(mirror.classes()).toContain("text-transparent");
    expect(mirror.get("span").text()).toBe("cart fail");
    expect(mirror.get("span").classes()).toContain("decoration-dotted");
  });

  it("follows the textbox's scroll", async () => {
    const { wrapper, field } = render("tail");
    await flushPromises();
    field.scrollTop = 40;
    field.dispatchEvent(new Event("scroll"));
    expect(wrapper.get('[data-test="assistant-dictate-tail"]').element.scrollTop).toBe(40);
  });
});
