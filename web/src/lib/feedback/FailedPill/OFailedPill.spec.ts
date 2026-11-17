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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import OFailedPill from "./OFailedPill.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";

const stubs = {
  OTooltip: {
    props: ["content", "maxWidth"],
    template: '<span data-test="tooltip">{{ content }}</span>',
  },
};
const SENTENCE = "Refresh failed at 10:47 · showing data from 10:42";

const mountPill = (props: Record<string, unknown>) =>
  mount(OFailedPill, { props: { sentence: SENTENCE, ...props }, global: { stubs } });

const shownWords = (wrapper: ReturnType<typeof mountPill>) =>
  wrapper
    .findAll('[aria-hidden="true"]')
    .map((el) => el.text())
    .filter(Boolean);

describe("OFailedPill", () => {
  it("is a red pill with the error icon, the sentence, a divider and Retry", async () => {
    const wrapper = mountPill({ dataTest: "pill" });
    const pill = wrapper.get('[data-test="pill"]');
    expect(pill.classes()).toEqual(
      expect.arrayContaining([
        "rounded-default",
        "border",
        "border-status-error-text",
        "bg-status-error-bg",
        "text-status-error-text",
        "h-6",
        "ps-2",
        "text-xs",
      ]),
    );
    expect(pill.classes()).not.toContain("pe-2");
    expect(wrapper.findComponent({ name: "OIcon" }).props("name")).toBe("error-outline");
    expect(wrapper.findComponent({ name: "OTruncatedText" }).text()).toBe(SENTENCE);
    expect(pill.find(".bg-status-error-text.w-px").attributes("aria-hidden")).toBe("true");
    const retry = wrapper.get('[data-test="pill-retry"]');
    expect(retry.element.tagName).toBe("BUTTON");
    expect(retry.text()).toBe("Retry");
    await retry.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    expect(wrapper.emitted("retry")![0][0]).toBeInstanceOf(MouseEvent);
  });

  it("is not an alert itself, so each consumer decides what is announced", () => {
    expect(mountPill({}).find('[role="alert"]').exists()).toBe(false);
  });

  it("shows only the marker's words where space is tight, with the sentence in its focusable tooltip and hidden text", () => {
    const wrapper = mountPill({ marker: "Refresh failed" });
    expect(wrapper.findComponent({ name: "OTruncatedText" }).exists()).toBe(false);
    expect(shownWords(wrapper)).toEqual(["Refresh failed"]);
    const marker = wrapper.get('[tabindex="0"]');
    expect(marker.find(".sr-only").text()).toBe(SENTENCE);
    expect(marker.find('[data-test="tooltip"]').text()).toBe(SENTENCE);
    expect(wrapper.find('[data-test="failed-pill-retry"]').exists()).toBe(true);
  });

  it("drops the divider and Retry when another control retries, and closes its end", () => {
    const wrapper = mountPill({ retry: false });
    const pill = wrapper.get('[data-test="failed-pill"]');
    expect(pill.classes()).toContain("pe-2");
    expect(pill.find(".w-px").exists()).toBe(false);
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("matches the failed refresh button Traces restyles in place: box, type, icons and divider", () => {
    const failedAt = Date.UTC(2026, 10, 1, 5, 17, 2);
    const pill = mountPill({ dataTest: "pill" });
    const button = mount(ORefreshButton, {
      props: { layout: "inline", ageFormat: "clock", lastRunAt: failedAt - 300_000, failedAt },
      global: { stubs },
    });
    const box = button.get("button");
    const icons = (w: any) =>
      w
        .findAll(".align-middle")
        .map((el: any) => el.classes().filter((c: string) => c.startsWith("size-")));
    for (const [pillClass, buttonClass] of [
      ["h-6", "h-6!"],
      ["border-status-error-text", "border-status-error-text!"],
      ["bg-status-error-bg", "bg-status-error-bg!"],
      ["text-xs", "text-xs"],
    ]) {
      expect(pill.get('[data-test="pill"]').classes()).toContain(pillClass);
      expect(box.classes()).toContain(buttonClass);
    }
    expect(icons(button)).toEqual(icons(pill));
    expect(box.get(".w-px").classes()).toEqual(pill.get(".w-px").classes());
    expect(box.get('[data-test="refresh-button-failed"]').classes()).toEqual(
      expect.arrayContaining(["text-status-error-text", "font-normal", "text-xs"]),
    );
  });
});
