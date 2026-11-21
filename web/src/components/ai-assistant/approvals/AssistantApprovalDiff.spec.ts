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

import AssistantApprovalDiff from "./AssistantApprovalDiff.vue";

const LONG = "SELECT count(*) FROM app_logs WHERE level = 'error' ".repeat(4).trim();

describe("AssistantApprovalDiff", () => {
  it("expands only the row pressed when two rows share a field name", async () => {
    const rows = ["A", "B"].map((name) => ({
      field: raw("Query"),
      value: raw(`${name}: ${LONG}`),
      before: null,
    }));
    const wrapper = mount(AssistantApprovalDiff, { props: { rows, dataTest: "diff" } });
    const values = () => wrapper.findAll('[data-test="assistant-approval-diff-after"]');
    expect(values()).toHaveLength(2);
    await wrapper.findAll('[data-test="assistant-approval-diff-expand"]')[1].trigger("click");
    expect(values()[0].text().endsWith("…")).toBe(true);
    expect(values()[1].text()).toBe(`B: ${LONG}`);
  });

  it("says an unknown old value in plain words, never struck through as one being replaced", () => {
    const wrapper = mount(AssistantApprovalDiff, {
      props: {
        rows: [
          {
            field: raw("Title"),
            value: raw("Ops v2"),
            before: raw("Current value unknown"),
            beforeUnknown: true,
          },
          { field: raw("Owner"), value: raw("ana"), before: raw("bo") },
        ],
      },
    });
    const unknown = wrapper.get('[data-test="assistant-approval-diff-before-unknown"]');
    expect(unknown.element.tagName).toBe("SPAN");
    expect(unknown.text()).toBe("Current value unknown");
    expect(wrapper.findAll("s").map((s) => s.text())).toEqual(["bo"]);
  });
});
