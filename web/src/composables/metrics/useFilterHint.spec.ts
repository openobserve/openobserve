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
import { describe, it, expect } from "vitest";
import { defineComponent, ref } from "vue";

import i18n from "@/locales";

import { useFilterHint } from "./useFilterHint";

describe("useFilterHint", () => {
  it("is a static placeholder with the org's first real label, or the empty-org line", () => {
    const names = ref<string[]>([]);
    const hint: { placeholder?: { value: string } } = {};
    mount(
      defineComponent({
        setup() {
          hint.placeholder = useFilterHint(names).placeholder;
          return () => null;
        },
      }),
      { global: { plugins: [i18n] } },
    );
    const placeholder = hint.placeholder!;
    expect(placeholder.value).toBe("Filter metrics by label");
    names.value = ["__name__", "job"];
    expect(placeholder.value).toContain("job =~");
  });
});
