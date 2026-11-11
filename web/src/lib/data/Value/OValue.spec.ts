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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { gt } from "@/types/i18n";
import OValue from "./OValue.vue";
import { valueErrorCause } from "./valueErrorCause";

const stubs = {
  OTooltip: { props: ["content"], template: '<span data-test="tooltip">{{ content }}</span>' },
};

const mountValue = (props: Record<string, unknown>) =>
  mount(OValue, { props: { dataTest: "traces-stats-value", ...props }, global: { stubs } });

describe("OValue", () => {
  it("shows a static skeleton bar named Loading while the value loads", () => {
    const wrapper = mountValue({ state: "loading" });
    const root = wrapper.find('[data-test="traces-stats-value"]');
    expect(root.attributes("data-state")).toBe("loading");
    expect(root.attributes("aria-busy")).toBe("true");
    const bar = root.find(".bg-skeleton-base");
    expect(bar.attributes("aria-hidden")).toBe("true");
    expect(bar.classes()).not.toContain("animate-pulse");
    expect(bar.classes()).not.toContain("skeleton-wave");
    expect(root.find(".sr-only").text()).toBe("Loading");
    expect(root.text()).not.toContain("—");
    expect(root.text()).not.toContain("0");
  });

  it("sizes the loading bar to the expected value", () => {
    const wrapper = mountValue({ state: "loading", skeletonClass: "w-20" });
    expect(wrapper.find(".bg-skeleton-base").classes()).toContain("w-20");
  });

  it("shows a dash named No value when there is no value", () => {
    const wrapper = mountValue({ state: "none" });
    const root = wrapper.find('[data-test="traces-stats-value"]');
    expect(root.attributes("data-state")).toBe("none");
    expect(root.attributes("aria-busy")).toBeUndefined();
    expect(root.find('[aria-hidden="true"]').text()).toBe("—");
    expect(root.find(".sr-only").text()).toBe("No value");
  });

  it("shows a real 0 as 0, quiet rather than a dash", () => {
    const wrapper = mountValue({ state: "value", value: 0 });
    const shown = wrapper.find('[data-state="value"] span');
    expect(shown.text()).toBe("0");
    expect(shown.classes()).toContain("text-text-secondary");
  });

  it("shows a non-zero value as given", () => {
    const wrapper = mountValue({ state: "value", value: "12,408" });
    expect(wrapper.text()).toBe("12,408");
    expect(wrapper.find('[data-state="value"] span').classes()).not.toContain(
      "text-text-secondary",
    );
  });

  it("shows Couldn't load in red with the cause of a forced 403 in its tooltip", () => {
    const errorCause = valueErrorCause(gt, { response: { status: 403 } });
    const wrapper = mountValue({ state: "error", errorCause });
    const root = wrapper.find('[data-test="traces-stats-value"]');
    expect(root.attributes("data-state")).toBe("error");
    const marker = root.find(".text-status-error-text");
    expect(marker.attributes("tabindex")).toBe("0");
    expect(marker.classes()).toEqual(
      expect.arrayContaining(["rounded-default", "focus-visible:outline-offset-2"]),
    );
    expect(marker.text()).toContain("Couldn't load");
    expect(wrapper.find('[data-test="tooltip"]').text()).toBe(
      "Couldn't load: you don't have access to this data. Refresh to try again.",
    );
  });

  it("keeps the words for screen readers when a narrow cell shows the icon alone", () => {
    const wrapper = mountValue({ state: "error", iconOnly: true });
    const words = wrapper
      .findAll(".text-status-error-text span")
      .find((s) => s.text() === "Couldn't load");
    expect(words?.classes()).toContain("sr-only");
    expect(wrapper.find('[data-test="tooltip"]').text()).toBe(
      "Couldn't load: the server returned an error. Refresh to try again.",
    );
  });
});

describe("valueErrorCause", () => {
  it.each([
    [{ response: { status: 401 } }, "you don't have access to this data"],
    [{ response: { status: 403 } }, "you don't have access to this data"],
    [{ response: { status: 400 } }, "the server returned an error"],
    [{ response: { status: 404 } }, "the server returned an error"],
    [{ response: { status: 408 } }, "the request timed out"],
    [{ status: 504 }, "the request timed out"],
    [{ code: "ECONNABORTED" }, "the request timed out"],
    [{ response: { status: 500 } }, "the server returned an error"],
    [null, "the server returned an error"],
  ])("maps %j to its cause", (error, cause) => {
    expect(valueErrorCause(gt, error)).toBe(cause);
  });
});

describe("OValue tooltip (real OTooltip)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  const cases = [
    ["focus", false],
    ["hover", false],
    ["focus", true],
    ["hover", true],
  ] as const;

  it.each(cases)("opens the cause on %s (icon only: %s)", async (how, iconOnly) => {
    const errorCause = valueErrorCause(gt, { response: { status: 403 } });
    const wrapper = mount(OValue, {
      props: { state: "error", errorCause, iconOnly },
      attachTo: document.body,
    });
    const marker = wrapper.find<HTMLElement>('[tabindex="0"]');
    expect(marker.attributes("data-o-tooltip-trigger")).toBeDefined();
    if (how === "focus") marker.element.focus();
    else marker.element.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(1000);
    await nextTick();
    await nextTick();
    const content = document.body.querySelector('[data-test="o-tooltip-content"]');
    expect(content?.textContent).toContain(
      "Couldn't load: you don't have access to this data. Refresh to try again.",
    );
    expect(content?.getAttribute("data-side")).toBe("bottom");
    wrapper.unmount();
  });
});
