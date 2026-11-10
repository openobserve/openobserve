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

vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return {
    ...actual,
    default: { ...actual.default, listDismissals: vi.fn(), reopenDismissal: vi.fn() },
  };
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { queryClient } from "@/composables/query/queryClient";
import alertCalibration from "@/services/alert_calibration";
import { toast } from "@/lib/feedback/Toast/useToast";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import AlertCalibrationDismissedList from "./AlertCalibrationDismissedList.vue";
import { dismissalCopy, type DismissalPage, type DismissalView } from "./dismissals";

const t = i18n.global.t as unknown as TranslateFn;
const FEB_3_2027 = new Date(2027, 1, 3).getTime() * 1000;

const view = (overrides: Partial<DismissalView> = {}): DismissalView => ({
  id: "f".repeat(64),
  rule_id: "no_destination",
  pattern: null,
  scope_kind: "alert",
  scope_key: "alertid0001",
  state: "active",
  revision: 1,
  reason: "known_issue",
  note: "Owned by the ingest team",
  has_note: true,
  actor: "u-ops@example.com",
  dismissed_at: Date.now() * 1000 - 7_200_000_000,
  duration_days: 90,
  expires_at: FEB_3_2027,
  reopened_at: null,
  reopened_by: null,
  updated_at: Date.now() * 1000,
  alert_name: "ops_cpu",
  ...overrides,
});

const page = (items: DismissalView[], total = items.length, next_cursor: string | null = null) =>
  ({ data: { items, next_cursor, total } satisfies DismissalPage }) as never;

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { code: status } } });

let wrapper: VueWrapper | null = null;

const mountList = async () => {
  wrapper = mount(AlertCalibrationDismissedList, {
    attachTo: document.body,
    global: { plugins: [store, withQueryClient(queryClient)] },
  });
  await settle();
  return wrapper;
};

const settle = async () => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  }
};

const text = () => wrapper?.text() ?? "";
const reopenButtons = () =>
  wrapper?.findAll('[data-test="alert-calibration-dismissed-reopen"]') ?? [];

