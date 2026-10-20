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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import RcaStageStepper from "./RcaStageStepper.vue";

const mountStepper = (props: Record<string, unknown>) =>
  mount(RcaStageStepper, { props, global: { plugins: [i18n] } });

describe("RcaStageStepper (02 TH37)", () => {
  it('stage_index = 5 shows "Stage 5/7 · Log patterns" and marks the fifth stage current', () => {
    const wrapper = mountStepper({ stageIndex: 5 });

    const label = wrapper.find('[data-test="rca-stage-label"]');
    expect(label.text()).toBe("Stage 5/7 · Log patterns");
    // Each stage change is announced (a11y).
    expect(label.attributes("role")).toBe("status");
    const items = wrapper.findAll("li");
    expect(items.map((item) => item.text())).toEqual([
      "Context",
      "Topology",
      "Changes",
      "Traces",
      "Log patterns",
      "Metrics",
      "Converge",
    ]);
    expect(items.map((item) => item.attributes("aria-current") ?? "")).toEqual([
      "",
      "",
      "",
      "",
      "step",
      "",
      "",
    ]);
    expect(items[3].find('[data-state="done"]').exists()).toBe(true);
    expect(items[5].find('[data-state="todo"]').exists()).toBe(true);
  });

  it("falls back to the stage id when the index is missing", () => {
    const wrapper = mountStepper({ stageIndex: null, stage: "metrics" });

    expect(wrapper.find('[data-test="rca-stage-label"]').text()).toBe("Stage 6/7 · Metrics");
  });

  it("shows no stage line before the first stage", () => {
    const wrapper = mountStepper({ stageIndex: null, stage: null });

    expect(wrapper.find('[data-test="rca-stage-label"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-state="todo"]')).toHaveLength(7);
  });
});
