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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { PickerResult } from "@/composables/rum/useProductAnalytics";

const mockPa = vi.hoisted(() => ({
  scopeKey: { value: "s1" },
  loadPicker: vi.fn(),
  searchPicker: vi.fn(),
}));
vi.mock("@/composables/rum/useProductAnalytics", () => ({
  default: () => mockPa,
  PICKER_LIMIT: 200,
}));

import StepPicker from "./StepPicker.vue";

const page = (key: string) => ({ kind: "p" as const, key, sessions: 1 });
const full = (n: number): PickerResult => ({
  status: "ok",
  options: Array.from({ length: n }, (_, i) => page(`/p${i}`)),
});

let wrapper: VueWrapper | null = null;
const mountPicker = () => {
  wrapper = mount(StepPicker, {
    props: {
      modelValue: null,
      placeholder: "Pick a step" as never,
      events: [],
      dataTest: "pa-step-picker",
    },
    attachTo: document.body,
  });
  return wrapper;
};
const select = (w: VueWrapper) => w.findComponent(OSelect);
const values = (w: VueWrapper) =>
  (select(w).props("options") as { value: string }[]).map((o) => o.value);

describe("StepPicker", () => {
  beforeEach(() => {
    mockPa.scopeKey = ref("s1");
    mockPa.loadPicker.mockReset();
    mockPa.searchPicker.mockReset();
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("a failed load says so and retries on the next open instead of caching an empty list (W16)", async () => {
    mockPa.loadPicker
      .mockResolvedValueOnce({ status: "error", options: [] })
      .mockResolvedValueOnce({ status: "ok", options: [page("/a")] });
    const w = mountPicker();
    select(w).vm.$emit("open");
    await flushPromises();
    expect(select(w).props("errorMessage")).toBeTruthy();
    select(w).vm.$emit("open");
    await flushPromises();
    expect(mockPa.loadPicker).toHaveBeenCalledTimes(2);
    expect(select(w).props("errorMessage")).toBeFalsy();
    expect(values(w)).toContain("p:/a");
  });

  it("a failed load shows the error inside the dropdown instead of 'No options found' (o2-enterprise#2800)", async () => {
    mockPa.loadPicker.mockResolvedValue({ status: "error", options: [] });
    const w = mountPicker();
    await w.find("button").trigger("click");
    await flushPromises();
    const empty = document.body.querySelector('[data-test="pa-step-picker-empty-error"]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBeTruthy();
    expect(document.body.textContent).not.toContain("No options found");
  });

  it("drops server search results when the scope changes (W16)", async () => {
    mockPa.loadPicker.mockResolvedValue(full(200));
    mockPa.searchPicker.mockResolvedValue({ status: "ok", options: [page("/deep")] });
    const w = mountPicker();
    select(w).vm.$emit("open");
    await flushPromises();
    select(w).vm.$emit("search", "deep");
    await flushPromises();
    expect(values(w)).toContain("p:/deep");
    mockPa.scopeKey.value = "s2";
    await flushPromises();
    expect(values(w)).not.toContain("p:/deep");
  });

  it("a failed search says so (W16)", async () => {
    mockPa.loadPicker.mockResolvedValue(full(200));
    mockPa.searchPicker.mockResolvedValue({ status: "error", options: [] });
    const w = mountPicker();
    select(w).vm.$emit("open");
    await flushPromises();
    select(w).vm.$emit("search", "deep");
    await flushPromises();
    expect(select(w).props("errorMessage")).toBeTruthy();
  });
});
