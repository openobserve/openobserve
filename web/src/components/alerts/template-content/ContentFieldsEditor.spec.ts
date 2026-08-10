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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import ContentFieldsEditor from "./ContentFieldsEditor.vue";
import type { ContentField } from "./contentSpec";

function mountEditor(rows: ContentField[]) {
  return mount(ContentFieldsEditor, {
    props: {
      rows,
      valueKey: "value",
      labelLabel: "Label",
      valueLabel: "Value",
      addLabel: "Add field",
      dataTestPrefix: "test-fields",
      "onUpdate:rows": vi.fn(),
    },
    global: { plugins: [i18n] },
  });
}

describe("ContentFieldsEditor", () => {
  it("renders one row block per row", () => {
    const rows: ContentField[] = [
      { label: "Severity", value: "{alert_severity}" },
      { label: "Count", value: "{alert_count}" },
    ];
    const w = mountEditor(rows);
    expect(w.find('[data-test="test-fields-row-0"]').exists()).toBe(true);
    expect(w.find('[data-test="test-fields-row-1"]').exists()).toBe(true);
    expect(w.find('[data-test="test-fields-row-2"]').exists()).toBe(false);
  });

  it("emits update:rows with a new blank row appended on add", async () => {
    const rows: ContentField[] = [{ label: "A", value: "{a}" }];
    const w = mountEditor(rows);

    await w.find('[data-test="test-fields-add-btn"]').trigger("click");

    const emitted = w.emitted("update:rows");
    expect(emitted).toBeTruthy();
    const next = emitted![0][0] as ContentField[];
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ label: "", value: "", show_when: null });
  });

  it("emits update:rows with the row removed", async () => {
    const rows: ContentField[] = [
      { label: "A", value: "{a}" },
      { label: "B", value: "{b}" },
    ];
    const w = mountEditor(rows);

    await w.find('[data-test="test-fields-row-0-remove-btn"]').trigger("click");

    const next = w.emitted("update:rows")![0][0] as ContentField[];
    expect(next).toHaveLength(1);
    expect(next[0].label).toBe("B");
  });

  it("moves a row down/up and disables the boundary move buttons", async () => {
    const rows: ContentField[] = [
      { label: "A", value: "{a}" },
      { label: "B", value: "{b}" },
    ];
    const w = mountEditor(rows);

    // First row: move-up disabled, move-down enabled.
    expect(
      w.find('[data-test="test-fields-row-0-move-up-btn"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      w.find('[data-test="test-fields-row-1-move-down-btn"]').attributes("disabled"),
    ).toBeDefined();

    await w.find('[data-test="test-fields-row-0-move-down-btn"]').trigger("click");

    const next = w.emitted("update:rows")![0][0] as ContentField[];
    expect(next.map((r) => r.label)).toEqual(["B", "A"]);
  });

  it("sets show_when to null when the severity selection is cleared", async () => {
    const rows: ContentField[] = [
      { label: "A", value: "{a}", show_when: { levels: ["critical"] } },
    ];
    const w = mountEditor(rows);
    const vm = w.vm as any;

    vm.updateShowWhen(0, []);
    await w.vm.$nextTick();

    const next = w.emitted("update:rows")!.at(-1)![0] as ContentField[];
    expect(next[0].show_when).toBeNull();
  });
});
