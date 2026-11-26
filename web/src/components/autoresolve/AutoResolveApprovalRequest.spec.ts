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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { axiosReply } from "@/test/unit/helpers/mockService";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/autoresolve", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { startRun: vi.fn() } });
});

import autoresolve, {
  type AutoResolveApprover,
  type AutoResolveCorrectionUsed,
  type AutoResolvePlanCorrectionKind,
  type AutoResolveRun,
} from "@/services/autoresolve";
import {
  autoresolveOption,
  autoresolveRun,
  autoresolveStep,
} from "@/test/unit/fixtures/autoresolveRun";
import AutoResolveApprovalRequest from "./AutoResolveApprovalRequest.vue";

router.addRoute({
  name: "autoresolveRun",
  path: "/autoresolve/runs/:id",
  component: { render: () => null },
});
router.addRoute({ name: "autoresolve", path: "/autoresolve", component: { render: () => null } });

const APPROVE = '[data-test="autoresolve-approval-approve"]';
const OPTIONS = '[data-test="autoresolve-approval-options"]';
const CHANGES = '[data-test="autoresolve-approval-changes-line"]';
const CORRECT = '[data-test="autoresolve-approval-correct"]';
const PANEL = '[data-test="autoresolve-correction-panel"]';
const NOTE = '[data-test="autoresolve-correction-note"] textarea';
const kindChip = (kind: string) => `[data-test="autoresolve-correction-kind-${kind}"]`;
const option = (id: string) => `[data-test="autoresolve-approval-option"][data-test-value="${id}"]`;

const OPTION_A = autoresolveOption({
  id: "A",
  title: "Revert",
  recommended: true,
  changes: [{ name: "postgres", short_description: "shop primary" }],
});
const OPTION_B = autoresolveOption({
  id: "B",
  title: "Patch directly",
  recommended: false,
  steps: [autoresolveStep({ id: "step-b1", tool: "patch_resource" })],
  changes: ["nats", "redis", "k8s", "git", "deploy"].map((name) => ({
    name,
    short_description: name === "redis" ? "cache" : null,
  })),
});

let wrapper: VueWrapper | undefined;
type Refusal = { optionId: string; approvers: AutoResolveApprover[] } | null;

const mountRequest = (run: AutoResolveRun, refused: Refusal = null, removedIds: string[] = []) => {
  wrapper = mount(AutoResolveApprovalRequest, {
    props: { run, submitting: false, refused, removedIds },
    global: { plugins: [i18n, store, router], provide: { store } },
    attachTo: document.body,
  });
  return wrapper;
};

const withOptions = (...options: ReturnType<typeof autoresolveOption>[]) =>
  autoresolveRun({
    plan: {
      fingerprint: "fp-1",
      options,
      omitted_count: 0,
      omitted_reason: null,
      missing_capability: null,
    },
  });

