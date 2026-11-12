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
vi.mock("@/components/alert_calibration/alertEditorLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/alert_calibration/alertEditorLink")>()),
  alertFolderOf: vi.fn(async () => "f-infra"),
}));
const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push }),
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>();
  return { ...actual, toast: vi.fn(actual.toast) };
});

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { queryClient } from "@/composables/query/queryClient";
import autoobserveDecisions, { type Preview } from "@/services/autoobserveDecisions";
import { dismissAll, toast, toastRecords } from "@/lib/feedback/Toast/useToast";
import { takeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import ReviewChangeDialog from "./ReviewChangeDialog.vue";
import { clearAppliedSession, useAppliedChanges, type ReviewChangeTarget } from "./appliedChanges";

const api = vi.mocked(autoobserveDecisions);

const target: ReviewChangeTarget = {
  findingId: "f-1",
  alertId: "al-1",
  alertName: "disk latency",
  action: {
    type: "apply_suggestion",
    alert_id: "al-1",
    patch: [{ field: "pending_period_secs", from: 0, to: 120 }],
  },
};

const preview = (over: Partial<Preview> = {}): Preview => ({
  may: true,
  verb: "apply",
  decision_id: "alert_finding:f-1",
  family: "alert_finding",
  id: "f-1",
  action: "apply",
  effect: { scope: "org", until: null, comes_back_when: "when_undone" },
  subject: { title: "disk latency", folder: "infra", team: null },
  revision: 3,
  current: null,
  change: {
    alert: { title: "disk latency", folder: "infra", team: null, destinations: ["storage-oncall"] },
    fields: [{ field: "pending_period_secs", from: 0, to: 120 }],
    acknowledged_firings_dropped: { count: 1, of: 3 },
  },
  ...over,
});

const view = {
  decision_id: "alert_finding:f-1",
  family: "alert_finding" as const,
  id: "f-1",
  action: "apply" as const,
  state: "applied" as const,
  reason: null,
  note: null,
  has_note: false,
  actor: "you@example.com",
  source: "ui" as const,
  decided_at: 1_700_000_000_000_000,
  until: null,
  revision: 4,
};

const httpError = (status: number, data: unknown = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

let wrapper: VueWrapper | null = null;
const q = (test: string) => document.querySelector<HTMLElement>(`[data-test="${test}"]`);
const applyButton = () => q("review-change-apply") as HTMLButtonElement | null;

const mountDialog = async () => {
  wrapper = mount(ReviewChangeDialog, {
    props: { open: true, target },
    attachTo: document.body,
    global: { plugins: [i18n, store, withQueryClient(queryClient)] },
  });
  await flushPromises();
  await flushPromises();
};

describe("ReviewChangeDialog (W5)", () => {
  beforeEach(() => {
    queryClient.clear();
    clearAppliedSession();
    dismissAll();
    push.mockReset();
    vi.mocked(toast).mockClear();
    store.state.selectedOrganization.identifier = "demo-org";
    api.list
      .mockReset()
      .mockResolvedValue({ data: { decisions: [], total: 0, limit: 1, offset: 0 } } as never);
    api.preview.mockReset().mockResolvedValue({ data: preview() } as never);
    api.decide.mockReset();
    api.undo.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("shows the alert, where it lives, each field old to new and the acknowledged warning", async () => {
    await mountDialog();
    expect(api.preview).toHaveBeenCalledWith(
      "demo-org",
      { family: "alert_finding", id: "f-1", action: "apply" },
      expect.anything(),
    );
    expect(document.body.textContent).toContain("Review change: disk latency");
    expect(q("review-change-where")?.textContent?.trim()).toBe(
      "Folder infra · notifies storage-oncall",
    );
    const row = q("review-change-row-pending_period_secs")!;
    expect(row.textContent).toContain("Hold for");
    expect(row.querySelector(".line-through")?.textContent).toContain("0");
    expect(row.textContent).toContain("2 minutes");
    expect(q("review-change-acknowledged")?.textContent?.trim()).toBe(
      "1 of the 3 acknowledged firings would no longer alert. Check it before applying.",
    );
    expect(q("review-change-acknowledged")?.className).toContain("warning");
    expect(applyButton()?.disabled).toBe(false);
  });

  it("an_empty_destination_list_reads_as_no_destination_not_none", async () => {
    api.preview.mockResolvedValue({
      data: preview({
        change: {
          alert: { title: "ops-a", folder: "ops", team: null, destinations: [] },
          fields: [{ field: "destinations", from: [], to: ["ops-webhook"] }],
        },
      }),
    } as never);
    await mountDialog();
    expect(q("review-change-where")?.textContent?.trim()).toBe("Folder ops · notifies no one");
    const row = q("review-change-row-destinations")!;
    expect(row.textContent).toContain("No destination");
    expect(row.textContent).not.toContain("None");
  });

  it("names the team when the preview knows it", async () => {
    api.preview.mockResolvedValue({
      data: preview({
        change: { ...preview().change!, alert: { ...preview().change!.alert, team: "storage" } },
      }),
    } as never);
    await mountDialog();
    expect(q("review-change-where")?.textContent?.trim()).toBe(
      "Folder infra · team storage · notifies storage-oncall",
    );
  });

  it("Apply writes the apply, shows the shared Undo toast and lists it in What I've changed", async () => {
    api.decide.mockResolvedValue({ data: { change: "created", decision: view } } as never);
    api.undo.mockResolvedValue({
      data: { change: "undone", decision: { ...view, state: "undone" } },
    } as never);
    await mountDialog();
    applyButton()!.click();
    await flushPromises();
    const body = api.decide.mock.calls[0][1];
    expect(body).toMatchObject({
      family: "alert_finding",
      id: "f-1",
      action: "apply",
      expected_revision: 3,
    });
    expect(body.request_id).toBeTruthy();
    expect(body).not.toHaveProperty("applied_via");
    expect(wrapper!.emitted("update:open")?.at(-1)).toEqual([false]);
    const record = toastRecords.find(
      (r) => r.open && String(r.message) === "Applied to disk latency.",
    );
    expect(record?.action?.label).toBe("Undo");
    const applied = useAppliedChanges("demo-org", []);
    expect(applied.value.map((e) => e.title)).toEqual(["disk latency"]);
    record!.action!.handler();
    await flushPromises();
    expect(api.undo).toHaveBeenCalledWith(
      "demo-org",
      "alert_finding:f-1",
      expect.objectContaining({ expected_revision: 4 }),
    );
  });

  it("409 alert_changed: amber, Apply off, the editor is the way on", async () => {
    api.decide.mockRejectedValue(
      httpError(409, { error: "alert_changed", message: "This alert changed. Open it to review." }),
    );
    await mountDialog();
    applyButton()!.click();
    await flushPromises();
    const notice = q("review-change-notice")!;
    expect(notice.textContent?.trim()).toBe("This alert changed. Open it to review.");
    expect(notice.dataset.severity).toBe("warning");
    expect(applyButton()?.disabled).toBe(true);
    expect(q("o-dialog-neutral-btn")?.textContent).toContain("Edit in alert editor");
  });

  it("an_apply_the_server_no_longer_lists_says_the_suggestion_is_gone_and_rereads_the_alert", async () => {
    api.decide.mockRejectedValue(
      httpError(404, { code: 404, error: "not_found", message: "This item is no longer listed." }),
    );
    await mountDialog();
    const reads = api.preview.mock.calls.length;
    applyButton()!.click();
    await flushPromises();
    const notice = q("review-change-notice")!;
    expect(notice.textContent?.trim()).toBe(
      "This suggestion is no longer available. Open the alert to review it.",
    );
    expect(notice.dataset.severity).toBe("warning");
    expect(applyButton()?.disabled).toBe(true);
    expect(api.preview.mock.calls.length).toBeGreaterThan(reads);
  });

  it("an_apply_whose_reread_also_finds_the_finding_gone_still_says_so_and_drops_the_stale_values", async () => {
    const gone = httpError(404, {
      code: 404,
      error: "not_found",
      message: "This item is no longer listed.",
    });
    api.decide.mockRejectedValue(gone);
    await mountDialog();
    api.preview.mockRejectedValue(gone);
    applyButton()!.click();
    await flushPromises();
    await flushPromises();
    const notice = q("review-change-notice");
    expect(notice?.textContent?.trim()).toBe(
      "This suggestion is no longer available. Open the alert to review it.",
    );
    expect(notice?.dataset.severity).toBe("warning");
    expect(applyButton()).toBeNull();
    expect(q("review-change-edit")?.textContent).toContain("Edit in alert editor");
    expect(q("review-change-fields")).toBeNull();
    expect(q("review-change-where")).toBeNull();
  });

  it("a write failure takes the note's place below the change, so nothing above it moves", async () => {
    api.decide.mockRejectedValue(httpError(409, { error: "alert_changed", message: "changed" }));
    await mountDialog();
    const fields = q("review-change-fields")!;
    applyButton()!.click();
    await flushPromises();
    const notice = q("review-change-notice")!;
    expect(fields.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fields.previousElementSibling?.getAttribute("data-test")).toBe("review-change-where");
    // The note stays in the slot, hidden, so the slot keeps the taller of the two heights.
    expect(q("review-change-note")?.classList.contains("invisible")).toBe(true);
  });

  it("403 refusal: the server's words in red, naming the folder", async () => {
    api.decide.mockRejectedValue(
      httpError(403, {
        code: "decision_refused",
        reason: "folder",
        verb: "apply",
        message: "You can't apply this change: it needs permission to edit alerts in folder infra.",
        folder: "infra",
        owners: [],
        owners_scope: null,
        can_act: [],
        more: 0,
      }),
    );
    await mountDialog();
    applyButton()!.click();
    await flushPromises();
    const notice = q("review-change-notice")!;
    expect(notice.textContent).toContain("folder infra");
    expect(notice.dataset.severity).toBe("error");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(applyButton()?.disabled).toBe(true);
  });

  it("a preview that is locked for this reader shows its refusal and keeps Apply off", async () => {
    api.preview.mockResolvedValue({
      data: preview({
        may: false,
        locked: {
          code: "decision_refused",
          reason: "folder",
          verb: "apply",
          message: "Ask alice to apply this; you can't edit alerts in folder infra.",
          folder: "infra",
          owners: [],
          owners_scope: null,
          can_act: [],
          more: 0,
        },
      }),
    } as never);
    await mountDialog();
    expect(q("review-change-notice")?.textContent).toContain("folder infra");
    expect(applyButton()?.disabled).toBe(true);
    expect(q("review-change-note")?.classList.contains("invisible")).toBe(true);
  });

  it("a_refusal_with_owners_names_who_to_ask_and_counts_the_rest", async () => {
    api.preview.mockResolvedValue({
      data: preview({
        may: false,
        locked: {
          code: "decision_refused",
          reason: "security",
          verb: "apply",
          message:
            "You can't apply this: it is a security detection, and changing one also needs the Security permission. Ask an admin of this organization.",
          folder: "ops",
          owners: ["a@x.test", "b@x.test", "c@x.test", "d@x.test", "e@x.test"],
          owners_scope: "org",
          can_act: [],
          more: 0,
        },
      }),
    } as never);
    await mountDialog();
    const text = q("review-change-notice")?.textContent ?? "";
    expect(text).toContain("needs the Security permission");
    expect(text).toContain(
      "Ask an admin of this organization: a@x.test, b@x.test, c@x.test and 2 more.",
    );
    expect(text.match(/Ask /g)?.length).toBe(1);
  });

  it("cancel_sits_beside_apply_and_edit_takes_the_left_slot", async () => {
    await mountDialog();
    expect(q("o-dialog-secondary-btn")?.textContent?.trim()).toBe("Cancel");
    expect(q("o-dialog-neutral-btn")?.textContent?.trim()).toBe("Edit in alert editor");
    expect(applyButton()?.textContent?.trim()).toBe("Apply");
  });

  it("Edit in alert editor hands the stored change to the editor in the alert's folder", async () => {
    await mountDialog();
    q("o-dialog-neutral-btn")!.click();
    await flushPromises();
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "editAlert",
        params: { alert_id: "al-1" },
        query: expect.objectContaining({ org_identifier: "demo-org", folder: "f-infra" }),
      }),
    );
    const handoff = takeAlertEditHandoff("al-1");
    expect(handoff?.target).toEqual({ alertId: "al-1", findingId: "f-1" });
    expect(handoff?.patch).toEqual({ pendingPeriodSecs: { from: 0, to: 120 } });
  });

  it("a finding gone from the list says so in amber and offers only the editor", async () => {
    api.preview.mockRejectedValue(
      httpError(404, { code: 404, error: "not_found", message: "This item is no longer listed." }),
    );
    await mountDialog();
    const notice = q("review-change-notice")!;
    expect(notice.textContent?.trim()).toBe(
      "This suggestion is no longer available. Open the alert to review it.",
    );
    expect(notice.dataset.severity).toBe("warning");
    expect(applyButton()).toBeNull();
    expect(q("review-change-edit")?.textContent).toContain("Edit in alert editor");
    expect(q("review-change-note")).toBeNull();
  });

  it("with the decision route off, the stored change shows and only the editor is offered", async () => {
    api.list.mockRejectedValue(httpError(404));
    await mountDialog();
    expect(api.preview).not.toHaveBeenCalled();
    expect(applyButton()).toBeNull();
    expect(q("review-change-notice")?.dataset.severity).toBe("info");
    expect(q("review-change-row-pending_period_secs")?.textContent).toContain("2 minutes");
    expect(q("review-change-note")).toBeNull();
  });
});
