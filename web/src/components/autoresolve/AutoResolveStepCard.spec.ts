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

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import type { AutoResolveStep } from "@/services/autoresolve";
import { autoresolveStep } from "@/test/unit/fixtures/autoresolveRun";
import { RCA_T0, sec } from "@/test/unit/fixtures/rcaThread";
import AutoResolveStepCard from "./AutoResolveStepCard.vue";

const MARKUP = "<img src=x onerror=alert(1)> *b*";

let wrapper: VueWrapper | undefined;

const mountCard = (step: AutoResolveStep, nowUs?: number) => {
  wrapper = mount(AutoResolveStepCard, { props: { step, nowUs }, global: { plugins: [i18n] } });
  return wrapper;
};

afterEach(() => wrapper?.unmount());

describe("AutoResolveStepCard", () => {
  it("step_card_sanitizes_reason", () => {
    const w = mountCard(autoresolveStep({ reason: MARKUP }));

    expect(w.find("img, script").exists()).toBe(false);
    expect(w.find('[data-test="autoresolve-step-card-reason"]').html()).not.toContain("onerror");
  });

  it("step_card_caps_long_arguments", async () => {
    const args = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]));
    const w = mountCard(autoresolveStep({ arguments: args }));
    const block = () => w.findComponent(OCodeBlock);

    expect(block().props("maxLines")).toBe(20);
    expect(block().props("code")).toBe(JSON.stringify(args, null, 2));

    await w.find('[data-test="autoresolve-step-card-args-toggle"]').trigger("click");
    expect(block().props("maxLines")).toBeUndefined();
    expect(block().text()).toContain('"k4999": 4999');
  });

  it.each([
    { dryRunAfter: true, preview: false, line: true },
    { dryRunAfter: false, preview: true, line: false },
  ])(
    "shows the after-approval dry-run line in place of the preview (dry run after approval: $dryRunAfter)",
    ({ dryRunAfter, preview, line }) => {
      const w = mountCard(
        autoresolveStep({ preview: "1 file changed, 1 line", dry_run_after_approval: dryRunAfter }),
      );

      expect(w.find('[data-test="autoresolve-step-card-preview"]').exists()).toBe(preview);
      expect(w.find('[data-test="autoresolve-step-card-dry-run-after"]').exists()).toBe(line);
    },
  );

  it.each([
    ["the same text as its error", "relation exists", false],
    ["its own text", "ran 2 of 3", true],
  ])("a failed step whose result is %s: result line shown %s", (_, result, shown) => {
    const w = mountCard(
      autoresolveStep({ state: "failed", result_summary: result, error: "relation exists" }),
    );

    expect(w.find('[data-test="autoresolve-step-card-result"]').exists()).toBe(shown);
    expect(w.find('[data-test="autoresolve-step-card-error"]').text()).toBe("relation exists");
  });

  it.each([
    ["running", "Running for 1 min 20 s"],
    ["done", "Done"],
  ] as const)("a %s step's state says how long it has run", (state, label) => {
    const w = mountCard(autoresolveStep({ state, consumed_at_us: RCA_T0 }), RCA_T0 + sec(80));

    expect(w.find('[data-test="autoresolve-step-card-state"]').text()).toBe(label);
  });
});