afterEach(() => {
  wrapper?.unmount();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("AutoResolveApprovalRequest", () => {
  it("approves the picked option with its id; recommended is first and preselected", async () => {
    const run = withOptions(OPTION_B, OPTION_A);
    const w = mountRequest(run);

    const radios = w.find(OPTIONS).findAll('[data-test="autoresolve-approval-option"]');
    expect(radios.map((r) => r.attributes("data-test-value"))).toEqual(["A", "B"]);
    expect(w.find(option("A")).attributes("data-state")).toBe("checked");

    await w.find(APPROVE).trigger("click");
    await w.find(option("B")).trigger("click");
    await w.find(APPROVE).trigger("click");
    expect(w.emitted("approve")).toEqual([["A"], ["B"]]);

    // A fresh snapshot of the same plan keeps the pick.
    await w.setProps({ run: { ...run } });
    expect(w.find(option("B")).attributes("data-state")).toBe("checked");
  });

  it("shows a single option as its card", async () => {
    const w = mountRequest(withOptions(OPTION_A));

    expect(w.find(OPTIONS).findAll('[data-test="autoresolve-approval-option"]')).toHaveLength(1);
    expect(w.findAll('[data-test="autoresolve-step-card"]')).toHaveLength(1);
    await w.find(APPROVE).trigger("click");
    expect(w.emitted("approve")).toEqual([["A"]]);
  });

  it("names the MCPs the picked option changes", async () => {
    const w = mountRequest(withOptions(OPTION_A, OPTION_B));

    expect(w.findAll(CHANGES)).toHaveLength(1);
    expect(w.find(CHANGES).text()).toBe("Approving changes the postgres MCP (shop primary).");

    await w.find(option("B")).trigger("click");
    expect(w.findAll(CHANGES)).toHaveLength(1);
    expect(w.find(CHANGES).text()).toBe(
      "Approving changes the nats, redis (cache), k8s, and 2 more MCPs.",
    );
  });

  it("a partial option carries its tag and never the Recommended one", () => {
    const partial = autoresolveOption({
      recommended: true,
      partial_fix: "restarts the whole database",
    });
    const w = mountRequest(withOptions(partial));

    expect(w.find('[data-test="autoresolve-approval-recommended"]').exists()).toBe(false);
    expect(w.find('[data-test="autoresolve-approval-partial-fix"]').exists()).toBe(true);
    expect(w.find('[data-test="autoresolve-approval-partial-fix-text"]').text()).toContain(
      "restarts the whole database",
    );
  });

  // The panel takes the footer's place; an untouched draft names the option the person looked at.
  const SAVED = { id: "af-1", name: "Orders are backing up" };
  it.each<[AutoResolvePlanCorrectionKind, AutoResolveRun["autoresolve"], boolean, boolean]>([
    ["wrong_cause", SAVED, false, true],
    ["wrong_fix", SAVED, true, false],
    ["out_of_scope", null, false, false],
  ])(
    "sends a %s correction with the picked option and the person's note",
    async (kind, autoresolve, uncheck, remember) => {
      const w = mountRequest({ ...withOptions(OPTION_A, OPTION_B), autoresolve });
      await w.find(option("B")).trigger("click");
      await w.find('[data-test="autoresolve-approval-correct"]').trigger("click");

      expect(w.find(APPROVE).exists()).toBe(false);
      const send = w.find('[data-test="autoresolve-correction-send"]');
      expect(send.attributes("disabled")).toBeDefined();
      // Before a kind is picked the note takes no typing and no Tab stop, but must not look disabled.
      const empty = w.find(NOTE);
      expect(["disabled", "readonly", "tabindex"].map((a) => empty.attributes(a))).toEqual([
        undefined,
        "",
        "-1",
      ]);
      await w.find(`[data-test="autoresolve-correction-kind-${kind}"]`).trigger("click");
      const note = w.find(NOTE);
      expect([note.attributes("readonly"), note.attributes("tabindex")]).toEqual([
        undefined,
        undefined,
      ]);
      expect((note.element as HTMLTextAreaElement).value).toContain("Patch directly");
      await note.setValue("Only the consumer is wrong.");
      const box = w.find('[data-test="autoresolve-remember-checkbox"]');
      expect(box.exists()).toBe(!!autoresolve);
      if (uncheck) await box.find("button").trigger("click");

      await w.find('[data-test="autoresolve-correction-send"]').trigger("click");
      expect(w.emitted("replan")).toEqual([
        [{ note: "Only the consumer is wrong.", kind, remember, option_id: "B" }],
      ]);
    },
  );

  const used = (n: number): AutoResolveCorrectionUsed[] =>
    Array.from({ length: n }, (_, i) => ({
      kind: "wrong_fix",
      note: `Note ${i}`,
      created_by: "lead@example.com",
      created_at_us: 1_700_000_000_000_000 + i,
      run_id: "run-1",
      this_run: true,
    }));
  it.each([0, 1, 4])("the plan made with %i corrections says so on its chip", async (count) => {
    const w = mountRequest({ ...withOptions(OPTION_A), corrections_used: used(count) });

    const chip = w.find('[data-test="autoresolve-corrections-used"]');
    expect(chip.exists()).toBe(count > 0);
    if (!count) return;
    expect(chip.text()).toContain(String(count));
    await chip.trigger("click");
    await flushPromises();
    const rows = document.querySelectorAll('[data-test="autoresolve-corrections-used-row"]');
    expect(rows).toHaveLength(Math.min(count, 3));
    const more = document.querySelector('[data-test="autoresolve-corrections-used-more"]');
    expect(more !== null).toBe(count > 3);
    if (more) expect(more.textContent).toContain(String(count - 3));
  });

  it("the draft follows the picked kind until the person edits it", async () => {
    const w = mountRequest(withOptions(OPTION_A));
    await w.find(CORRECT).trigger("click");
    const note = () => (w.find(NOTE).element as HTMLTextAreaElement).value;

    await w.find(kindChip("wrong_cause")).trigger("click");
    const causeDraft = note();
    await w.find(kindChip("wrong_fix")).trigger("click");
    expect(note()).not.toBe(causeDraft);
    await w.find(kindChip("wrong_fix")).trigger("click");
    expect(w.find(kindChip("wrong_fix")).attributes("data-state")).toBe("on");
    expect(note()).toContain("Revert");
    await w.find(NOTE).setValue("Only the consumer is wrong.");
    await w.find(kindChip("out_of_scope")).trigger("click");
    expect(note()).toBe("Only the consumer is wrong.");
  });

  // A fast replan goes from one waiting plan to the next with no other state in between.
  const NEXT_PLAN = withOptions(OPTION_B);
  it.each<[string, Record<string, unknown>]>([
    ["the server accepted it", { replansSent: 1 }],
    [
      "the next plan arrived",
      { run: { ...NEXT_PLAN, revision: 2, plan: { ...NEXT_PLAN.plan!, fingerprint: "fp-2" } } },
    ],
  ])("closes the correction panel once %s, so Approve is back", async (_case, next) => {
    const w = mountRequest(withOptions(OPTION_A));
    await w.find(CORRECT).trigger("click");
    expect(w.find(PANEL).exists()).toBe(true);

    await w.setProps(next);
    expect(w.find(PANEL).exists()).toBe(false);
    expect(w.find(APPROVE).exists()).toBe(true);
  });

  // A 403 names approvers the run did not: the viewer may approve another option, not this one.
  // A removed connection is read from the run on load, or from a 409 before the run says so.
  const CHECKOUT = { id: "c-old", name: "checkout-ops" };
  const viaCheckout = (removed: boolean) =>
    autoresolveOption({ steps: [autoresolveStep({ connection: { ...CHECKOUT, removed } })] });
  it.each<[string, AutoResolveRun, Refusal, string[], string, string[], boolean]>([
    [
      "the run says the viewer cannot approve",
      { ...withOptions(OPTION_A), can_approve: false },
      null,
      [],
      "cannot-approve",
      ["Role sre", "Org admins"],
      false,
    ],
    [
      "approving the picked option was refused",
      withOptions(OPTION_A),
      { optionId: "A", approvers: [{ kind: "group", name: "sre-oncall" }] },
      [],
      "cannot-approve",
      ["sre-oncall"],
      false,
    ],
    [
      "the run marks the option's connection removed",
      withOptions(viaCheckout(true)),
      null,
      [],
      "connection-removed",
      ["checkout-ops"],
      true,
    ],
    [
      "approving was refused as the connection was removed",
      withOptions(viaCheckout(false)),
      null,
      ["c-old"],
      "connection-removed",
      ["checkout-ops"],
      true,
    ],
    [
      "a viewer who may not replan sees a removed connection",
      { ...withOptions(viaCheckout(true)), can_approve: false },
      null,
      [],
      "connection-removed",
      ["checkout-ops"],
      false,
    ],
  ])(
    "replaces the button row with a red notice when %s",
    async (_case, run, refused, removedIds, notice, names, mayReplan) => {
      const w = mountRequest(run, refused, removedIds);

      expect(w.find(APPROVE).exists()).toBe(false);
      const shown = w.find(`[data-test="autoresolve-approval-${notice}"]`);
      expect(shown.attributes("data-variant")).toBe("error");
      for (const name of names) expect(shown.text()).toContain(name);
      const ask = w.find('[data-test="autoresolve-approval-ask"]');
      expect(ask.exists()).toBe(mayReplan);
      if (!mayReplan) return;

      await ask.trigger("click");
      const note = w.find('[data-test="autoresolve-approval-replan-note"] textarea');
      expect((note.element as HTMLTextAreaElement).value).toContain("checkout-ops");
    },
  );

  it("warns in amber when other runs changed the plan's MCPs, and opens the newest", async () => {
    const NOTICE = '[data-test="autoresolve-approval-changed-since-plan"]';
    expect(mountRequest(withOptions(OPTION_A)).find(NOTICE).exists()).toBe(false);
    wrapper?.unmount();
    const changed_since_plan = [
      { connection: "postgres", run_id: "r-new", at_us: 2 },
      { connection: "postgres", run_id: "r-old", at_us: 1 },
    ];
    const w = mountRequest({ ...withOptions(OPTION_A), changed_since_plan });

    const notice = w.find(NOTICE);
    expect(notice.attributes("data-variant")).toBe("warning");
    expect(notice.text()).toContain("postgres");
    expect(w.find(APPROVE).exists()).toBe(true);
    await w.find('[data-test="autoresolve-approval-changed-run"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params.id).toBe("r-new");
  });

  const GIT = { id: "c-git", name: "Code host (infra repo)" };
  const GONE = { id: "c-old", name: "checkout-ops", removed: true };
  it("a lapsed request starts again with the same goal and the run's connections still there", async () => {
    vi.mocked(autoresolve).startRun.mockResolvedValue(axiosReply({ run_id: "run-2" }));
    const run: AutoResolveRun = {
      ...withOptions(OPTION_A),
      state: "lapsed",
      connections: [GIT, GONE],
    };
    const w = mountRequest(run);

    expect(w.find(APPROVE).exists()).toBe(false);
    await w.find('[data-test="autoresolve-approval-start-again"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(autoresolve).startRun).toHaveBeenCalledWith(expect.any(String), {
      goal: run.goal,
      connection_ids: ["c-git"],
    });
    expect(router.currentRoute.value.params.id).toBe("run-2");
  });

  it("a lapsed request whose connections were all removed links to choosing new ones", () => {
    const run: AutoResolveRun = { ...withOptions(OPTION_A), state: "lapsed", connections: [GONE] };
    const w = mountRequest(run);

    expect(w.find('[data-test="autoresolve-approval-start-again"]').exists()).toBe(false);
    expect(w.find('[data-test="autoresolve-approval-start-again-removed"]').text()).toContain(
      i18n.global.t("autoresolve.approval.connectionsGone"),
    );
    const href = w.find('[data-test="autoresolve-approval-choose-connections"]').attributes("href");
    expect(new URL(href ?? "", "http://x").searchParams.get("goal")).toBe(run.goal);
  });

  it("a refused start again says why and links to choosing new connections", async () => {
    const gone = "A chosen connection no longer exists. Choose your connections again.";
    vi.mocked(autoresolve).startRun.mockRejectedValue({
      response: { status: 400, data: { code: 400, message: gone } },
    });
    const run: AutoResolveRun = { ...withOptions(OPTION_A), state: "lapsed", connections: [GIT] };
    const w = mountRequest(run);

    await w.find('[data-test="autoresolve-approval-start-again"]').trigger("click");
    await flushPromises();
    const refused = w.find('[data-test="autoresolve-approval-start-again-error"]');
    expect(refused.text()).toBe(gone);
    expect(refused.attributes("data-variant")).toBe("error");
    const href = w.find('[data-test="autoresolve-approval-choose-connections"]').attributes("href");
    expect(new URL(href ?? "", "http://x").searchParams.get("goal")).toBe(run.goal);
  });
});
