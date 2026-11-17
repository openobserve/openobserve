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
import { fillField } from "@/test/unit/helpers/fillField";
import { queryClient } from "@/composables/query/queryClient";
import fixture from "@/components/autoobserve/live/__fixtures__/autoobserveDecisions.json";
import autoobserveDecisions from "@/services/autoobserveDecisions";
import alertCalibration from "@/services/alert_calibration";
import { dismissAll, toast } from "@/lib/feedback/Toast/useToast";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import type { DecisionRequest } from "@/services/autoobserveDecisions";
import DecisionDismissDialog from "./DecisionDismissDialog.vue";
import AlertCalibrationDismissDialog from "@/components/alert_calibration/AlertCalibrationDismissDialog.vue";
import type { DismissTarget } from "@/components/alert_calibration/dismissals";
import {
  DECISION_DISMISS_REASONS,
  decisionBodyOf,
  decisionDismissDefaults,
  makeDecisionDismissSchema,
  PLANNED_WORK_MAX_MS,
  previewParamsOf,
  untilMicros,
  type DecisionTarget,
} from "./decisionDismiss";

const t = i18n.global.t as unknown as TranslateFn;
const FINDING = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";
const target: DecisionTarget = { family: "suggestion", id: "s-cluster-d", title: "cluster-d" };
const calTarget: DecisionTarget = { family: "alert_finding", id: FINDING, title: "ops_cpu" };

// ENT autoobserve/decisions.rs check_term, so every body the dialog builds is one the route takes.
const routeTermError = (body: DecisionRequest, nowMs: number): string | null => {
  const reopened = body.until_reopened ?? false;
  if (body.reason === "planned_work") {
    if (body.until === undefined || body.duration_days !== undefined || reopened) {
      return "until_required";
    }
    const ok = body.until > nowMs * 1000 && body.until <= (nowMs + PLANNED_WORK_MAX_MS) * 1000;
    return ok ? null : "until_invalid";
  }
  if (body.until !== undefined) return "until_unexpected";
  if (body.duration_days === undefined) return reopened ? null : "duration_invalid";
  return !reopened && [30, 90, 180].includes(body.duration_days) ? null : "duration_invalid";
};

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

const chooseDuration = (value: string) =>
  click(`[data-test="decision-dismiss-duration-option"][data-test-value="${value}"]`);
const durationOff = (value: string) => {
  const el = document.body.querySelector<HTMLElement>(
    `[data-test="decision-dismiss-duration-option"][data-test-value="${value}"]`,
  );
  if (!el) throw new Error(`missing duration ${value}`);
  return el.hasAttribute("disabled") || el.hasAttribute("data-disabled");
};

