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
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

import i18n from "@/locales";

import { useFilterHint } from "@/composables/metrics/useFilterHint";
import { useJsPlaceholder, useVrlPlaceholder } from "@/composables/useVrlPlaceholder";

function run<T>(fn: () => T): T {
  let out!: T;
  mount(
    defineComponent({
      setup() {
        out = fn();
        return () => h("div");
      },
    }),
    { global: { plugins: [i18n] } },
  );
  return out;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("static editor placeholders on the v2 path", () => {
  it("names the language once, with no typing animation", () => {
    vi.useFakeTimers();
    const vrl = run(() => useVrlPlaceholder());
    const js = run(() => useJsPlaceholder());
    expect(vrl.placeholder.value).toBe('Write a VRL function, for example: .status = "active"');
    vi.advanceTimersByTime(5_000);
    expect(vrl.placeholder.value).toBe('Write a VRL function, for example: .status = "active"');
    expect(js.placeholder.value).toBe("Write a JavaScript function, for example: return event");
  });

  it("uses the org's first real label name in the metrics filter hint", () => {
    const names = ref(["__name__", "_o2_id", "pod"]);
    const hint = run(() => useFilterHint(names));
    expect(hint.placeholder.value).toBe('Filter, for example: pod =~ "500|503"');
    names.value = [];
    expect(hint.placeholder.value).toBe("Filter metrics by label");
  });
});
