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
    // What the host really passes: the expanded count, already including the child's 13 steps.
    const w = mountPicker({ ownStepCount: 16 });
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    expect(syntheticsService.get).toHaveBeenCalledTimes(1);
    expect(w.emitted("update:modelValue")![0][0]).toEqual({ id: "login-test", name: "Login" });
    // 3 own steps before this reference existed, 16 executed after it resolves.
    expect(w.find('[data-test="synthetics-subtest-delta"]').text()).toContain("3 → 16");
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
    // A 0-step child adds nothing; the old arithmetic rendered "4 \u2192 3", backwards.
    expect(w.find('[data-test="synthetics-subtest-delta"]').text()).toContain("4 \u2192 4");
    expect(w.find('[data-test="synthetics-subtest-lastrun"]').exists()).toBe(false);
    // Design 5.11 state 3: show the delta only AND say the time impact is unknown.
    expect(w.find('[data-test="synthetics-subtest-lastrun-unknown"]').exists()).toBe(true);
  });

  it("counts the child's steps once, not twice", async () => {
    // The host's count already includes the pick, so adding the child again double-counts it.
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: new Array(3).fill({ id: "c", action: "click" }) } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [] },
    });
    const w = mountPicker({ ownStepCount: 4 });
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    expect(w.find('[data-test="synthetics-subtest-delta"]').text()).toContain("1 \u2192 4");
  });

  it("withholds the delta entirely when the host cannot expand the journey", async () => {
    // `ownStepCount` is undefined whenever `expandJourney` throws; inventing a number there lies.
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: new Array(13).fill({ id: "c", action: "click" }) } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [] },
    });
    const w = mountPicker({ ownStepCount: undefined });
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    expect(w.find('[data-test="synthetics-subtest-delta"]').exists()).toBe(false);
    expect(w.text()).not.toContain("0 \u2192");
    expect(w.find('[data-test="synthetics-subtest-delta-unknown"]').exists()).toBe(true);
  });

  it("withholds the delta when the host count cannot contain the child", async () => {
    // Re-picking a bigger child: the host's count still describes the previous one, so it is
    // stale. Subtracting anyway rendered a negative "before" against the old child's name.
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: new Array(10).fill({ id: "c", action: "click" }) } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [] },
    });
    const w = mountPicker({ ownStepCount: 3 });
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    expect(w.find('[data-test="synthetics-subtest-delta"]').exists()).toBe(false);
    expect(w.text()).not.toMatch(/-\d+/);
    expect(w.find('[data-test="synthetics-subtest-delta-unknown"]').exists()).toBe(true);
  });
});
