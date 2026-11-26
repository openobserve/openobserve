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
  it("renders the explanation's markdown, sanitized, and the run's error apart from it, in red", () => {
    const explanation =
      "<img src=https://x.test/p.png onerror=alert(1)> **b** and `idx`\n<script>alert(2)</script>";
    const w = mount(AutoResolveOutcome, {
      props: {
        outcome: { verdict: "worked", system_summary: "Step 1 done.", explanation },
        endedAtUs: null,
        error: "The check query timed out.",
      },
      global: { plugins: [i18n] },
    });

    const shown = w.find('[data-test="autoresolve-outcome-explanation"]');
    expect(shown.find("img, script").exists()).toBe(false);
    expect(shown.html()).not.toContain("onerror");
    expect(shown.find("strong").text()).toBe("b");
    expect(shown.find("code").text()).toBe("idx");
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
        endedAtUs: null,
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
    ["no MCP could fix", { cantFix: true }, "autoresolve.state.cantFix", "warning"],
    ["no longer needed", { notNeeded: true }, "autoresolve.state.notNeeded", "neutral"],
  ] as const)("names a run %s as its own end, ended not checked", (_case, end, label, tone) => {
    const w = mount(AutoResolveOutcome, {
      props: {
        outcome: {
          verdict: "no_change",
          system_summary: "No approved steps ran.",
          explanation: null,
        },
        endedAtUs: Date.now() * 1000,
        ...end,
      },
      global: { plugins: [i18n] },
    });

    expect(w.find("h2").text()).toBe(i18n.global.t(label));
    expect(w.find('[data-test="autoresolve-outcome"]').attributes("data-tone")).toBe(tone);
    expect(w.find('[data-test="autoresolve-outcome-at"]').text()).toMatch(/^Ended at /);
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
        endedAtUs: null,
      },
      global: { plugins: [i18n] },
    });

    expect(w.find('[data-test="autoresolve-outcome"]').attributes("data-tone")).toBe(tone);
    w.unmount();
  });
});
