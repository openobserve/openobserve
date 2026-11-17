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
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { h, nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { byTest } from "@/test/unit/helpers/draftDom";
import alertsService from "@/services/alerts";
import { queryClient } from "@/composables/query/queryClient";
import { ALERT_PREFILL_KEY } from "@/utils/alerts/alertPrefillStorage";
import AlertCalibrationApplyDialog from "./AlertCalibrationApplyDialog.vue";
import type { ApplySuggestion } from "./applySuggestion";
import type { FindingRecord } from "./digests";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { get_by_alert_id: vi.fn(), update_by_alert_id: vi.fn(), listByFolderId: vi.fn() },
  });
});

const action: ApplySuggestion = {
  type: "apply_suggestion",
  alert_id: "a1",
  patch: [{ field: "pending_period_secs", from: 60, to: 120 }],
};

const finding = {
  _timestamp: 1,
  org: "default",
  config_id: "c1",
  window_start: 0,
  window_end: 1,
  schema_version: 2,
  kind: "finding",
  rule_id: "noise",
  severity: "Medium",
  confidence: "High",
  title: "ops_cpu fires too often",
  alert_id: "a1",
  alert_name: "ops_cpu",
  finding_id: "f1",
  limitations: JSON.stringify(["quiet_source"]),
} as unknown as FindingRecord;

const liveAlert = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  name: "ops_cpu",
  is_real_time: false,
  pending_period_sec: 60,
  trigger_condition: { silence: 10 },
  destinations: ["ops-pager"],
  ...overrides,
});

const OPS_LIST = { data: { list: [{ alert_id: "a1", name: "ops_cpu", folder_id: "ops" }] } };
const listByFolderId = vi.mocked(alertsService.listByFolderId);

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });

let router: Router;
let wrapper: VueWrapper | null = null;

const mountDialog = async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => h("div") } },
      { path: "/alerts/edit/:alert_id", name: "editAlert", component: { render: () => h("div") } },
    ],
  });
  await router.push("/");
  vi.spyOn(router, "push");
  wrapper = mount(AlertCalibrationApplyDialog, {
    props: {
      open: true,
      action,
      finding,
      "onUpdate:open": (open: boolean) => wrapper?.setProps({ open }),
    },
    attachTo: document.body,
    global: { plugins: [store, router, withQueryClient()] },
  });
  await flushPromises();
  return wrapper;
};

