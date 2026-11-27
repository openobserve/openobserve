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
import { defineComponent, h, nextTick, ref } from "vue";

import { useComposerWidth, type ComposerWidth } from "./useComposerWidth";

let resize: (() => void) | null = null;

class FakeObserver {
  constructor(callback: () => void) {
    resize = callback;
  }
  observe(): void {}
  disconnect(): void {}
}

async function measured(px: number): Promise<ComposerWidth> {
  let width: ComposerWidth | null = null;
  const Host = defineComponent({
    setup() {
      const root = ref<HTMLElement | null>(null);
      width = useComposerWidth(root);
      return () => h("div", { ref: root });
    },
  });
  const wrapper = mount(Host);
  vi.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue({ width: px } as DOMRect);
  resize?.();
  await nextTick();
  return width!;
}

describe("useComposerWidth", () => {
  vi.stubGlobal("ResizeObserver", FakeObserver);
  afterEach(() => {
    resize = null;
  });

  it("names the agent from 24.5 rem up, and keeps only its icon below that", async () => {
    expect((await measured(398)).agentIconOnly.value).toBe(false);
    expect((await measured(392)).agentIconOnly.value).toBe(false);
    expect((await measured(391)).agentIconOnly.value).toBe(true);
    expect((await measured(356)).agentIconOnly.value).toBe(true);
  });

  it("never drops the name before the composer is measured", async () => {
    expect((await measured(0)).agentIconOnly.value).toBe(false);
  });
});
