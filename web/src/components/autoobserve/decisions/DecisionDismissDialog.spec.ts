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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});
vi.mock("@/services/autoobserveDecisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/autoobserveDecisions")>();
  return {
    ...actual,
    default: {
      preview: vi.fn(),
      decide: vi.fn(),
      decideBatch: vi.fn(),
      undo: vi.fn(),
      list: vi.fn(),
    },
  };
});
vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return {
    ...actual,
    default: { ...actual.default, dismissFinding: vi.fn(), listDismissals: vi.fn() },
  };
});
// The real toast store, so its de-duplication runs as it does in the app.
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>();
  return { ...actual, toast: vi.fn(actual.toast) };
});

import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { byTest } from "@/test/unit/helpers/draftDom";
import { queryClient } from "@/composables/query/queryClient";
import fixture from "@/components/autoobserve/live/__fixtures__/autoobserveDecisions.json";
import autoobserveDecisions from "@/services/autoobserveDecisions";
import alertCalibration from "@/services/alert_calibration";
import { dismissAll, toast } from "@/lib/feedback/Toast/useToast";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import DecisionDismissDialog from "./DecisionDismissDialog.vue";
import AlertCalibrationDismissDialog from "@/components/alert_calibration/AlertCalibrationDismissDialog.vue";
import type { DismissTarget } from "@/components/alert_calibration/dismissals";
import {
  decisionDismissDefaults,
  makeDecisionDismissSchema,
  PLANNED_WORK_MAX_MS,
  untilMicros,
  type DecisionTarget,
} from "./decisionDismiss";

const t = i18n.global.t as unknown as TranslateFn;
const FINDING = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";
const target: DecisionTarget = { family: "suggestion", id: "s-cluster-d", title: "cluster-d" };

const httpError = (status: number, data: unknown = { code: status, message: "server words" }) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

let wrapper: VueWrapper | null = null;

const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  }
};
const click = async (selector: string) => {
  const el = document.body.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  el.click();
  await settle();
};
const chooseReason = (reason: string) => click(`[data-test="decision-dismiss-reason-${reason}"]`);
const submit = () => click('[data-test="decision-dismiss-submit"]');
const submitButton = () => byTest("decision-dismiss-submit") as HTMLButtonElement;

const mountDialog = async () => {
  wrapper = mount(DecisionDismissDialog, {
    props: {
      open: true,
      target,
      "onUpdate:open": (open: boolean) => wrapper?.setProps({ open }),
    },
    attachTo: document.body,
    global: { plugins: [store, withQueryClient(queryClient)] },
  });
  await settle();
  return wrapper;
};

