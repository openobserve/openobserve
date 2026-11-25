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
import AutoResolveOutcome from "./AutoResolveOutcome.vue";

describe("AutoResolveOutcome", () => {
  it("renders the explanation as text and the run's error apart from it, in red", () => {
    const explanation = "<img src=x onerror=alert(1)> *b*\n<script>alert(2)</script>";
    const w = mount(AutoResolveOutcome, {
      props: {
        outcome: { verdict: "worked", system_summary: "Step 1 done.", explanation },
        checkedAtUs: null,
        error: "The check query timed out.",
      },
      global: { plugins: [i18n] },
    });

    expect(w.find("img, script, strong, em").exists()).toBe(false);
    expect(w.find('[data-test="autoresolve-outcome-explanation"]').text()).toBe(explanation);
    const error = w.find('[data-test="autoresolve-outcome-error"]');
    expect(error.attributes("role")).toBe("alert");
    expect(error.text()).toContain("The check query timed out.");
    w.unmount();
  });

  it("leaves the explanation to the missing-connection card when that card says it", () => {
    const w = mount(AutoResolveOutcome, {
      props: {
        outcome: {
          verdict: "no_change",
          system_summary: "No approved steps ran.",
          explanation: "needs postgres: end session 4211",
        },
        checkedAtUs: null,
        hideExplanation: true,
      },
      global: { plugins: [i18n] },
    });

    expect(w.find('[data-test="autoresolve-outcome-explanation"]').exists()).toBe(false);
    expect(w.find('[data-test="autoresolve-outcome-summary"]').text()).toBe(
      "No approved steps ran.",
    );
    w.unmount();
  });

  it.each([
    ["worked", null, "positive"],
    ["worked", "worse", "warning"],
    ["worse", "worse", "negative"],
  ] as const)("a %s outcome after a %s attempt reads %s", (verdict, prior_verdict, tone) => {
    const w = mount(AutoResolveOutcome, {
      props: {
        outcome: { verdict, prior_verdict, system_summary: "Done.", explanation: null },
        checkedAtUs: null,
      },
      global: { plugins: [i18n] },
    });

    expect(w.find('[data-test="autoresolve-outcome"]').attributes("data-tone")).toBe(tone);
    w.unmount();
  });
});
