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
import { QueryObserver } from "@tanstack/vue-query";

vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return {
    ...actual,
    default: { ...actual.default, dismissFinding: vi.fn(), listDismissals: vi.fn() },
  };
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { byTest } from "@/test/unit/helpers/draftDom";
import { fillField } from "@/test/unit/helpers/fillField";
import { queryClient } from "@/composables/query/queryClient";
import { activeDismissalsQuery } from "@/services/alert_calibration.queries";
import alertCalibration from "@/services/alert_calibration";
import { toast } from "@/lib/feedback/Toast/useToast";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import AlertCalibrationDismissDialog from "./AlertCalibrationDismissDialog.vue";
import { makeDismissSchema } from "./AlertCalibrationDismissDialog.schema";
import type { DismissableFinding } from "./dismissals";

const ID = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";
const t = i18n.global.t as unknown as TranslateFn;

const finding = {
  _timestamp: 1,
  org: "default",
  config_id: "c1",
  window_start: 0,
  window_end: 1,
  schema_version: 2,
  kind: "finding",
  rule_id: "no_destination",
  severity: "Medium",
  confidence: "High",
  title: "ops_cpu fired with no destination",
  alert_id: "a1",
  alert_name: "ops_cpu",
  finding_id: ID,
  scope_kind: "alert",
  scope_key: "a1",
} as unknown as DismissableFinding;

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data: { code: status, message: "Alert not found." } },
  });

const EMPTY = { data: { items: [], next_cursor: null, total: 0 } };

let wrapper: VueWrapper | null = null;
const refresh = vi.fn();

const mountDialog = async () => {
  wrapper = mount(AlertCalibrationDismissDialog, {
    props: {
      open: true,
      finding,
      refresh,
      "onUpdate:open": (open: boolean) => wrapper?.setProps({ open }),
    },
    attachTo: document.body,
    global: { plugins: [store, withQueryClient(queryClient)] },
  });
  await flushPromises();
  return wrapper;
};

// The form's async validation waits on a timer before it submits, so a click settles over timer turns.
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
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
const chooseReason = (reason: string) =>
  click(`[data-test="alert-calibration-dismiss-reason-${reason}"]`);
const chooseDuration = (value: string) =>
  click(`[data-test="alert-calibration-dismiss-duration-option"][data-test-value="${value}"]`);
const submit = () => click('[data-test="alert-calibration-dismiss-submit"]');
const notice = () => byTest("alert-calibration-dismiss-notice");
const noteValue = () =>
  document.body.querySelector<HTMLTextAreaElement>(
    '[data-test="alert-calibration-dismiss-note"] textarea, textarea[data-test="alert-calibration-dismiss-note"]',
  )?.value;
const checked = (selector: string) =>
  document.body.querySelector(selector)?.getAttribute("aria-checked") ??
  document.body.querySelector(selector)?.getAttribute("data-state");