describe("DecisionDismissDialog", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(toast).mockClear();
    dismissAll();
    for (const fn of Object.values(autoobserveDecisions)) vi.mocked(fn).mockReset();
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({ data: fixture.list } as never);
    vi.mocked(autoobserveDecisions.preview).mockResolvedValue({ data: fixture.preview } as never);
    vi.mocked(autoobserveDecisions.decide).mockResolvedValue({ data: fixture.decided } as never);
    vi.mocked(autoobserveDecisions.undo).mockResolvedValue({ data: fixture.undone } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("planned_work_needs_an_end_within_seven_days", () => {
    const now = new Date(2026, 10, 9, 14, 5).getTime();
    const schema = makeDecisionDismissSchema(t, () => now);
    const errors = (reason: string, at: number | null) => {
      const until = at === null ? { untilDate: "", untilTime: "" } : decisionDismissDefaults(at);
      const result = schema.safeParse({ ...until, reason });
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(errors("planned_work", null)).toEqual([t("insight.decisions.dismiss.untilRequired")]);
    expect(errors("planned_work", now + PLANNED_WORK_MAX_MS + 3_600_000)).toEqual([
      t("insight.decisions.dismiss.untilInvalid"),
    ]);
    expect(errors("planned_work", now - 3 * 3_600_000)).toEqual([
      t("insight.decisions.dismiss.untilInvalid"),
    ]);
    expect(errors("planned_work", now)).toEqual([]);
    expect(errors("not_needed", null)).toEqual([]);
    expect(errors("", now)).toEqual([t("insight.decisions.dismiss.reasonRequired")]);
  });

  it.each(["not_needed", "false_positive", "will_fix_later"])(
    "sends_the_body_for_%s_without_an_end",
    async (reason) => {
      await mountDialog();
      await chooseReason(reason);
      await submit();
      expect(autoobserveDecisions.decide).toHaveBeenCalledTimes(1);
      const [org, body] = vi.mocked(autoobserveDecisions.decide).mock.calls[0];
      expect(org).toBe("default");
      expect(body).toEqual({
        family: "suggestion",
        id: "s-cluster-d",
        action: "dismiss",
        reason,
        request_id: expect.any(String),
      });
    },
  );

  it("sends_planned_work_with_its_end_and_previews_that_end", async () => {
    await mountDialog();
    await chooseReason("planned_work");
    await submit();
    const body = vi.mocked(autoobserveDecisions.decide).mock.calls[0][1];
    const form = decisionDismissDefaults(Date.now());
    expect(body).toMatchObject({ reason: "planned_work", until: untilMicros(form) });
    expect(vi.mocked(autoobserveDecisions.preview).mock.calls.at(-1)?.[1]).toEqual({
      family: "suggestion",
      id: "s-cluster-d",
      action: "dismiss",
      reason: "planned_work",
      until: untilMicros(form),
    });
  });

  it("shows_the_effect_from_the_preview_without_ids", async () => {
    await mountDialog();
    const effect = byTest("decision-dismiss-effect");
    expect(effect?.getAttribute("data-state")).toBe("ready");
    expect(effect?.textContent).toContain("Hidden for everyone in default Organization until");
    expect(byTest("decision-dismiss-dialog")?.textContent).toContain(
      "Dismiss “cluster-d k8s_events”?",
    );
    expect(byTest("decision-dismiss-dialog")?.textContent).not.toContain("s-cluster-d");
    expect(byTest("decision-dismiss-dialog")?.textContent).not.toContain("planned_work");
  });

  it("locks_from_a_may_false_preview", async () => {
    vi.mocked(autoobserveDecisions.preview).mockResolvedValue({
      data: fixture.preview_locked,
    } as never);
    await mountDialog();
    expect(byTest("decision-dismiss-locked")?.textContent).toContain(
      fixture.preview_locked.locked.message,
    );
    expect(byTest("decision-dismiss-locked")?.querySelector("[data-test], svg, span")).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    await chooseReason("not_needed");
    await submit();
    expect(autoobserveDecisions.decide).not.toHaveBeenCalled();
  });

  it("locks_from_a_403_refusal_and_says_it_in_red", async () => {
    vi.mocked(autoobserveDecisions.decide).mockRejectedValue(httpError(403, fixture.refused));
    await mountDialog();
    await chooseReason("not_needed");
    await submit();
    const notice = byTest("decision-dismiss-notice");
    expect(notice?.getAttribute("data-severity")).toBe("error");
    expect(notice?.textContent).toContain(fixture.refused.message);
    expect(submitButton().disabled).toBe(true);
    expect(wrapper?.props("open")).toBe(true);
  });

  it("a_conflict_is_amber_and_never_shows_server_words", async () => {
    vi.mocked(autoobserveDecisions.decide).mockRejectedValue(httpError(409, fixture.conflict));
    await mountDialog();
    await chooseReason("will_fix_later");
    await submit();
    const notice = byTest("decision-dismiss-notice");
    expect(notice?.getAttribute("data-severity")).toBe("warning");
    expect(notice?.textContent).toContain(t("insight.decisions.error.changed"));
    expect(notice?.textContent).not.toContain("finding_changed");
  });

  it("the_undo_toast_sends_the_revision_the_write_returned", async () => {
    await mountDialog();
    await chooseReason("not_needed");
    await submit();
    expect(wrapper?.props("open")).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
    const options = vi.mocked(toast).mock.calls[0][0];
    expect(String(options.message)).toMatch(
      /^Dismissed until Nov 6, 18:00: cluster-d k8s_events\.$/,
    );
    expect(options.action?.label).toBe("Undo");
    options.action?.handler();
    await settle();
    expect(autoobserveDecisions.undo).toHaveBeenCalledWith(
      "default",
      fixture.decided.decision.decision_id,
      { expected_revision: fixture.decided.decision.revision, request_id: expect.any(String) },
    );
    expect(String(vi.mocked(toast).mock.calls.at(-1)?.[0].message)).toBe(
      "Undone: cluster-d k8s_events is shown again.",
    );
  });
});

describe("AlertCalibrationDismissDialog transport", () => {
  const finding = {
    finding_id: FINDING,
    rule_id: "no_destination",
    scope_kind: "alert",
    scope_key: "a1",
    alert_name: "ops_cpu",
  } as DismissTarget;

  const mountCalibration = async () => {
    wrapper = mount(AlertCalibrationDismissDialog, {
      props: { open: false, finding },
      attachTo: document.body,
      global: { plugins: [store, withQueryClient(queryClient)] },
    });
    await settle();
    await wrapper.setProps({ open: true });
    await settle();
  };

  beforeEach(() => {
    queryClient.clear();
    for (const fn of Object.values(autoobserveDecisions)) vi.mocked(fn).mockReset();
    vi.mocked(alertCalibration.dismissFinding).mockReset();
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue({
      data: { items: [], next_cursor: null, total: 0 },
    } as never);
    vi.mocked(autoobserveDecisions.preview).mockResolvedValue({ data: fixture.preview } as never);
    vi.mocked(autoobserveDecisions.decide).mockResolvedValue({ data: fixture.decided } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("with_the_switch_off_it_keeps_the_compat_route_and_todays_form", async () => {
    vi.mocked(autoobserveDecisions.list).mockRejectedValue(httpError(404));
    vi.mocked(alertCalibration.dismissFinding).mockResolvedValue({
      data: { id: FINDING, expires_at: null, state: "active", revision: 1 },
    } as never);
    await mountCalibration();
    expect(byTest("alert-calibration-dismiss-dialog")).toBeTruthy();
    expect(byTest("decision-dismiss-dialog")).toBeNull();
    await click('[data-test="alert-calibration-dismiss-reason-expected"]');
    await click('[data-test="alert-calibration-dismiss-submit"]');
    expect(alertCalibration.dismissFinding).toHaveBeenCalledTimes(1);
    expect(autoobserveDecisions.decide).not.toHaveBeenCalled();
    expect(autoobserveDecisions.preview).not.toHaveBeenCalled();
  });

  const mountOpen = async () => {
    wrapper = mount(AlertCalibrationDismissDialog, {
      props: {
        open: true,
        finding,
        "onUpdate:open": (open: boolean) => wrapper?.setProps({ open }),
      },
      attachTo: document.body,
      global: { plugins: [store, withQueryClient(queryClient)] },
    });
    await settle();
  };

  it("a_cold_mount_already_open_waits_for_the_switch_then_writes_through_the_route", async () => {
    let answer!: (value: unknown) => void;
    vi.mocked(autoobserveDecisions.list).mockReturnValue(
      new Promise((resolve) => (answer = resolve)) as never,
    );
    await mountOpen();
    expect(byTest("alert-calibration-dismiss-dialog")).toBeNull();
    expect(byTest("decision-dismiss-effect")?.getAttribute("data-state")).toBe("loading");
    expect(submitButton().disabled).toBe(true);
    answer({ data: fixture.list });
    await settle();
    expect(byTest("alert-calibration-dismiss-dialog")).toBeNull();
    await chooseReason("not_needed");
    await submit();
    expect(alertCalibration.dismissFinding).not.toHaveBeenCalled();
    expect(autoobserveDecisions.decide).toHaveBeenCalledTimes(1);
  });

  it("a_failed_switch_check_never_falls_back_and_a_new_opening_checks_again", async () => {
    vi.mocked(autoobserveDecisions.list).mockRejectedValue(httpError(500));
    await mountOpen();
    expect(byTest("alert-calibration-dismiss-dialog")).toBeNull();
    expect(byTest("decision-dismiss-effect")?.getAttribute("data-state")).toBe("error");
    expect(byTest("decision-dismiss-effect")?.textContent).toContain(
      t("insight.decisions.dismiss.effectFailed"),
    );
    expect(submitButton().disabled).toBe(true);
    await wrapper!.setProps({ open: false });
    await settle();
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({ data: fixture.list } as never);
    await wrapper!.setProps({ open: true });
    await settle();
    expect(byTest("decision-dismiss-effect")?.getAttribute("data-state")).toBe("ready");
    await chooseReason("not_needed");
    await submit();
    expect(autoobserveDecisions.decide).toHaveBeenCalledTimes(1);
    expect(alertCalibration.dismissFinding).not.toHaveBeenCalled();
  });

  it("each_opening_picks_the_transport_afresh", async () => {
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({ data: fixture.list } as never);
    await mountCalibration();
    expect(byTest("decision-dismiss-dialog")).toBeTruthy();
    await wrapper!.setProps({ open: false });
    await settle();
    queryClient.setQueryData(autoobserveKeys.decisionsEnabled("default"), false);
    await settle();
    await wrapper!.setProps({ open: true });
    await settle();
    expect(byTest("decision-dismiss-dialog")).toBeNull();
    expect(byTest("alert-calibration-dismiss-dialog")).toBeTruthy();
  });

  it("with_the_switch_on_it_posts_the_finding_through_the_decision_route", async () => {
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({ data: fixture.list } as never);
    await mountCalibration();
    expect(byTest("decision-dismiss-dialog")).toBeTruthy();
    await chooseReason("not_needed");
    await submit();
    expect(alertCalibration.dismissFinding).not.toHaveBeenCalled();
    expect(vi.mocked(autoobserveDecisions.decide).mock.calls[0][1]).toEqual({
      family: "alert_finding",
      id: FINDING,
      action: "dismiss",
      reason: "not_needed",
      request_id: expect.any(String),
    });
  });
});
