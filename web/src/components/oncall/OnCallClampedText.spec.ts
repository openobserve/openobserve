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

import OnCallClampedText from "@/components/oncall/OnCallClampedText.vue";
import i18n from "@/locales";

const proto = HTMLElement.prototype;
const original = {
  scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
  clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
};

function sized(scrollHeight: number, clientHeight: number) {
  Object.defineProperty(proto, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => clientHeight });
}

async function render() {
  const wrapper = mount(OnCallClampedText, {
    props: { html: "The alert fired because <b>the stream</b> is synthetic." },
    global: { plugins: [i18n] },
  });
  await flushPromises();
  return wrapper;
}

describe("OnCallClampedText", () => {
  afterEach(() => {
    for (const [key, desc] of Object.entries(original)) {
      if (desc) Object.defineProperty(proto, key, desc);
    }
  });

  it("offers no toggle when the text fits in three lines", async () => {
    sized(60, 60);
    const wrapper = await render();

    expect(wrapper.find('[data-test="oncall-clamped-text-toggle"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-clamped-text-body"]').classes()).toContain(
      "line-clamp-3",
    );
  });

  it("opens the full text and closes it again", async () => {
    sized(200, 60);
    const wrapper = await render();
    const toggle = () => wrapper.find('[data-test="oncall-clamped-text-toggle"]');
    const body = () => wrapper.find('[data-test="oncall-clamped-text-body"]');

    expect(toggle().text()).toBe("Show more");
    await toggle().trigger("click");
    expect(body().classes()).not.toContain("line-clamp-3");
    expect(toggle().text()).toBe("Show less");
    await toggle().trigger("click");
    expect(body().classes()).toContain("line-clamp-3");
    expect(body().html()).toContain("<b>the stream</b>");
  });
});