const mountDialog = async (on: DecisionTarget = target) => {
  wrapper = mount(DecisionDismissDialog, {
    props: {
      open: true,
      target: on,
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

  it("leaves_date_checks_to_the_schema_not_the_browser", async () => {
    await mountDialog();
    expect(
      document.body
        .querySelector('[data-test="decision-dismiss-dialog"] form')
        ?.hasAttribute("novalidate"),
    ).toBe(true);
  });

  it("planned_work_needs_an_end_within_seven_days", () => {
    const now = new Date(2026, 10, 9, 14, 5).getTime();
    const schema = makeDecisionDismissSchema(t, () => now);
    const errors = (reason: string, at: number | null) => {
      const until =
        at === null
          ? { ...decisionDismissDefaults(now), untilDate: "", untilTime: "" }
          : decisionDismissDefaults(at);
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

  it("an_end_out_of_range_is_flagged_on_the_part_that_is_out_of_range", () => {
    const now = new Date(2026, 10, 9, 14, 5).getTime();
    const schema = makeDecisionDismissSchema(t, () => now);
    const paths = (untilDate: string, untilTime: string) => {
      const form = {
        ...decisionDismissDefaults(now),
        reason: "planned_work",
        untilDate,
        untilTime,
      };
      const result = schema.safeParse(form);
      return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    };
    expect(paths("2026-11-26", "03:00")).toEqual(["untilDate"]);
    expect(paths("2026-11-08", "16:00")).toEqual(["untilDate"]);
    expect(paths("2026-11-09", "13:00")).toEqual(["untilTime"]);
    expect(paths("2026-11-16", "15:00")).toEqual(["untilTime"]);
  });

  it.each(["not_needed", "false_positive", "will_fix_later"])(
    "sends_the_body_for_%s_with_the_routes_default_term",
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
        duration_days: 90,
        request_id: expect.any(String),
      });
      expect(vi.mocked(autoobserveDecisions.preview).mock.calls.at(-1)?.[1]).toEqual({
        family: "suggestion",
        id: "s-cluster-d",
        action: "dismiss",
        reason,
        duration_days: 90,
      });
    },
  );

  it.each(["suggestion", "alert_finding"] as const)(
    "every_reason_builds_a_body_the_route_takes_and_previews_the_same_term_for_%s",
    (family) => {
      const now = new Date(2026, 10, 9, 14, 5).getTime();
      const on: DecisionTarget = { family, id: "x", title: null };
      for (const reason of DECISION_DISMISS_REASONS) {
        const form = { ...decisionDismissDefaults(now), reason };
        const body = decisionBodyOf(on, form, { requestId: "r1", revision: 0 });
        expect([reason, routeTermError(body, now)]).toEqual([reason, null]);
        const { request_id: _id, note: _note, ...asked } = body;
        expect(previewParamsOf(on, form, now)).toEqual(asked);
      }
    },
  );

  it("a_calibration_finding_without_a_hide_for_is_caught_before_save", () => {
    const now = new Date(2026, 10, 9, 14, 5).getTime();
    const schema = makeDecisionDismissSchema(
      t,
      () => now,
      () => "alert_finding",
    );
    const form = { ...decisionDismissDefaults(now), reason: "not_needed", duration: "" };
    const result = schema.safeParse(form);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toEqual([
      t("insight.decisions.dismiss.durationRequired"),
    ]);
    expect(previewParamsOf(calTarget, form as never, now)).toEqual({
      family: "alert_finding",
      id: FINDING,
      action: "dismiss",
    });
    const suggestion = makeDecisionDismissSchema(
      t,
      () => now,
      () => "suggestion",
    );
    expect(suggestion.safeParse(form).success).toBe(true);
  });

  it("a_calibration_finding_offers_hide_for_and_a_note_and_a_suggestion_does_not", async () => {
    await mountDialog(calTarget);
    const options = [
      ...document.body.querySelectorAll('[data-test="decision-dismiss-duration-option"]'),
    ];
    expect(options.map((o) => o.getAttribute("data-test-value"))).toEqual([
      "30",
      "90",
      "180",
      "until_reopened",
    ]);
    expect(byTest("decision-dismiss-duration")?.textContent).toContain("Hide for");
    expect(byTest("decision-dismiss-duration")?.textContent).toContain("Until undone");
    expect(byTest("decision-dismiss-note")).toBeTruthy();
    wrapper?.unmount();
    await mountDialog();
    expect(byTest("decision-dismiss-duration")).toBeNull();
    expect(byTest("decision-dismiss-note")).toBeNull();
  });

  it("sends_the_chosen_hide_for_and_note_and_previews_that_term", async () => {
    await mountDialog(calTarget);
    await chooseReason("not_needed");
    await chooseDuration("180");
    await fillField("decision-dismiss-note", "  Owned by ingest  ");
    await settle();
    expect(vi.mocked(autoobserveDecisions.preview).mock.calls.at(-1)?.[1]).toEqual({
      family: "alert_finding",
      id: FINDING,
      action: "dismiss",
      reason: "not_needed",
      duration_days: 180,
    });
    await submit();
    expect(vi.mocked(autoobserveDecisions.decide).mock.calls[0][1]).toEqual({
      family: "alert_finding",
      id: FINDING,
      action: "dismiss",
      reason: "not_needed",
      duration_days: 180,
      note: "Owned by ingest",
      request_id: expect.any(String),
    });
  });

  it("until_reopened_is_sent_as_until_reopened", async () => {
    await mountDialog(calTarget);
    await chooseReason("will_fix_later");
    await chooseDuration("until_reopened");
    expect(vi.mocked(autoobserveDecisions.preview).mock.calls.at(-1)?.[1]).toMatchObject({
      reason: "will_fix_later",
      until_reopened: true,
    });
    await submit();
    const body = vi.mocked(autoobserveDecisions.decide).mock.calls[0][1];
    expect(body).toMatchObject({ reason: "will_fix_later", until_reopened: true });
    expect(body).not.toHaveProperty("duration_days");
  });

  it("planned_work_turns_hide_for_off_and_sends_only_its_end", async () => {
    await mountDialog(calTarget);
    expect(durationOff("180")).toBe(false);
    await chooseReason("planned_work");
    expect(durationOff("180")).toBe(true);
    await submit();
    const body = vi.mocked(autoobserveDecisions.decide).mock.calls[0][1];
    expect(body).toMatchObject({ reason: "planned_work", until: expect.any(Number) });
    expect(body).not.toHaveProperty("duration_days");
    expect(body).not.toHaveProperty("until_reopened");
  });

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

  it("before_a_reason_the_effect_line_asks_for_one_instead_of_describing_another_term", async () => {
    await mountDialog(calTarget);
    await chooseDuration("until_reopened");
    const effect = byTest("decision-dismiss-effect");
    expect(effect?.getAttribute("data-state")).toBe("incomplete");
    expect(effect?.textContent?.trim()).toBe("Finish the choices above to see what this hides.");
    expect(effect?.textContent).not.toContain("until");
  });

  it("a_planned_work_end_out_of_range_never_shows_the_effect_of_another_term", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 11, 10, 0));
    try {
      await mountDialog(calTarget);
      await chooseReason("planned_work");
      expect(byTest("decision-dismiss-effect")?.getAttribute("data-state")).toBe("ready");
      const time = document.body.querySelector<HTMLInputElement>(
        '[data-test="decision-dismiss-until-time"] input',
      )!;
      time.value = "08:00";
      time.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
      const effect = byTest("decision-dismiss-effect");
      expect(effect?.getAttribute("data-state")).toBe("incomplete");
      expect(effect?.textContent?.trim()).toBe("Finish the choices above to see what this hides.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an_unreadable_end_time_never_dismisses_with_the_previous_time", async () => {
    await mountDialog();
    await chooseReason("planned_work");
    const time = document.body.querySelector<HTMLInputElement>(
      '[data-test="decision-dismiss-until-time"] input',
    )!;
    time.value = "99:99";
    time.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const effect = byTest("decision-dismiss-effect");
    expect(effect?.getAttribute("data-state")).toBe("incomplete");
    expect(effect?.textContent).not.toContain("until");
    expect(submitButton().disabled).toBe(true);
    (document.body.querySelector(`form`) as HTMLFormElement).requestSubmit();
    await settle();
    expect(autoobserveDecisions.decide).not.toHaveBeenCalled();
    time.value = "23:30";
    time.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(effect?.getAttribute("data-state")).toBe("ready");
    expect(submitButton().disabled).toBe(false);
  });

  it("shows_the_effect_from_the_preview_without_ids", async () => {
    await mountDialog();
    await chooseReason("not_needed");
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
    expect(byTest("decision-dismiss-locked")?.getAttribute("data-severity")).toBe("error");
    expect(submitButton().disabled).toBe(true);
    await submit();
    expect(autoobserveDecisions.decide).not.toHaveBeenCalled();
  });

  it("a_refused_reader_sees_only_the_refusal_not_the_disabled_form", async () => {
    vi.mocked(autoobserveDecisions.preview).mockResolvedValue({
      data: fixture.preview_locked,
    } as never);
    await mountDialog();
    expect(byTest("decision-dismiss-locked")?.textContent).toContain(
      fixture.preview_locked.locked.message,
    );
    expect(byTest("decision-dismiss-reason")).toBeNull();
    expect(byTest("decision-dismiss-duration")).toBeNull();
    expect(byTest("decision-dismiss-note")).toBeNull();
    expect(submitButton().disabled).toBe(true);
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
    await chooseReason("not_needed");
    expect(byTest("decision-dismiss-effect")?.getAttribute("data-state")).toBe("ready");
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
      duration_days: 90,
      request_id: expect.any(String),
    });
  });
});
