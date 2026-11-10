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
import autoobserveDecisions, {
  type BatchResult,
  type PreviewParams,
} from "@/services/autoobserveDecisions";
import { dismissAll, toast } from "@/lib/feedback/Toast/useToast";
import MarkIntendedReportsDialog, { type MarkTarget } from "./MarkIntendedReportsDialog.vue";

const hex = (n: number) => n.toString(16).padStart(64, "0");
const alerts: MarkTarget[] = Array.from({ length: 6 }, (_, i) => ({
  finding_id: hex(i + 1),
  alert_name: `report-${i + 1}`,
}));
const LOCKED = hex(6);

let wrapper: VueWrapper | null = null;

const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  }
};
const all = (test: string) => [...document.body.querySelectorAll(`[data-test="${test}"]`)];

const previewFor = (_org: string, params: PreviewParams) => {
  const base = params.id === LOCKED ? fixture.preview_locked : fixture.preview;
  return Promise.resolve({
    data: {
      ...base,
      family: "alert_finding",
      id: params.id,
      decision_id: `alert_finding:${params.id}`,
      subject: { title: "ignored", folder: "infra", team: "storage" },
    },
  });
};

const okItem = (id: string, index: number) => ({
  index,
  family: "alert_finding",
  id,
  status: 200,
  result: {
    change: "created",
    decision: {
      ...fixture.batch.results[0].result!.decision,
      decision_id: `alert_finding:${id}`,
      id,
    },
  },
});

const mountDialog = async (targets: MarkTarget[] = alerts) => {
  wrapper = mount(MarkIntendedReportsDialog, {
    props: {
      open: true,
      alerts: targets,
      "onUpdate:open": (open: boolean) => wrapper?.setProps({ open }),
    },
    attachTo: document.body,
    global: { plugins: [store, withQueryClient(queryClient)] },
  });
  await settle();
};

