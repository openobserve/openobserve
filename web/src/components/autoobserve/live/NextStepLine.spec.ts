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

import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import autoobserveDecisions from "@/services/autoobserveDecisions";
import type { AutoObserveIssueContext } from "@/services/autoobserve";
import NextStepLine from "./NextStepLine.vue";

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push: vi.fn() }),
}));

enableAutoUnmount(afterEach);

const AT_US = Date.UTC(2026, 10, 16, 14, 12) * 1000;

const withStep = (stepId: string): AutoObserveIssueContext => ({
  causes: { top: [], more: 0 },
  impact: [],
  classes: [],
  window: [AT_US, AT_US],
  asked_at: AT_US,
  settled: true,
  checks: [],
  hidden: 0,
  region_only: false,
  next_step: {
    step: {
      step_id: stepId,
      source: "ai",
      action: "check_only",
      label: "",
      why: `Step ${stepId}`,
      cites: [],
      at: AT_US,
      run_id: "r1",
    },
    state: "ready",
    judged: null,
    issue_id: "d1",
  },
});

const sel = (name: string) => `[data-test="autoobserve-next-step-line-${name}"]`;

describe("NextStepLine", () => {
  it.each([
    ["saved", true],
    ["refused", false],
  ])("a judgement %s after the step changed never lands on the new step", async (_name, ok) => {
    let settle: (ok: boolean) => void = () => undefined;
    vi.spyOn(autoobserveDecisions, "decide").mockReturnValue(
      new Promise((resolve, reject) => {
        settle = (yes) => (yes ? resolve({ data: {} } as never) : reject(new Error("refused")));
      }),
    );
    const wrapper = mount(NextStepLine, {
      props: { context: withStep("a"), nowMs: AT_US / 1000 },
      global: {
        plugins: [i18n, store, [VueQueryPlugin, { queryClient: new QueryClient() }]],
      },
    });
    await wrapper.get(sel("not-helpful")).trigger("click");
    expect(autoobserveDecisions.decide).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "d1", step_id: "a" }),
    );
    await wrapper.setProps({ context: withStep("b") });
    settle(ok);
    await flushPromises();
    const button = wrapper.get(sel("not-helpful"));
    expect(button.attributes("aria-pressed")).toBe("false");
    expect(wrapper.get(sel("note")).attributes("data-note")).toBe("ai");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
