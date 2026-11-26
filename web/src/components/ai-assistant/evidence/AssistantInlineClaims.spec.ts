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
import { defineComponent, h } from "vue";

import { raw } from "@/types/i18n";

import AssistantInlineClaims from "./AssistantInlineClaims.vue";

function mountClaims(html: string, count: number) {
  const claims = Array.from({ length: count }, (_, index) => `c${index}`);
  const numbers = new Map(claims.map((id, index) => [id, index + 1]));
  const Host = defineComponent(
    () => () =>
      h("div", [
        h("p", { innerHTML: html }),
        h(AssistantInlineClaims, {
          claims,
          numbers,
          available: () => true,
          label: (callId: string) => raw(`Citation ${callId}`),
        }),
      ]),
  );
  return mount(Host, { attachTo: document.body });
}

const slot = (index: number) => `<span data-claim="${index}"></span>`;

describe("AssistantInlineClaims", () => {
  afterEach(() => (document.body.innerHTML = ""));

  it("collapses three or more side-by-side consecutive numbers into one range chip", async () => {
    const wrapper = mountClaims(`Total ${slot(0)}${slot(1)} ${slot(2)}. Also ${slot(3)}`, 4);
    await flushPromises();
    const chips = wrapper.findAll('[data-test^="assistant-claim-"]');
    expect(chips.map((chip) => chip.text())).toEqual(["1–3", "4"]);
    expect(chips[0].attributes("aria-label")).toBe("Citations 1 to 3");
  });

  it("keeps a pair, or numbers with words between them, as separate chips", async () => {
    const wrapper = mountClaims(`A ${slot(0)}${slot(1)} and ${slot(2)}`, 3);
    await flushPromises();
    const chips = wrapper.findAll('[data-test^="assistant-claim-"]');
    expect(chips.map((chip) => chip.text())).toEqual(["1", "2", "3"]);
  });
});