describe("MarkIntendedReportsDialog", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(toast).mockClear();
    dismissAll();
    for (const fn of Object.values(autoobserveDecisions)) vi.mocked(fn).mockReset();
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({ data: fixture.list } as never);
    vi.mocked(autoobserveDecisions.preview).mockImplementation(previewFor as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("previews_each_alert_and_locks_the_one_the_reader_cant_mark", async () => {
    await mountDialog();
    expect(autoobserveDecisions.preview).toHaveBeenCalledTimes(6);
    expect(vi.mocked(autoobserveDecisions.preview).mock.calls[0][1]).toEqual({
      family: "alert_finding",
      id: hex(1),
      action: "dismiss",
      reason: "intended_report",
      until_reopened: true,
    });
    const rows = all("decision-mark-row");
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual([
      "open",
      "open",
      "open",
      "open",
      "open",
      "locked",
    ]);
    expect(byTest("decision-mark-dialog")?.textContent).toContain(
      "The alerts keep sending exactly as before.",
    );
    expect(byTest("decision-mark-status")?.textContent).toContain("You can mark 5 of 6.");
    expect(byTest("decision-mark-status")?.textContent).toContain("report-6 stays as it is.");
    expect(byTest("decision-mark-submit")?.textContent).toContain("Mark 5 as intended");
    expect(byTest("decision-mark-dialog")?.textContent).not.toContain(hex(1));
  });

  it("one_alert_reads_in_the_singular_with_nothing_to_untick", async () => {
    await mountDialog(alerts.slice(0, 1));
    const text = byTest("decision-mark-dialog")?.textContent ?? "";
    expect(text).toContain("Mark alert as intended report");
    expect(text).toContain("It stops showing as noise.");
    expect(text).toContain("The alert keeps sending exactly as before.");
    expect(text).not.toContain("Untick");
  });

  it("sends_one_batch_and_toasts_with_undo_for_every_written_item", async () => {
    const results = alerts.slice(0, 5).map((a, i) => okItem(a.finding_id, i));
    vi.mocked(autoobserveDecisions.decideBatch).mockResolvedValue({
      data: { results, written: 5, unchanged: 0, failed: 0 } as BatchResult,
    } as never);
    await mountDialog();
    (byTest("decision-mark-submit") as HTMLButtonElement).click();
    await settle();
    expect(autoobserveDecisions.decideBatch).toHaveBeenCalledTimes(1);
    const items = vi.mocked(autoobserveDecisions.decideBatch).mock.calls[0][1];
    expect(items).toHaveLength(5);
    expect(items[0]).toEqual({
      family: "alert_finding",
      id: hex(1),
      action: "dismiss",
      reason: "intended_report",
      until_reopened: true,
      request_id: expect.any(String),
    });
    expect(wrapper?.props("open")).toBe(false);
    const options = vi.mocked(toast).mock.calls[0][0];
    expect(String(options.message)).toBe("5 alerts marked as intended reports.");
    options.action?.handler();
    await settle();
    expect(autoobserveDecisions.undo).toHaveBeenCalledTimes(5);
    expect(vi.mocked(autoobserveDecisions.undo).mock.calls[0][2]).toEqual({
      expected_revision: 1,
      request_id: expect.any(String),
    });
  });

  const httpError = (status: number, data: unknown) =>
    Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
  const submit = async () => {
    (byTest("decision-mark-submit") as HTMLButtonElement).click();
    await settle();
  };
  const states = () => all("decision-mark-row").map((r) => r.getAttribute("data-state"));
  const reasons = () => all("decision-mark-row-reason").map((r) => r.textContent?.trim());
  const partial = () => [
    okItem(hex(1), 0),
    { index: 1, family: "alert_finding", id: hex(2), status: 403, error: fixture.refused },
    { index: 2, family: "alert_finding", id: hex(3), status: 409, error: fixture.conflict },
    okItem(hex(4), 3),
    okItem(hex(5), 4),
  ];

  it("a_partial_result_reds_the_footer_line_and_gives_each_failed_row_its_reason", async () => {
    vi.mocked(autoobserveDecisions.decideBatch).mockResolvedValue({
      data: { results: partial(), written: 3, unchanged: 0, failed: 2 },
    } as never);
    await mountDialog();
    await submit();
    expect(wrapper?.props("open")).toBe(true);
    expect(byTest("decision-mark-partial")).toBeNull();
    const status = byTest("decision-mark-status");
    expect(status?.getAttribute("data-severity")).toBe("error");
    expect(status?.textContent?.trim()).toBe("2 of 5 weren't marked: report-2 and report-3.");
    expect(reasons()).toEqual([
      "",
      fixture.refused.message,
      "This changed since you opened it. Refresh and try again.",
      "",
      "",
      "",
    ]);
    expect(byTest("decision-mark-dialog")?.textContent).not.toContain("finding_changed");
    expect(states()).toEqual(["marked", "locked", "open", "marked", "marked", "locked"]);
    expect(byTest("decision-mark-submit")?.textContent).toContain("Mark 1 as intended");
    expect(String(vi.mocked(toast).mock.calls[0][0].message)).toBe(
      "3 alerts marked as intended reports.",
    );
  });

  it("reserves_the_failure_space_before_save_so_the_dialog_never_grows", async () => {
    vi.mocked(autoobserveDecisions.decideBatch).mockResolvedValue({
      data: { results: partial(), written: 3, unchanged: 0, failed: 2 },
    } as never);
    await mountDialog();
    const footer = byTest("decision-mark-footer");
    const lines = footer?.children.length;
    expect(reasons()).toEqual(["", "", "", "", "", ""]);
    expect(byTest("decision-mark-status")).toBeTruthy();
    await submit();
    expect(byTest("decision-mark-footer")).toBe(footer);
    expect(footer?.children.length).toBe(lines);
    expect(reasons()).toHaveLength(6);
  });

  it("a_conflict_re_reads_the_preview_and_the_retry_keeps_the_readers_choices", async () => {
    let round = 0;
    vi.mocked(autoobserveDecisions.preview).mockImplementation(((
      org: string,
      params: PreviewParams,
    ) =>
      previewFor(org, params).then((answer) => ({
        data: { ...answer.data, revision: params.id === hex(3) && round > 0 ? 2 : 0 },
      }))) as never);
    vi.mocked(autoobserveDecisions.decideBatch).mockImplementation((() => {
      round += 1;
      return Promise.resolve({
        data: {
          results: partial().filter((item) => item.id !== hex(5)),
          written: 2,
          unchanged: 0,
          failed: 2,
        },
      });
    }) as never);
    await mountDialog();
    (all("decision-mark-row-check")[4].querySelector("button, input") as HTMLElement).click();
    await settle();
    expect(byTest("decision-mark-submit")?.textContent).toContain("Mark 4 as intended");
    const before = vi.mocked(autoobserveDecisions.preview).mock.calls.length;
    await submit();
    expect(vi.mocked(autoobserveDecisions.preview).mock.calls.length).toBeGreaterThan(before);
    expect(states()).toEqual(["marked", "locked", "open", "marked", "open", "locked"]);
    expect(byTest("decision-mark-submit")?.textContent).toContain("Mark 1 as intended");
    vi.mocked(autoobserveDecisions.decideBatch).mockResolvedValue({
      data: { results: [okItem(hex(3), 0)], written: 1, unchanged: 0, failed: 0 },
    } as never);
    await submit();
    const retry = vi.mocked(autoobserveDecisions.decideBatch).mock.calls.at(-1)?.[1];
    expect(retry).toEqual([expect.objectContaining({ id: hex(3), expected_revision: 2 })]);
  });

  it("a_conflict_whose_re_read_fails_keeps_save_blocked", async () => {
    vi.mocked(autoobserveDecisions.decideBatch).mockResolvedValue({
      data: { results: partial(), written: 3, unchanged: 0, failed: 2 },
    } as never);
    await mountDialog();
    vi.mocked(autoobserveDecisions.preview).mockRejectedValue(httpError(500, {}));
    await submit();
    expect(states()[2]).toBe("open");
    expect((byTest("decision-mark-submit") as HTMLButtonElement).disabled).toBe(true);
    await submit();
    expect(autoobserveDecisions.decideBatch).toHaveBeenCalledTimes(1);
  });

  it("a_reopened_dialog_whose_re_read_fails_again_keeps_save_blocked", async () => {
    vi.mocked(autoobserveDecisions.decideBatch).mockResolvedValue({
      data: { results: partial(), written: 3, unchanged: 0, failed: 2 },
    } as never);
    await mountDialog();
    vi.mocked(autoobserveDecisions.preview).mockRejectedValue(httpError(500, {}));
    await submit();
    await wrapper?.setProps({ open: false });
    await settle();
    await wrapper?.setProps({ open: true });
    await settle();
    expect(states()[2]).toBe("open");
    expect((byTest("decision-mark-submit") as HTMLButtonElement).disabled).toBe(true);
    const status = byTest("decision-mark-status");
    expect(status?.getAttribute("data-severity")).toBe("error");
    expect(status?.textContent?.trim()).toBe(
      "Couldn't check which alerts you can mark. Close and try again.",
    );
    await submit();
    expect(autoobserveDecisions.decideBatch).toHaveBeenCalledTimes(1);
  });

  it("a_reopened_dialog_whose_re_read_succeeds_sends_the_current_revision", async () => {
    vi.mocked(autoobserveDecisions.decideBatch).mockResolvedValue({
      data: { results: partial(), written: 3, unchanged: 0, failed: 2 },
    } as never);
    await mountDialog();
    vi.mocked(autoobserveDecisions.preview).mockRejectedValue(httpError(500, {}));
    await submit();
    await wrapper?.setProps({ open: false });
    await settle();
    vi.mocked(autoobserveDecisions.preview).mockImplementation(((
      org: string,
      params: PreviewParams,
    ) =>
      previewFor(org, params).then((answer) => ({
        data: { ...answer.data, revision: 2 },
      }))) as never);
    await wrapper?.setProps({ open: true });
    await settle();
    expect((byTest("decision-mark-submit") as HTMLButtonElement).disabled).toBe(false);
    await submit();
    const retry = vi.mocked(autoobserveDecisions.decideBatch).mock.calls.at(-1)?.[1];
    expect(retry?.[0]).toEqual(expect.objectContaining({ expected_revision: 2 }));
  });

  it("a_remount_over_cached_previews_whose_read_fails_keeps_save_blocked", async () => {
    await mountDialog();
    wrapper?.unmount();
    vi.mocked(autoobserveDecisions.preview).mockRejectedValue(httpError(500, {}));
    await mountDialog();
    expect(states()[0]).toBe("open");
    expect((byTest("decision-mark-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a_whole_request_refusal_locks_every_row_it_sent", async () => {
    vi.mocked(autoobserveDecisions.decideBatch).mockRejectedValue(httpError(403, fixture.refused));
    await mountDialog();
    await submit();
    expect(states()).toEqual(["locked", "locked", "locked", "locked", "locked", "locked"]);
    expect(reasons().slice(0, 5)).toEqual(Array(5).fill(fixture.refused.message));
    expect(byTest("decision-mark-status")?.textContent?.trim()).toBe(
      "5 of 5 weren't marked: report-1, report-2, report-3 and 2 more.",
    );
    expect((byTest("decision-mark-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("names_three_failures_and_counts_the_rest", async () => {
    const results = alerts
      .slice(0, 5)
      .map((a, i) => ({ index: i, family: "alert_finding", id: a.finding_id, status: 500 }));
    vi.mocked(autoobserveDecisions.decideBatch).mockResolvedValue({
      data: { results, written: 0, unchanged: 0, failed: 5 },
    } as never);
    await mountDialog();
    await submit();
    expect(byTest("decision-mark-status")?.textContent?.trim()).toBe(
      "5 of 5 weren't marked: report-1, report-2, report-3 and 2 more.",
    );
    expect(reasons().slice(0, 5)).toEqual(Array(5).fill("This couldn't be saved. Try again."));
    expect(states().slice(0, 5)).toEqual(Array(5).fill("open"));
    expect(toast).not.toHaveBeenCalled();
  });
});