const inDialog = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="alert-calibration-apply-dialog"] [data-test="${id}"]`,
  );
const dialogText = () => byTest("alert-calibration-apply-dialog")?.textContent ?? "";

describe("AlertCalibrationApplyDialog", () => {
  beforeEach(() => {
    sessionStorage.clear();
    queryClient.clear();
    vi.mocked(alertsService.get_by_alert_id).mockReset();
    listByFolderId.mockReset();
    listByFolderId.mockResolvedValue(OPS_LIST as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  it("shows the change, its consequence and the review note on a fresh alert", async () => {
    vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({ data: liveAlert() } as never);
    await mountDialog();

    expect(dialogText()).toContain("Review change: ops_cpu");
    const row = inDialog("alert-calibration-apply-row-pendingPeriodSecs")?.textContent ?? "";
    expect(row).toContain("Hold for");
    expect(row).toContain("1 minute");
    expect(row).toContain("2 minutes");
    expect(dialogText()).toContain("holds for 2 minutes");
    expect(dialogText()).toContain(
      "A quiet source can be a batch or cron job that is idle by design.",
    );
    expect(dialogText()).toContain("It takes effect only after you click Save.");
    expect(inDialog("alert-calibration-apply-continue")).not.toBeNull();
    expect(dialogText()).not.toMatch(/pending_period_secs|apply_suggestion/);
  });

  it("Cancel in the prompt changes nothing", async () => {
    vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({ data: liveAlert() } as never);
    await mountDialog();
    inDialog("o-dialog-secondary-btn")!.click();
    await flushPromises();

    expect(router.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
    expect(wrapper!.props("open")).toBe(false);
  });

  it("Continue writes one handoff and routes to the editor", async () => {
    vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({ data: liveAlert() } as never);
    await mountDialog();
    inDialog("alert-calibration-apply-continue")!.click();
    await flushPromises();

    expect(JSON.parse(sessionStorage.getItem(ALERT_PREFILL_KEY)!)).toEqual({
      version: 1,
      source: "calibration",
      target: { alertId: "a1", findingId: "f1" },
      focus: "pending_period",
      patch: { pendingPeriodSecs: { from: 60, to: 120 } },
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      name: "editAlert",
      params: { alert_id: "a1" },
      query: { org_identifier: "default", prefill: "calibration", folder: "ops" },
    });
  });

  it("Continue passes the alert's folder without waiting", async () => {
    vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({ data: liveAlert() } as never);
    await mountDialog();
    expect(listByFolderId).toHaveBeenCalledTimes(1);
    expect(listByFolderId.mock.calls[0].slice(5, 8)).toEqual(["default", "", "ops_cpu"]);

    inDialog("alert-calibration-apply-continue")!.click();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { org_identifier: "default", prefill: "calibration", folder: "ops" },
      }),
    );
    expect(listByFolderId).toHaveBeenCalledTimes(1);
  });

  it("a Continue before the folder is known shows the button busy, then opens the editor", async () => {
    let resolve!: (value: unknown) => void;
    listByFolderId.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({ data: liveAlert() } as never);
    await mountDialog();

    inDialog("alert-calibration-apply-continue")!.click();
    await nextTick();
    expect(inDialog("alert-calibration-apply-continue")?.getAttribute("aria-busy")).toBe("true");
    inDialog("alert-calibration-apply-continue")!.click();
    expect(router.push).not.toHaveBeenCalled();

    resolve(OPS_LIST);
    await flushPromises();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { org_identifier: "default", prefill: "calibration", folder: "ops" },
      }),
    );
  });

  it("Cancel while the folder is still loading opens nothing", async () => {
    let resolve!: (value: unknown) => void;
    listByFolderId.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({ data: liveAlert() } as never);
    await mountDialog();

    inDialog("alert-calibration-apply-continue")!.click();
    inDialog("o-dialog-secondary-btn")!.click();
    resolve(OPS_LIST);
    await flushPromises();
    expect(router.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
  });

  describe("a prompt closed while its folder lookup is pending", () => {
    const closeBy: Record<string, () => Promise<void>> = {
      "the close button": async () => inDialog("o-dialog-close-btn")!.click(),
      Escape: async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      },
      "the parent (an outside click)": async () => {
        await wrapper!.setProps({ open: false });
      },
    };
    const settle: Record<string, (answer: Deferred) => void> = {
      found: (answer) => answer.resolve(OPS_LIST),
      refused: (answer) => answer.reject(httpError(403)),
    };

    interface Deferred {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
    }

    const pendingLookup = (): Deferred => {
      const answer = {} as Deferred;
      listByFolderId.mockReturnValue(
        new Promise((resolve, reject) => Object.assign(answer, { resolve, reject })) as never,
      );
      return answer;
    };

    // The busy primary disables Cancel, so Cancel can only land in the same tick as the click.
    const closeAndReopen = async (close: (() => Promise<void>) | "Cancel", button: string) => {
      inDialog(button)!.click();
      if (close === "Cancel") inDialog("o-dialog-secondary-btn")!.click();
      else {
        await nextTick();
        expect(inDialog(button)?.getAttribute("aria-busy")).toBe("true");
        await close();
      }
      await flushPromises();
      expect(wrapper!.props("open")).toBe(false);
      await wrapper!.setProps({ open: true });
      await flushPromises();
    };

    const expectNothingOpened = () => {
      expect(router.push).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
      expect(wrapper!.props("open")).toBe(true);
      expect(byTest("alert-calibration-apply-dialog")).not.toBeNull();
    };

    for (const [route, close] of [...Object.entries(closeBy), ["Cancel", "Cancel"] as const]) {
      for (const [outcome, answerWith] of Object.entries(settle)) {
        it(`closed by ${route}, then reopened, opens nothing when the lookup is ${outcome}`, async () => {
          const answer = pendingLookup();
          vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({
            data: liveAlert(),
          } as never);
          await mountDialog();
          await closeAndReopen(close, "alert-calibration-apply-continue");

          answerWith(answer);
          await flushPromises();
          expectNothingOpened();
          expect(
            inDialog("alert-calibration-apply-continue")?.getAttribute("aria-busy"),
          ).toBeNull();
        });
      }
    }

    it("the reopened prompt's own Continue still opens the editor once", async () => {
      const answer = pendingLookup();
      vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({ data: liveAlert() } as never);
      await mountDialog();
      await closeAndReopen(closeBy["the close button"], "alert-calibration-apply-continue");

      inDialog("alert-calibration-apply-continue")!.click();
      answer.resolve(OPS_LIST);
      await flushPromises();
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { org_identifier: "default", prefill: "calibration", folder: "ops" },
        }),
      );
      expect(JSON.parse(sessionStorage.getItem(ALERT_PREFILL_KEY)!)).toHaveProperty("patch");
    });

    it.each(Object.entries(settle))(
      "a stale alert's Review, closed and reopened, opens nothing when the lookup is %s",
      async (_, answerWith) => {
        const answer = pendingLookup();
        vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({
          data: liveAlert({ pending_period_sec: 300 }),
        } as never);
        await mountDialog();
        await closeAndReopen(closeBy["the close button"], "alert-calibration-apply-review");

        answerWith(answer);
        await flushPromises();
        expectNothingOpened();
      },
    );
  });

  it("an unknown folder leaves the link as it is today", async () => {
    vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({ data: liveAlert() } as never);
    for (const answer of [
      () => listByFolderId.mockRejectedValue(httpError(403)),
      () =>
        listByFolderId.mockResolvedValue({
          data: { list: [{ alert_id: "a2", name: "ops_cpu", folder_id: "pay" }] },
        } as never),
    ]) {
      queryClient.clear();
      answer();
      await mountDialog();
      inDialog("alert-calibration-apply-continue")!.click();
      await flushPromises();
      expect(vi.mocked(router.push).mock.calls[0][0]).toStrictEqual({
        name: "editAlert",
        params: { alert_id: "a1" },
        query: { org_identifier: "default", prefill: "calibration" },
      });
      wrapper!.unmount();
    }
  });

  it("a live value that moved withholds Continue", async () => {
    vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({
      data: liveAlert({ pending_period_sec: 300 }),
    } as never);
    await mountDialog();

    const stale = inDialog("alert-calibration-apply-stale");
    expect(stale?.getAttribute("data-severity")).toBe("warning");
    expect(stale?.textContent).toContain("Hold for is now 5 minutes");
    expect(stale?.textContent).toContain("based on 1 minute");
    expect(inDialog("alert-calibration-apply-continue")).toBeNull();
    inDialog("alert-calibration-apply-review")!.click();
    await flushPromises();
    expect(JSON.parse(sessionStorage.getItem(ALERT_PREFILL_KEY)!)).not.toHaveProperty("patch");
  });

  it("denied, deleted and failed states", async () => {
    const get = vi.mocked(alertsService.get_by_alert_id);
    get.mockRejectedValue(httpError(403));
    await mountDialog();
    expect(inDialog("alert-calibration-apply-denied")?.getAttribute("data-severity")).toBe("error");
    expect(inDialog("alert-calibration-apply-continue")).toBeNull();
    expect(get).toHaveBeenCalledWith("default", "a1", undefined, { silentForbidden: true });
    wrapper!.unmount();

    get.mockRejectedValue(httpError(404));
    await mountDialog();
    expect(inDialog("alert-calibration-apply-deleted")?.getAttribute("data-severity")).toBe(
      "default",
    );
    expect(inDialog("alert-calibration-apply-continue")).toBeNull();
    wrapper!.unmount();

    get.mockRejectedValue(httpError(500));
    await mountDialog();
    expect(inDialog("alert-calibration-apply-failed")?.getAttribute("data-severity")).toBe("error");
    get.mockResolvedValue({ data: liveAlert() } as never);
    inDialog("alert-calibration-apply-retry")!.click();
    await flushPromises();
    expect(inDialog("alert-calibration-apply-failed")).toBeNull();
    expect(inDialog("alert-calibration-apply-continue")).not.toBeNull();
  });

  it("an unsupported alert type withholds Continue", async () => {
    vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({
      data: liveAlert({ is_real_time: true }),
    } as never);
    await mountDialog();
    expect(inDialog("alert-calibration-apply-unsupported")?.textContent).toContain(
      "applies only to scheduled alerts",
    );
    expect(inDialog("alert-calibration-apply-continue")).toBeNull();
  });

  it("holds the loaded height with skeleton rows while the alert loads", async () => {
    vi.mocked(alertsService.get_by_alert_id).mockReturnValue(new Promise(() => {}) as never);
    await mountDialog();
    expect(inDialog("alert-calibration-apply-row-pendingPeriodSecs")).not.toBeNull();
    expect(inDialog("alert-calibration-apply-current-loading")).not.toBeNull();
    expect(inDialog("alert-calibration-apply-continue")).toBeNull();
  });
});
