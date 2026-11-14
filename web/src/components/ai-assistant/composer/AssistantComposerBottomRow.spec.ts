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

describe("AssistantComposerBottomRow", () => {
  it("keeps the agent side and the action side on one line at any width: it never wraps", () => {
    const wrapper = mount(AssistantComposerBottomRow, {
      props: { divided: true },
      slots: {
        agent: '<button data-test="agent-stub" />',
        default: '<button data-test="send-stub" />',
      },
    });
    const row = wrapper.get('[data-test="assistant-composer-bar"]');
    expect(row.classes()).toContain("flex-nowrap");
    expect(row.classes()).not.toContain("flex-wrap");
    expect(row.classes().some((name) => name.startsWith("gap-y"))).toBe(false);
    expect(
      row
        .get('[data-test="assistant-composer-bar-left"]')
        .find('[data-test="agent-stub"]')
        .exists(),
    ).toBe(true);
    expect(
      row
        .get('[data-test="assistant-composer-bar-right"]')
        .find('[data-test="send-stub"]')
        .exists(),
    ).toBe(true);
  });
});
