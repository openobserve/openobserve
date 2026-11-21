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

import AssistantComposerBottomRow from "./AssistantComposerBottomRow.vue";

const SLOTS = ["plus", "agent", "mic", "send"] as const;

function stubs(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, `<button data-test="${name}-stub" />`]));
}

function order(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll("[data-test$='-stub']")
    .map((node) => node.attributes("data-test")!.replace("-stub", ""));
}

describe("AssistantComposerBottomRow", () => {
  it("keeps one order in every host, on one line that never wraps", () => {
    const wrapper = mount(AssistantComposerBottomRow, {
      slots: stubs([...SLOTS].reverse()),
    });
    const row = wrapper.get('[data-test="assistant-composer-bar"]');
    expect(row.classes()).toContain("flex-nowrap");
    expect(row.classes().some((name) => name.startsWith("gap-y"))).toBe(false);
    expect(row.classes().some((name) => name.startsWith("border"))).toBe(false);
    expect(order(wrapper)).toEqual([...SLOTS]);
    const left = row.get('[data-test="assistant-composer-bar-left"]');
    expect(left.find('[data-test="plus-stub"]').exists()).toBe(true);
    const right = row.get('[data-test="assistant-composer-bar-right"]');
    expect(right.find('[data-test="agent-stub"]').exists()).toBe(true);
  });

  it("shows the recording block after + only while dictating; agent, mic and Send stay", () => {
    const wrapper = mount(AssistantComposerBottomRow, {
      props: { dictating: true },
      slots: stubs([...SLOTS, "recording"]),
    });
    expect(order(wrapper)).toEqual(["plus", "recording", "agent", "mic", "send"]);
    const idle = mount(AssistantComposerBottomRow, { slots: stubs([...SLOTS, "recording"]) });
    expect(order(idle)).toEqual([...SLOTS]);
  });
});
