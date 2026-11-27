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
import store from "@/test/unit/helpers/store";
import type { AutoResolveRun } from "@/services/autoresolve";
import { autoresolveRun } from "@/test/unit/fixtures/autoresolveRun";
import AutoResolveVerdictCheck from "./AutoResolveVerdictCheck.vue";

let wrapper: VueWrapper | undefined;

const mountCheck = (overrides: Partial<AutoResolveRun>) => {
  wrapper = mount(AutoResolveVerdictCheck, {
    props: { run: autoresolveRun({ state: "worked", ...overrides }), submitting: null },
    global: { plugins: [i18n, store], provide: { store } },
    attachTo: document.body,
  });
  return wrapper;
};

const ALERT = {
  kind: "alert",
  label: "Started by the alert checkout_errors_high",
  by: "the alert checkout_errors_high",
  alert_id: "a-1",
};

afterEach(() => wrapper?.unmount());

describe("AutoResolveVerdictCheck", () => {
  it("Yes records that it fixed it, without planning again", async () => {
    const w = mountCheck({});

    await w.find('[data-test="autoresolve-verdict-yes"]').trigger("click");
    expect(w.emitted("fixed")).toEqual([[]]);
    expect(w.emitted("replan")).toBeUndefined();
  });

  // An alert's run starts the note from the alert; a person's run starts it empty.
  it.each<[string, Partial<AutoResolveRun>, string, boolean]>([
    [
      "an alert run of a saved AutoResolve",
      { trigger: ALERT, autoresolve: { id: "af-1", name: "Checkout is slow" } },
      "The alert checkout_errors_high is still firing",
      true,
    ],
    ["a person's run from the goal box", {}, "", false],
  ])("No, it didn't plans again as not fixed for %s", async (_case, run, prefill, saved) => {
    const w = mountCheck(run);

    await w.find('[data-test="autoresolve-verdict-no"]').trigger("click");
    const note = w.find('[data-test="autoresolve-verdict-note"] input');
    expect((note.element as HTMLInputElement).value).toBe(prefill);
    expect(w.find('[data-test="autoresolve-remember-checkbox"]').exists()).toBe(saved);
    const planAgain = w.find('[data-test="autoresolve-verdict-plan-again"]');
    expect(planAgain.attributes("disabled")).toBe(prefill ? undefined : "");
    if (!prefill) await note.setValue("Errors are still high");

    await planAgain.trigger("click");
    expect(w.emitted("replan")).toEqual([
      [{ note: prefill || "Errors are still high", kind: "not_fixed", remember: saved }],
    ]);
  });

  it("a person's Fixed for this attempt replaces the question", () => {
    const w = mountCheck({
      revision: 2,
      person_verdict: {
        verdict: "fixed",
        note: null,
        by: "lead@example.com",
        at_us: 1,
        revision: 2,
      },
    });

    expect(w.find('[data-test="autoresolve-verdict-question"]').exists()).toBe(false);
    expect(w.find('[data-test="autoresolve-verdict-fixed"]').text()).toContain("lead@example.com");
  });
});
