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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import i18n from "@/locales";

import InlineHelperHint, { HINT_BLUR_MS, HINT_PAUSE_MS } from "./InlineHelperHint.vue";

const base = { text: "", language: "sql" as const, enabled: true, editTick: 0, focused: true };

function mountHint(props: Partial<typeof base> = {}) {
  return mount(InlineHelperHint, {
    props: { ...base, ...props },
    global: { plugins: [i18n], stubs: { OShortcut: { template: "<kbd>Ctrl+M</kbd>" } } },
  });
}

async function type(wrapper: ReturnType<typeof mountHint>, text: string, tick: number) {
  await wrapper.setProps({ text, editTick: tick });
  vi.advanceTimersByTime(HINT_PAUSE_MS);
  await nextTick();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InlineHelperHint", () => {
  it("offers to write a sentence as a query after a typing pause, and Ask carries it", async () => {
    const wrapper = mountHint();
    await type(wrapper, "show errors per service", 1);
    const hint = wrapper.get('[data-test="inline-helper-hint"]');
    expect(hint.attributes("role")).toBe("status");
    expect(hint.text()).toContain("Ask the assistant to write this as SQL?");
    await wrapper.get('[data-test="inline-helper-hint-ask"]').trigger("click");
    expect(wrapper.emitted("ask")).toEqual([["show errors per service"]]);
    expect(wrapper.find('[data-test="inline-helper-hint"]').exists()).toBe(false);
  });

  it("never trips on comment-only or code text, the #15019 class", async () => {
    const wrapper = mountHint({ language: "vrl" });
    await type(wrapper, "# parse the message into fields", 1);
    await type(wrapper, '.status = "active"', 2);
    await type(wrapper, "abort", 3);
    expect(wrapper.find('[data-test="inline-helper-hint"]').exists()).toBe(false);
  });

  it("ignores programmatic writes: only a user keystroke arms the detector", async () => {
    const wrapper = mountHint();
    await wrapper.setProps({ text: "show errors per service" });
    vi.advanceTimersByTime(HINT_PAUSE_MS * 2);
    await nextTick();
    expect(wrapper.find('[data-test="inline-helper-hint"]').exists()).toBe(false);
  });

  it("does not run where the door would refuse", async () => {
    const wrapper = mountHint({ enabled: false });
    await type(wrapper, "show errors per service", 1);
    expect(wrapper.find('[data-test="inline-helper-hint"]').exists()).toBe(false);
  });

  it("stays while the text reads as a sentence, and goes when it turns into code", async () => {
    const wrapper = mountHint();
    await type(wrapper, "show errors per service", 1);
    await wrapper.setProps({ text: "show errors per service today" });
    expect(wrapper.find('[data-test="inline-helper-hint"]').exists()).toBe(true);
    await wrapper.setProps({ text: "SELECT * FROM logs" });
    expect(wrapper.find('[data-test="inline-helper-hint"]').exists()).toBe(false);
  });

  it("goes after the editor has been unfocused for a while", async () => {
    const wrapper = mountHint();
    await type(wrapper, "show errors per service", 1);
    await wrapper.setProps({ focused: false });
    vi.advanceTimersByTime(HINT_BLUR_MS);
    await nextTick();
    expect(wrapper.find('[data-test="inline-helper-hint"]').exists()).toBe(false);
  });

  it("stays dismissed for the rest of this editor instance only", async () => {
    const wrapper = mountHint();
    await type(wrapper, "show errors per service", 1);
    await wrapper.get('[data-test="inline-helper-hint-dismiss"]').trigger("click");
    await type(wrapper, "count logs by level now", 2);
    expect(wrapper.find('[data-test="inline-helper-hint"]').exists()).toBe(false);
    const other = mountHint();
    await type(other, "count logs by level now", 1);
    expect(other.find('[data-test="inline-helper-hint"]').exists()).toBe(true);
  });
});
