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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import SloAlertCondition from "./SloAlertCondition.vue";

const listSpy = vi.fn().mockResolvedValue({ data: { list: [] } });
vi.mock("@/services/slos", () => ({
  default: {
    list: (...args: any[]) => listSpy(...args),
  },
}));

const slo = (overrides: Record<string, any> = {}) => ({
  id: "slo-123",
  name: "checkout-availability",
  target: 99.9,
  window_secs: 30 * 86400,
  slice_interval_secs: 300,
  group_by: [],
  ...overrides,
});

/** A REACTIVE model object, matching how the component writes: it mutates the
 *  v-model target in place rather than replacing it. */
const emptyCondition = () =>
  reactive<Record<string, any>>({
    slo_id: "",
    kind: "burn_rate",
    operator: ">",
    critical: null,
    warning: null,
    long_window_secs: null,
    short_window_secs: null,
    multi_alert: false,
  });

const mountWith = async (model: Record<string, any>, props: Record<string, any> = {}) => {
  const wrapper = mount(SloAlertCondition, {
    props: { modelValue: model, slo: slo(), ...props },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
};

describe("SloAlertCondition", () => {
  beforeEach(() => listSpy.mockClear());

  // On the SLO page the SLO is CONTEXT, not a choice. Refetching the whole
  // list per mount would also mean an N-SLO request on a page that already
  // knows its SLO.
  it("does not fetch the SLO list when the SLO is supplied", async () => {
    await mountWith(emptyCondition());
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("does not render an SLO selector when the SLO is supplied", async () => {
    const wrapper = await mountWith(emptyCondition());
    expect(wrapper.find('[data-test="slos-sloalertcondition-slo-trigger"]').exists()).toBe(false);
  });

  it("adopts the supplied SLO's id into the condition", async () => {
    const model = emptyCondition();
    await mountWith(model);
    expect(model.slo_id).toBe("slo-123");
  });

  // The component writes through `defineModel` by MUTATING the bound object.
  // A parent that passes a fresh literal (or a computed) on each open would
  // silently lose every preset click and keystroke, with no error.
  it("writes preset values into the same object it was given", async () => {
    const model = emptyCondition();
    const wrapper = await mountWith(model);

    await wrapper.find('[data-test="slos-sloalertcondition-preset-fast"]').trigger("click");
    await flushPromises();

    expect(model.critical).toBeGreaterThan(0);
    expect(model.long_window_secs).toBeGreaterThan(0);
    expect(model.short_window_secs).toBeGreaterThan(0);
  });

  it.each([
    [7, ["10%", "20%", "40%"]],
    [30, ["2%", "5%", "10%"]],
    [90, ["1%", "3%", "5%"]],
  ])("shows the correct budget fractions for a %d-day SLO", async (days, fractions) => {
    const wrapper = await mountWith(emptyCondition(), {
      slo: slo({ window_secs: days * 86400 }),
    });

    for (const [key, fraction] of ["fast", "mid", "slow"].map((key, index) => [
      key,
      fractions[index],
    ])) {
      expect(wrapper.find(`[data-test="slos-sloalertcondition-preset-${key}"]`).text()).toContain(
        fraction,
      );
    }
  });

  // SA-8: a window must be an exact multiple of the slice interval and span at
  // least two slices. The published fast-burn row uses a 5-minute short window,
  // which is exactly ONE slice on a 5-minute SLO — unsavable as published.
  it("snaps a preset's short window onto the slice grid, at least two slices", async () => {
    const model = emptyCondition();
    const wrapper = await mountWith(model);

    await wrapper.find('[data-test="slos-sloalertcondition-preset-fast"]').trigger("click");
    await flushPromises();

    expect(model.short_window_secs % 300).toBe(0);
    expect(model.short_window_secs).toBeGreaterThanOrEqual(600);
  });

  // SA-6: a burn rate above 100/(100 - target) needs an error rate over 100%
  // and can never fire. The component already computes that ceiling for
  // display; offering a preset above it hands the user an unsavable form.
  it("never offers a preset above the SA-6 burn-rate ceiling", async () => {
    const lowTarget = slo({ target: 90 }); // ceiling = 10
    const model = emptyCondition();
    const wrapper = await mountWith(model, { slo: lowTarget });

    for (const key of ["fast", "mid", "slow"]) {
      const btn = wrapper.find(`[data-test="slos-sloalertcondition-preset-${key}"]`);
      if (!btn.exists()) continue;
      await btn.trigger("click");
      await flushPromises();
      expect(model.critical).toBeLessThanOrEqual(10);
    }
  });

  // Per-group fan-out is rejected for EVERY SLO — grouped or not — so offering
  // the control can only produce a permanent 400.
  it("never offers the multi-alert checkbox, which the backend always rejects", async () => {
    const wrapper = await mountWith(emptyCondition(), {
      slo: slo({ group_by: ["region"] }),
    });
    expect(wrapper.find('[data-test="slos-sloalertcondition-multi"]').exists()).toBe(false);
  });

  // Switching kind resets thresholds by design, but the reset must not fire
  // while POPULATING an existing alert — that silently rewrites stored
  // thresholds the moment the user opens the edit form.
  it("keeps the thresholds of an error-budget condition it is given", async () => {
    const model = reactive<Record<string, any>>({
      slo_id: "slo-123",
      kind: "error_budget",
      operator: ">",
      critical: 90,
      warning: 75,
      long_window_secs: null,
      short_window_secs: null,
    });

    await mountWith(model);

    expect(model.critical).toBe(90);
    expect(model.warning).toBe(75);
  });
});
