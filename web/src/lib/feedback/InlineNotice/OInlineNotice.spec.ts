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
import OInlineNotice from "./OInlineNotice.vue";

describe("OInlineNotice", () => {
  it("is a status, not an alert, and shows its sentence", () => {
    const wrapper = mount(OInlineNotice, {
      props: { text: "No log stream has logs for this trace.", dataTest: "notice" },
    });
    const root = wrapper.get('[data-test="notice"]');
    expect(root.attributes("role")).toBe("status");
    expect(root.text()).toContain("No log stream has logs for this trace.");
    expect(root.classes()).toContain("bg-status-warning-bg");
    expect(root.classes()).toContain("text-status-warning-text");
    expect(root.attributes("data-variant")).toBe("warning");
  });

  it("is a red alert in the error variant", () => {
    const wrapper = mount(OInlineNotice, {
      props: { text: "Couldn't load: the server returned an error.", variant: "error" },
    });
    const root = wrapper.get('[data-test="inline-notice"]');
    expect(root.attributes("role")).toBe("alert");
    expect(root.attributes("data-variant")).toBe("error");
    expect(root.classes()).toContain("bg-status-error-bg");
    expect(root.classes()).toContain("text-status-error-text");
    expect(root.classes()).not.toContain("bg-status-warning-bg");
  });

  it("renders no action without a label", () => {
    const wrapper = mount(OInlineNotice, { props: { text: "Nothing here." } });
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("emits action from a real button that never truncates", async () => {
    const wrapper = mount(OInlineNotice, {
      props: { text: "Nothing here.", actionLabel: "Open Logs tab", actionDataTest: "open" },
    });
    const button = wrapper.get('[data-test="open"]');
    expect(button.element.tagName).toBe("BUTTON");
    expect(button.attributes("type")).toBe("button");
    expect(button.classes()).toContain("shrink-0");
    expect(button.classes()).toContain("whitespace-nowrap");
    await button.trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
  });
});
