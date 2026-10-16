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
import RcaThreadStep from "./RcaThreadStep.vue";
import { rcaStep, rcaToolCall } from "@/test/unit/fixtures/rcaThread";
import type { RcaStep } from "@/services/incidents";

const mountStep = (step: RcaStep, runLive = false) =>
  mount(RcaThreadStep, { props: { step, runLive }, global: { plugins: [i18n] } });

describe("RcaThreadStep (02 TH38)", () => {
  it("shows title, UTC time, the note with citation chips, and the calls line", () => {
    const wrapper = mountStep(rcaStep());

    expect(wrapper.find('[data-test="rca-thread-step-title"]').text()).toBe(
      "Load incident context",
    );
    expect(wrapper.text()).toContain("08:53:24");
    expect(wrapper.find('[data-test="rca-thread-step-note"]').text()).toMatch(
      /^Checkout errors rose at 08:52\s*e3\s*after the deploy\s*e7\s*\.$/,
    );
    expect(wrapper.findAll('[data-test="rca-citation-chip"]').map((chip) => chip.text())).toEqual([
      "e3",
      "e7",
    ]);
    // 1.2 s + 0.3 s.
    expect(wrapper.find('[data-test="rca-thread-step-calls-toggle"]').text()).toBe(
      "2 tool calls · 1.5s",
    );
    expect(wrapper.find('[data-test="rca-thread-step-working"]').exists()).toBe(false);
  });

  it("a finished step keeps its tool rows collapsed until opened", async () => {
    const wrapper = mountStep(rcaStep());
    expect(wrapper.find('[data-test="rca-thread-step-calls"]').exists()).toBe(false);

    const toggle = wrapper.find('[data-test="rca-thread-step-calls-toggle"]');
    await toggle.trigger("click");

    // a11y: the toggle controls the list it opens.
    const controls = toggle.attributes("aria-controls");
    expect(controls).toBeTruthy();
    expect(wrapper.find(`[id="${controls}"]`).attributes("data-test")).toBe(
      "rca-thread-step-calls",
    );

    const rows = wrapper.findAll('[data-test="rca-tool-call"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("SearchSQL");
    expect(rows[0].text()).toContain("42 rows");
    expect(rows[0].text()).toContain("OK · 1.2s");
    expect(rows[1].text()).toContain("get_topology");
    expect(rows[1].text()).toContain("Error");
  });

  it("the running step of a live run is open and shows the working text", () => {
    const wrapper = mountStep(
      rcaStep({
        ended_at: null,
        note: null,
        tool_calls: [rcaToolCall({ status: "running", duration_ms: null })],
      }),
      true,
    );

    const working = wrapper.find('[data-test="rca-thread-step-working"]');
    expect(working.text()).toBe("Working. Messages sent now are read after this turn.");
    expect(working.attributes("role")).toBe("status");
    expect(wrapper.find('[data-test="rca-thread-step-calls-toggle"]').text()).toBe(
      "1 tool call · 0.0s · running",
    );
    expect(wrapper.findAll('[data-test="rca-tool-call"]')).toHaveLength(1);
  });

  it("an unfinished step of a stopped run is not running", () => {
    const wrapper = mountStep(rcaStep({ ended_at: null }), false);

    expect(wrapper.find('[data-test="rca-thread-step-working"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="rca-thread-step-calls"]').exists()).toBe(false);
  });

  it("a step without calls or note shows only its title", () => {
    const wrapper = mountStep(rcaStep({ note: null, citations: [], tool_calls: [] }));

    expect(wrapper.find('[data-test="rca-thread-step-note"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="rca-thread-step-calls-toggle"]').exists()).toBe(false);
  });
});
