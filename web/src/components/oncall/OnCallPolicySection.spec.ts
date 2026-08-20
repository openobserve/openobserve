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

import OnCallPolicySection from "@/components/oncall/OnCallPolicySection.vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OIcon: { name: "OIcon", props: ["name"], template: "<i />" },
  OCollapsible: {
    name: "OCollapsible",
    props: ["modelValue"],
    template: `<div><slot name="trigger" :open="!!modelValue" /><div v-if="modelValue"><slot /></div></div>`,
  },
};

function render(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(OnCallPolicySection, {
    props: {
      icon: "activity",
      title: raw("Delivery"),
      description: raw("How pages reach people and rooms"),
      summary: raw("Email + chat/webhook"),
      dataTest: "section",
      ...props,
    },
    slots: { default: "<p>body</p>", ...slots },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallPolicySection", () => {
  /// Closed, the caption has to say what the card currently holds; open, it
  /// says what the card is for. Either state answers a different question.
  it("swaps the caption for the summary while it is folded away", () => {
    expect(render().text()).toContain("Email + chat/webhook");
    expect(render({ defaultOpen: true }).text()).toContain("How pages reach people and rooms");
  });

  it("keeps the body out of the DOM until it is opened", () => {
    expect(render().text()).not.toContain("body");
    expect(render({ defaultOpen: true }).text()).toContain("body");
  });

  /// A card that hides its own breakage reads as fine, so problems and the
  /// status badge sit outside the fold.
  it("shows problems and the badge while it is still closed", () => {
    const wrapper = render(
      {},
      { problems: "<p>webhook reaches nobody</p>", badge: "<span>1 problem</span>" },
    );
    expect(wrapper.text()).toContain("webhook reaches nobody");
    expect(wrapper.text()).toContain("1 problem");
  });

  /// A "Fix" button that only scrolls to a fold is a button that does nothing.
  it("can be opened by the parent that sent somebody here to fix something", async () => {
    const wrapper = render();
    (wrapper.vm as unknown as { expand: () => void }).expand();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("body");
  });

  it("marks a card most teams never need to open", () => {
    expect(render({ advanced: true }).text()).toContain("Advanced");
    expect(render().text()).not.toContain("Advanced");
  });
});
