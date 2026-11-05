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
import { h } from "vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import OnCallHint from "./OnCallHint.vue";

const HINT = raw("Ask an admin to connect a phone provider");

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function render(slots: Record<string, () => unknown> = {}) {
  wrapper = mount(OnCallHint, {
    props: { hint: HINT },
    attrs: { "data-test": "hint" },
    slots,
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  return wrapper;
}

describe("OnCallHint", () => {
  it("is a Tab stop named by its full hint", () => {
    const trigger = render().find('[data-test="hint"]');
    expect(trigger.attributes("tabindex")).toBe("0");
    expect(trigger.attributes("role")).toBe("img");
    expect(trigger.attributes("aria-label")).toBe(HINT);
  });

  it("opens the real tooltip on keyboard focus", async () => {
    const trigger = render().find('[data-test="hint"]');
    (trigger.element as HTMLElement).focus();
    await new Promise((r) => setTimeout(r, 800));
    await flushPromises();

    const bubble = document.body.querySelector('[data-test="o-tooltip-content"]');
    expect(bubble?.textContent).toContain(HINT);
  });

  it("keeps a slotted trigger's own text as its name", () => {
    const trigger = render({ default: () => h("span", "Not verified") }).find('[data-test="hint"]');
    expect(trigger.attributes("role")).toBeUndefined();
    expect(trigger.attributes("aria-label")).toBeUndefined();
    expect(trigger.text()).toBe("Not verified");
  });
});