describe("AlertCalibrationDismissedList", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(toast).mockReset();
    vi.mocked(alertCalibration.listDismissals).mockReset();
    vi.mocked(alertCalibration.reopenDismissal).mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("the_dismissed_list_names_things_never_ids", async () => {
    vi.mocked(alertCalibration.listDismissals).mockResolvedValueOnce(page([]));
    await mountList();
    expect(wrapper?.find('[data-test="alert-calibration-dismissed-empty"]').exists()).toBe(true);
    expect(text()).toContain("No dismissed findings");
    wrapper?.unmount();

    queryClient.clear();
    vi.mocked(alertCalibration.listDismissals).mockResolvedValueOnce(page([view()]));
    await mountList();
    expect(reopenButtons()).toHaveLength(1);
    expect(text()).toContain("ops_cpu");
    expect(text()).toContain("No destination");
    expect(text()).toContain("Will fix later");
    expect(text()).toContain("Owned by the ingest team");
    expect(text()).toContain("Feb 3, 2027");
    expect(text()).toContain("u-ops@example.com, 2 hours ago");
    expect(text()).toContain("Ended dismissals are not listed.");
    wrapper?.unmount();

    queryClient.clear();
    const odd = [
      view({ id: "1".repeat(64), alert_name: null, scope_key: "deletedalert1" }),
      view({ id: "2".repeat(64), note: null, has_note: true, scope_key: "hiddennote1" }),
      view({ id: "3".repeat(64), reason: "made_up" as never, note: null, has_note: false }),
      view({ id: "4".repeat(64), rule_id: "made_up", expires_at: null, duration_days: null }),
      view({ id: "5".repeat(64), rule_id: "failure", pattern: "stream_missing" }),
    ];
    vi.mocked(alertCalibration.listDismissals).mockResolvedValueOnce(page(odd));
    await mountList();
    expect(text()).toContain("Deleted alert");
    expect(wrapper?.find('[data-test="alert-calibration-dismissed-note-hidden"]').text()).toBe(
      "Hidden",
    );
    expect(text()).toContain("Another reason");
    expect(text()).toContain("Another rule");
    expect(text()).toContain("Until undone");
    expect(text()).toContain("Alert not working: Stream not found");
    for (const row of odd) {
      expect(text()).not.toContain(row.scope_key);
      expect(text()).not.toContain(row.id);
    }
    expect(text()).not.toMatch(/made_up|known_issue|stream_missing|no_destination/);
  });

  it("a_capped_list_says_how_many_it_shows", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      view({ id: i.toString(16).padStart(64, "0"), alert_name: `ops_a${i}` }),
    );
    for (let p = 0; p < 6; p += 1) {
      vi.mocked(alertCalibration.listDismissals).mockResolvedValueOnce(
        page(rows.slice(p * 200, p * 200 + 200), 1234, `c${p + 1}`),
      );
    }
    await mountList();
    expect(wrapper?.find('[data-test="alert-calibration-dismissed-capped"]').text()).toBe(
      "Showing 1,000 of 1,234 dismissed findings.",
    );
    expect(dismissalCopy(t, "en-US").filterDismissed(1234)).toBe("Dismissed (1,234)");
    expect(reopenButtons()).toHaveLength(25);
  });

  it("a short list shows no cap line", async () => {
    vi.mocked(alertCalibration.listDismissals).mockResolvedValueOnce(page([view()]));
    await mountList();
    expect(wrapper?.find('[data-test="alert-calibration-dismissed-capped"]').exists()).toBe(false);
  });

  it("reopen_waits_for_the_server_and_the_list", async () => {
    vi.mocked(alertCalibration.listDismissals).mockResolvedValueOnce(page([view()]));
    await mountList();
    let land: (value: unknown) => void = () => {};
    vi.mocked(alertCalibration.listDismissals).mockImplementationOnce(
      () => new Promise((resolve) => (land = resolve)) as never,
    );
    vi.mocked(alertCalibration.reopenDismissal).mockResolvedValue({
      data: view({ state: "reopened", revision: 2 }),
    } as never);

    await reopenButtons()[0].trigger("click");
    await settle();
    expect(alertCalibration.reopenDismissal).toHaveBeenCalledTimes(1);
    expect(reopenButtons()[0].attributes("aria-busy")).toBe("true");
    expect(toast).not.toHaveBeenCalled();

    land(page([]));
    await settle();
    expect(toast).toHaveBeenCalledWith({
      message: t("alertCalibration.dismiss.reopened"),
      variant: "success",
    });
    expect(reopenButtons()).toHaveLength(0);
    expect(text()).toContain("No dismissed findings");
  });

  it("a_reopen_conflict_refreshes_and_warns", async () => {
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(page([view()]));
    vi.mocked(alertCalibration.reopenDismissal).mockRejectedValue(httpError(409));
    await mountList();
    expect(alertCalibration.listDismissals).toHaveBeenCalledTimes(1);

    await reopenButtons()[0].trigger("click");
    await settle();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      message: t("alertCalibration.dismiss.reopenChanged"),
      variant: "warning",
    });
    expect(alertCalibration.listDismissals).toHaveBeenCalledTimes(2);
  });

  it("reopen_sends_the_revision_on_screen", async () => {
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(page([view({ revision: 3 })]));
    vi.mocked(alertCalibration.reopenDismissal).mockResolvedValue({
      data: view({ state: "reopened", revision: 4 }),
    } as never);
    await mountList();
    await reopenButtons()[0].trigger("click");
    await settle();
    expect(alertCalibration.reopenDismissal).toHaveBeenCalledWith("default", "f".repeat(64), 3);
  });

  it("a refused first read says what access is missing, with no Retry", async () => {
    vi.mocked(alertCalibration.listDismissals).mockRejectedValue(httpError(403));
    await mountList();
    const error = wrapper?.find('[data-test="alert-calibration-dismissed-error"]');
    expect(error?.text()).toContain("You don't have access to Alert calibration");
    expect(error?.find('[data-test="alert-calibration-dismissed-retry"]').exists()).toBe(false);
  });

  it("a failed first read shows the error state and retries", async () => {
    vi.mocked(alertCalibration.listDismissals).mockRejectedValue(httpError(500));
    await mountList();
    const error = wrapper?.find('[data-test="alert-calibration-dismissed-error"]');
    expect(error?.text()).toContain("Couldn't load dismissed findings");
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(page([view()]));
    await error?.find("button").trigger("click");
    await settle();
    expect(reopenButtons()).toHaveLength(1);
  });
});
