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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import SlackSectionBar from "./SlackSectionBar.vue";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

const box = (el: HTMLElement, top: number, bottom: number) => {
  el.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
};

describe("SlackSectionBar", () => {
  it("marks the last section once the page cannot scroll further, even if its top is low", async () => {
    const scroller = document.createElement("div");
    const general = document.createElement("section");
    general.id = "slack-section-general";
    const ao = document.createElement("section");
    ao.id = "slack-section-autoobserve";
    scroller.append(general, ao);
    document.body.append(scroller);
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    wrapper = mount(SlackSectionBar, {
      props: {
        sections: [
          { id: "general", label: raw("General") },
          { id: "autoobserve", label: raw("AutoObserve") },
        ],
      },
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    box(general, -900, 500);
    box(ao, 500, 990);
    Object.defineProperty(scroller, "scrollHeight", { value: 3000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 1000, configurable: true });
    scroller.scrollTop = 2000;
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await flushPromises();
    expect(
      wrapper.find('[data-test="slack-section-link-autoobserve"]').attributes("aria-current"),
    ).toBe("location");
  });
});