describe("AlertCalibrationDismissDialog", () => {
  beforeEach(() => {
    queryClient.clear();
    refresh.mockReset();
    vi.mocked(toast).mockReset();
    vi.mocked(alertCalibration.dismissFinding).mockReset();
    vi.mocked(alertCalibration.listDismissals).mockReset();
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(EMPTY as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("other_needs_a_note_and_notes_count_code_points", () => {
    const schema = makeDismissSchema(t);
    const errors = (reason: string, note: string) => {
      const result = schema.safeParse({ reason, note, duration: "90" });
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(errors("other", "")).toEqual([t("alertCalibration.dismiss.noteRequired")]);
    expect(errors("other", "   ")).toEqual([t("alertCalibration.dismiss.noteRequired")]);
    expect(errors("expected", "a".repeat(501))).toEqual([
      t("alertCalibration.dismiss.noteTooLong"),
    ]);
    expect(errors("expected", "é".repeat(500))).toEqual([]);
    expect(errors("expected", "😀".repeat(250))).toEqual([]);
    expect(errors("", "")).toEqual([t("alertCalibration.dismiss.reasonRequired")]);
  });

  it("names the alert and the finding, and sends nothing for Other without a note", async () => {
    await mountDialog();
    expect(byTest("alert-calibration-dismiss-dialog")?.textContent).toContain(
      "Dismiss finding on ops_cpu",
    );
    expect(notice()?.textContent).toMatch(
      /^\s*Hidden for everyone in default Organization until \w{3} \d{1,2}, \d{4}, then shown again if it still fails\. Recorded with your name and reason\. Undo from Dismissed\.\s*$/,
    );
    expect(notice()?.getAttribute("data-severity")).toBe("default");
    expect(byTest("alert-calibration-dismiss-ends")?.textContent).toContain("Hidden until");
    await chooseReason("other");
    await submit();
    expect(alertCalibration.dismissFinding).not.toHaveBeenCalled();
    expect(byTest("alert-calibration-dismiss-dialog")?.textContent).toContain(
      "Add a note when the reason is Other.",
    );
  });

  it("a_failed_dismiss_keeps_the_form_and_offers_retry", async () => {
    vi.mocked(alertCalibration.dismissFinding).mockRejectedValue(httpError(500));
    await mountDialog();
    await chooseReason("known_issue");
    await fillField("alert-calibration-dismiss-note", "Owned by ingest");
    await chooseDuration("180");
    await submit();

    expect(alertCalibration.dismissFinding).toHaveBeenCalledTimes(1);
    expect(vi.mocked(alertCalibration.dismissFinding).mock.calls[0]).toEqual([
      "default",
      ID,
      {
        rule_id: "no_destination",
        scope_kind: "alert",
        scope_key: "a1",
        reason: "known_issue",
        note: "Owned by ingest",
        duration_days: 180,
      },
    ]);
    expect(wrapper?.props("open")).toBe(true);
    expect(notice()?.getAttribute("data-severity")).toBe("error");
    expect(notice()?.textContent).toContain(t("alertCalibration.dismiss.error.failed"));
    expect(notice()?.textContent).not.toContain("Alert not found.");
    expect(noteValue()).toBe("Owned by ingest");
    expect(checked('[data-test="alert-calibration-dismiss-reason-known_issue"]')).toMatch(
      /true|checked/,
    );
    const button = byTest("alert-calibration-dismiss-submit") as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await submit();
    expect(alertCalibration.dismissFinding).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("closes and toasts only after the server and the list refetch answer", async () => {
    const expires = new Date(2027, 1, 3).getTime() * 1000;
    vi.mocked(alertCalibration.dismissFinding).mockResolvedValue({
      data: { id: ID, expires_at: expires, state: "active" },
    } as never);
    await mountDialog();
    await chooseReason("expected");
    await submit();
    expect(wrapper?.props("open")).toBe(false);
    expect(toast).toHaveBeenCalledWith({
      message: "Dismissed until Feb 3, 2027: ops_cpu.",
      variant: "success",
      action: { label: "Undo", handler: expect.any(Function) },
    });
    expect(vi.mocked(alertCalibration.dismissFinding).mock.calls[0][2]).toEqual({
      rule_id: "no_destination",
      scope_kind: "alert",
      scope_key: "a1",
      reason: "expected",
      duration_days: 90,
    });
  });

  it("a_dismiss_conflict_refreshes_and_says_so", async () => {
    vi.mocked(alertCalibration.dismissFinding).mockRejectedValue(httpError(409));
    // A mounted reader, as the board is, so the invalidation refetches.
    const reader = new QueryObserver(queryClient, activeDismissalsQuery("default"));
    const stop = reader.subscribe(() => {});
    await mountDialog();
    await flushPromises();
    vi.mocked(alertCalibration.listDismissals).mockClear();
    await chooseReason("not_useful");
    await fillField("alert-calibration-dismiss-note", "kept");
    await submit();

    expect(notice()?.getAttribute("data-severity")).toBe("warning");
    expect(notice()?.textContent).toContain(t("alertCalibration.dismiss.error.changed"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(alertCalibration.listDismissals).toHaveBeenCalledTimes(1);
    expect(noteValue()).toBe("kept");
    expect(wrapper?.props("open")).toBe(true);
    stop();
  });

  it("a_gone_alert_is_red_and_refreshes_the_board", async () => {
    vi.mocked(alertCalibration.dismissFinding).mockRejectedValue(httpError(404));
    await mountDialog();
    await chooseReason("false_positive");
    await submit();
    expect(notice()?.getAttribute("data-severity")).toBe("error");
    expect(notice()?.textContent).toContain(t("alertCalibration.dismiss.error.gone"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says the scope changes with the chosen duration, and that until undone has no date", async () => {
    await mountDialog();
    await chooseDuration("until_reopened");
    expect(notice()?.textContent?.trim()).toBe(
      "Hidden for everyone in default Organization until someone undoes it. Recorded with your name and reason. Undo from Dismissed.",
    );
  });

  it("offers the m13 reasons in their words", async () => {
    await mountDialog();
    const label = (reason: string) =>
      byTest(`alert-calibration-dismiss-reason-${reason}`)?.closest("label")?.textContent?.trim() ??
      document.body
        .querySelector(`[data-test="alert-calibration-dismiss-reason-${reason}"]`)
        ?.parentElement?.textContent?.trim();
    expect(label("not_useful")).toContain("Not needed");
    expect(label("false_positive")).toContain("Wrong: this didn't happen");
    expect(label("known_issue")).toContain("Will fix later");
  });
});
