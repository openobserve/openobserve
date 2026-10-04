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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import TracesDrillDownPage from "./TracesDrillDownPage.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

function mountPage(props: Record<string, unknown> = {}): VueWrapper<any> {
  return mount(TracesDrillDownPage, {
    attachTo: document.body,
    props: { open: true, title: "Volume Insights", ...props },
    slots: {
      "header-left": '<span data-test="header-left-content" />',
      default: '<div data-test="body-content"><input data-test="inner-input" /></div>',
    },
  });
}

describe("TracesDrillDownPage", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should render the back button, title, header and body slots", () => {
    wrapper = mountPage();

    expect(wrapper.find('[data-test="traces-drill-down-back-btn"]').text()).toContain(
      "traces.backToResults",
    );
    expect(wrapper.text()).toContain("Volume Insights");
    expect(wrapper.find('[data-test="header-left-content"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="body-content"]').exists()).toBe(true);
  });

  it("should focus the Back button on mount", () => {
    wrapper = mountPage();

    expect(document.activeElement).toBe(
      wrapper.find('[data-test="traces-drill-down-back-btn"]').element,
    );
  });

  it("should return focus to the Drill down button on close", () => {
    const drillDown = document.createElement("button");
    drillDown.setAttribute("data-test", "insights-button");
    document.body.appendChild(drillDown);
    wrapper = mountPage();

    wrapper.unmount();

    expect(document.activeElement).toBe(drillDown);
    drillDown.remove();
  });

  it("should render nothing when closed", () => {
    wrapper = mountPage({ open: false });

    expect(wrapper.find('[data-test="traces-drill-down-back-btn"]').exists()).toBe(false);
  });

  it("should emit update:open=false when Back is clicked", async () => {
    wrapper = mountPage();

    await wrapper.find('[data-test="traces-drill-down-back-btn"]').trigger("click");
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("should close on Escape pressed inside the page", async () => {
    wrapper = mountPage();

    const input = wrapper.find('[data-test="inner-input"]').element as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("should ignore Escape from elements outside the page, such as teleported popovers", async () => {
    wrapper = mountPage();
    const outside = document.createElement("div");
    document.body.appendChild(outside);

    outside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(wrapper.emitted("update:open")).toBeUndefined();
    outside.remove();
  });

  it("should ignore Escape another handler already consumed", async () => {
    wrapper = mountPage();

    const input = wrapper.find('[data-test="inner-input"]').element as HTMLInputElement;
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    input.dispatchEvent(event);
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("should stop listening for Escape after unmount", async () => {
    wrapper = mountPage();
    const emitted = wrapper.emitted();
    wrapper.unmount();

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(emitted["update:open"]).toBeUndefined();
  });
});
