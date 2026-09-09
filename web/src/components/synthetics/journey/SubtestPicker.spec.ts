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
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";
import en from "@/locales/languages/en-US.json";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import SubtestPicker from "./SubtestPicker.vue";

vi.mock("@/services/synthetics", () => ({
  default: {
    listByFolderId: vi.fn(),
    get: vi.fn(),
    getRuns: vi.fn(),
  },
}));

import syntheticsService from "@/services/synthetics";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

const CHECKS = [
  { id: "self", name: "Checkout", type: "browser" },
  { id: "login-test", name: "Login", type: "browser" },
  { id: "api-1", name: "Orders API", type: "http" },
];

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(SubtestPicker, {
    props: { ownCheckId: "self", ownStepCount: 4, ...props },
    global: { plugins: [store, i18n] },
  });
}

describe("SubtestPicker", () => {
  it("mounts and renders the picker select", async () => {
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    const w = mountPicker();
    await flushPromises();
    // Precondition: the component actually mounted and rendered a select —
    // otherwise every assertion below that reads its props is vacuous.
    expect(w.find('[data-test="synthetics-subtest-picker"]').exists()).toBe(true);
    expect(w.findComponent(OSelect).exists()).toBe(true);
  });

  it("offers every other browser check and never itself or a protocol check", async () => {
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    const w = mountPicker();
    await flushPromises();
    expect(w.findComponent(OSelect).props("options")).toEqual([
      { label: "Login", value: "login-test" },
    ]);
  });

  it("emits the reference and states the executed-step delta and the run time", async () => {
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: new Array(13).fill({ id: "c", action: "click" }) } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [{ created_at: 0, completed_at: 20_000_000 }] },
    });
    const w = mountPicker();
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    expect(syntheticsService.get).toHaveBeenCalledTimes(1);
    expect(w.emitted("update:modelValue")![0][0]).toEqual({ id: "login-test", name: "Login" });
    // 4 executed now, one of them replaced by the child's 13 → 16.
    expect(w.find('[data-test="synthetics-subtest-delta"]').text()).toContain("4 → 16");
    expect(w.find('[data-test="synthetics-subtest-lastrun"]').text()).toContain("20");
  });

  it("shows the delta alone when the child has never completed a run", async () => {
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: [] } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [] },
    });
    const w = mountPicker();
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();
    // Assert the node is absent rather than matching copy, which changes with the locale.
    expect(w.find('[data-test="synthetics-subtest-delta"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-subtest-lastrun"]').exists()).toBe(false);
  });
});
