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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallRingingBanner from "@/components/oncall/OnCallRingingBanner.vue";
import i18n from "@/locales";

const stubs = {
  OBanner: {
    name: "OBanner",
    props: ["variant", "inlineActions", "icon"],
    template: "<div><slot /><slot name='actions' /></div>",
  },
  OButton: {
    name: "OButton",
    props: ["variant", "size", "loading"],
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
};

const MINUTE = 60_000_000;

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallRingingBanner, {
    props: { ringing: 1, ...props },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallRingingBanner", () => {
  /// A banner that is always on screen is a banner people stop reading, so the
  /// calm state is no banner at all.
  it("renders nothing while nothing is ringing", () => {
    expect(render({ ringing: 0 }).find("[data-test='oncall-ringing-banner']").exists()).toBe(false);
  });

  /// A count is only urgent with an age against it — five pages ringing for a
  /// minute is a different morning from five ringing for two hours.
  it("states the count and how long the worst one has waited", () => {
    const wrapper = render({ ringing: 5, oldestOpenedAt: Date.now() * 1000 - 30 * MINUTE });

    const text = wrapper.find("[data-test='oncall-ringing-banner-headline']").text();
    expect(text).toContain("5 pages are ringing");
    expect(text).toContain("30m");
  });

  /// Without an opened_at there is no age to state, and inventing one would put
  /// a number on the most-read line of the screen that nothing backs.
  it("drops the age when the oldest instant is unknown", () => {
    const wrapper = render({ ringing: 2, oldestOpenedAt: null });

    expect(wrapper.find("[data-test='oncall-ringing-banner-headline']").text()).toBe(
      "2 pages are ringing with nobody acknowledging.",
    );
  });

  /// The ladder having finished is what says nobody else is coming, so it wins
  /// the second clause over the softer "some of these are yours".
  it("prefers the exhausted ladder over the assigned-to-you count", () => {
    const wrapper = render({ ringing: 5, exhausted: 4, assignedToMe: 2 });

    expect(wrapper.find("[data-test='oncall-ringing-banner-detail']").text()).toBe(
      "4 of them have exhausted their escalation ladder.",
    );
  });

  it("falls back to what is on the reader's own rotation", () => {
    const wrapper = render({ ringing: 3, exhausted: 0, assignedToMe: 2 });

    expect(wrapper.find("[data-test='oncall-ringing-banner-detail']").text()).toBe(
      "2 of them are on your rotation.",
    );
  });

  /// The count the banner states is the set the button acts on, so claiming it
  /// must not require selecting the rows first.
  it("acknowledges the whole ringing set in one click", async () => {
    const wrapper = render({ ringing: 5 });
    const button = wrapper.find("[data-test='oncall-ringing-banner-ack']");

    expect(button.text()).toBe("Acknowledge all 5");
    await button.trigger("click");
    expect(wrapper.emitted("acknowledge-all")).toHaveLength(1);
  });

  /// A reader who cannot acknowledge gets the fact, not a button that must fail.
  it("hides the acknowledge action when the reader cannot act", () => {
    const wrapper = render({ ringing: 5, canAct: false });

    expect(wrapper.find("[data-test='oncall-ringing-banner-ack']").exists()).toBe(false);
  });

  /// The second action goes to the record that needs a human decision — there is
  /// no endpoint that opens a page from nothing.
  it("offers the oldest record when there is one to open", async () => {
    const wrapper = render({ ringing: 5, oldestId: "resp_1" });
    await wrapper.find("[data-test='oncall-ringing-banner-oldest']").trigger("click");

    expect(wrapper.emitted("open-oldest")).toHaveLength(1);
  });

  it("hides the second action when no record id is known", () => {
    const wrapper = render({ ringing: 5, oldestId: null });

    expect(wrapper.find("[data-test='oncall-ringing-banner-oldest']").exists()).toBe(false);
  });
});
