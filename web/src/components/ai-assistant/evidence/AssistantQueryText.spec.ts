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
import { afterEach, describe, expect, it, vi } from "vitest";

import { raw } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

import { SYNTAX_CLASSES } from "../transcript/markdownCore";
import AssistantQueryText from "./AssistantQueryText.vue";

vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn(async () => true) }));

const props = {
  text: 'sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))',
  language: "promql" as const,
  label: raw("PromQL query"),
  dataTest: "q",
};

const mountText = (extra: Record<string, unknown> = {}, slots = {}) =>
  mount(AssistantQueryText, { props: { ...props, ...extra }, slots, attachTo: document.body });

describe("AssistantQueryText", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("paints the query with the assistant's role classes, PromQL included", () => {
    const html = mountText().get('[data-test="q"]').html();
    expect(html).toContain(`class="${SYNTAX_CLASSES.function}">sum<`);
    expect(html).toContain(`class="${SYNTAX_CLASSES.label}">service<`);
    expect(html).not.toContain("hljs-");
  });

  it("has no chrome of its own unless asked", () => {
    const wrapper = mountText();
    expect(wrapper.find('[data-test="q-chrome"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="q-copy"]').exists()).toBe(false);
  });

  it("heads the block with the language, the meta and Copy, and puts the card's actions in its foot", () => {
    const wrapper = mountText(
      { chrome: true, meta: raw("last 5 min") },
      { foot: '<button data-test="open">Open</button>' },
    );
    const chrome = wrapper.get('[data-test="q-chrome"]');
    expect(chrome.attributes("role")).toBe("group");
    expect(chrome.classes()).toEqual(expect.arrayContaining(["bg-assistant-syn-bg", "border"]));
    expect(wrapper.get('[data-test="q-lang"]').text()).toBe("PromQL");
    expect(wrapper.get('[data-test="q-meta"]').text()).toBe("last 5 min");
    expect(wrapper.get('[data-test="q-foot"] [data-test="open"]').exists()).toBe(true);
  });

  it("copies the query and says Copied in place for two seconds", async () => {
    vi.useFakeTimers();
    const wrapper = mountText({ chrome: true });
    await wrapper.get('[data-test="q-copy"]').trigger("click");
    await flushPromises();
    expect(copyToClipboard).toHaveBeenCalledWith(props.text, expect.any(Function), {
      silent: true,
    });
    const copy = wrapper.get('[data-test="q-copy"]');
    expect(copy.attributes("data-done")).toBe("true");
    expect(copy.text()).toContain("Copied");
    vi.advanceTimersByTime(2_000);
    await flushPromises();
    expect(wrapper.get('[data-test="q-copy"]').attributes("data-done")).toBeUndefined();
  });
});
