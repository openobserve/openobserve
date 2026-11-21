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

import { raw } from "@/types/i18n";

import AssistantErrorRow from "./AssistantErrorRow.vue";
import { assistantGlyph } from "./glyphs";

const TINT_OR_FRAME = /^(bg-|border|ring-|rounded|shadow|p-|px-|py-)/;

const mountRow = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
  mount(AssistantErrorRow, {
    props: { message: raw("Couldn't load chats."), ...props },
    slots,
  });

describe("AssistantErrorRow", () => {
  it("shows the failed glyph in the failed signal ink and the sentence in body ink", () => {
    const wrapper = mountRow();
    const icon = wrapper.get('[data-test="assistant-error-row-icon"]');
    expect(icon.classes()).toContain("text-assistant-signal-failed");
    expect(icon.attributes("aria-hidden")).toBe("true");
    expect(icon.find("svg, span").exists()).toBe(true);
    const text = wrapper.get('[data-test="assistant-error-row-text"]');
    expect(text.classes()).toContain("text-typography-body");
    expect(text.text()).toBe("Couldn't load chats.");
  });

  it("uses the neutral info glyph for a refusal", () => {
    const wrapper = mountRow({ tone: "refused" });
    expect(wrapper.get('[data-test="assistant-error-row"]').attributes("data-tone")).toBe(
      "refused",
    );
    expect(wrapper.get('[data-test="assistant-error-row-icon"]').classes()).toContain(
      "text-text-secondary",
    );
  });

  it("emits retry from a Retry icon button named by its label", async () => {
    const wrapper = mountRow({ retryable: true, dataTest: "chats-error" });
    const retry = wrapper.get('[data-test="chats-error-retry"]');
    expect(retry.attributes("aria-label")).toBe("Retry");
    await retry.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    expect(assistantGlyph.regenerate).toBe("refresh");
  });

  it("renders no Retry unless retryable", () => {
    expect(mountRow().find('[data-test="assistant-error-row-retry"]').exists()).toBe(false);
  });

  it("ignores Retry clicks while retrying", async () => {
    const wrapper = mountRow({ retryable: true, retrying: true });
    await wrapper.get('[data-test="assistant-error-row-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toBeUndefined();
  });

  it("takes a custom label, slot text and extra actions", () => {
    const wrapper = mountRow(
      { retryable: true, retryLabel: raw("Try again") },
      { default: "Rich <b>text</b>", actions: '<a data-test="extra">Show</a>' },
    );
    expect(wrapper.get('[data-test="assistant-error-row-retry"]').attributes("aria-label")).toBe(
      "Try again",
    );
    expect(wrapper.get('[data-test="assistant-error-row-text"]').html()).toContain("<b>text</b>");
    expect(wrapper.find('[data-test="extra"]').exists()).toBe(true);
  });

  it("has no tint, border or frame on the row", () => {
    const root = mountRow({ retryable: true }).get('[data-test="assistant-error-row"]');
    expect(root.classes().filter((c) => TINT_OR_FRAME.test(c))).toEqual([]);
  });
});
