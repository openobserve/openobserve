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

import AssistantIconButton from "./AssistantIconButton.vue";
import type { AssistantIconButtonProps } from "./AssistantIconButton.types";

const base: AssistantIconButtonProps = {
  label: raw("Close"),
  icon: "close",
  dataTest: "assistant-shell-close",
};

const mountButton = (props: Partial<AssistantIconButtonProps> = {}) =>
  mount(AssistantIconButton, { props: { ...base, ...props } });

describe("AssistantIconButton", () => {
  it("is named by its label and carries its data-test", () => {
    const button = mountButton().get('[data-test="assistant-shell-close"]');
    expect(button.element.tagName).toBe("BUTTON");
    expect(button.attributes("aria-label")).toBe("Close");
  });

  it("renders the glyph decoratively", () => {
    const icon = mountButton().find("svg, span[aria-hidden]");
    expect(icon.exists()).toBe(true);
  });

  it("maps sizes onto the OButton icon sizes", () => {
    expect(mountButton().get("button").classes()).toContain("h-8");
    expect(mountButton({ size: "toolbar" }).get("button").classes()).toContain("size-[1.875rem]");
  });

  it("grows to a 2.75 rem target below md and on coarse pointers", () => {
    const classes = mountButton().get("button").classes();
    for (const cls of [
      "max-md:min-h-11",
      "max-md:min-w-11",
      "pointer-coarse:min-h-11",
      "pointer-coarse:min-w-11",
    ]) {
      expect(classes).toContain(cls);
    }
  });

  it("renders aria-pressed only when pressed is given", () => {
    expect(mountButton().get("button").attributes("aria-pressed")).toBeUndefined();
    expect(mountButton({ pressed: true }).get("button").attributes("aria-pressed")).toBe("true");
    expect(mountButton({ pressed: false }).get("button").attributes("aria-pressed")).toBe("false");
  });

  it("emits click", async () => {
    const wrapper = mountButton();
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("stays focusable and describes why when disabled with a reason", async () => {
    const wrapper = mountButton({ disabled: true, disabledReason: raw("Send a message first") });
    const button = wrapper.get("button");
    expect(button.attributes("disabled")).toBeUndefined();
    expect(button.attributes("aria-disabled")).toBe("true");
    const describedBy = button.attributes("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(wrapper.get(`[id="${describedBy}"]`).text()).toBe("Send a message first");
    await button.trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("is a plain disabled button without a reason", () => {
    const button = mountButton({ disabled: true }).get("button");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("aria-describedby")).toBeUndefined();
  });
});
