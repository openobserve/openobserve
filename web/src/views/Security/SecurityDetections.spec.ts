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
import type { Router } from "vue-router";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";
import { invalidateSiemDetections } from "@/composables/security/useSiemDetections";
import {
  RULE_ACCESS_KEY,
  RULE_STOP_LOGGING,
  alertListResponse,
  authorOnly,
  grantAll,
  historyResponse,
  historySummaryResponse,
  makeSecurityRouter,
  okResponse,
  settle,
  triageOnly,
} from "./__fixtures__/securityFixtures";

const toastMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/alerts", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/alerts")>());
});
vi.mock("@/composables/security/useSecurityAccess", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return {
    useSecurityAccess: f.mockSecurityAccess,
    loadSecurityAccess: async () => ({ read: true, ...f.accessGrants }),
    isSecurityGated: () => false,
  };
});
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: (...args: unknown[]) => toastMock(...args),
}));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));
vi.mock("@/components/security/SecurityNewDetectionDialog.vue", () => ({
  default: { name: "SecurityNewDetectionDialog", template: "<div />" },
}));
vi.mock("@/lib/overlay/Drawer/ODrawer.vue", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return f.drawerStubModule;
});

import SecurityDetections from "./SecurityDetections.vue";

let wrapper: VueWrapper | null = null;
let router: Router;

const mountView = async (start = "/security/detections") => {
  router = await makeSecurityRouter(start);
  wrapper = mount(SecurityDetections, { global: { provide: { store }, plugins: [store, router] } });
  await settle();
  return wrapper;
};

const rowOf = (w: VueWrapper, title: string) =>
  w.findAll('[data-test="security-detections-table"] tr').find((tr) => tr.text().includes(title));

beforeEach(() => {
  grantAll();
  invalidateSiemDetections();
  vi.mocked(alertsService.listByFolderId).mockResolvedValue(alertListResponse() as never);
  vi.mocked(alertsService.getHistorySummary).mockResolvedValue(historySummaryResponse() as never);
  vi.mocked(alertsService.getHistory).mockResolvedValue(historyResponse() as never);
  vi.mocked(alertsService.toggle_state_by_alert_id).mockResolvedValue(okResponse({}) as never);
  vi.mocked(alertsService.delete_by_alert_id).mockResolvedValue(okResponse({}) as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityDetections", () => {
  it("lists only SIEM detections with their stream, technique and 24h firings", async () => {
    const w = await mountView();
    const table = w.find('[data-test="security-detections-table"]');
    expect(table.text()).not.toContain("High_CPU_on_web-01");
    const stop = rowOf(w, RULE_STOP_LOGGING.title);
    expect(stop?.text()).toContain("aws_cloudtrail");
    expect(stop?.text()).toContain("T1562.008");
    expect(stop?.text()).toContain("3");
    expect(rowOf(w, RULE_ACCESS_KEY.title)?.text()).toContain("T1098.001");
    expect(w.find('[data-test="security-detections-stat-all"]').text()).toContain("2");
    expect(w.find('[data-test="security-detections-stat-fired"]').text()).toContain("1");
  });

  it("disables a detection from its row switch", async () => {
    const w = await mountView();
    await w.find('[data-test="security-detections-toggle-alert-stop-logging"]').trigger("click");
    await flushPromises();
    expect(alertsService.toggle_state_by_alert_id).toHaveBeenCalledWith(
      "default",
      "alert-stop-logging",
      false,
      "default",
    );
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("opens the drawer from the URL and deletes the detection after confirmation", async () => {
    confirmMock.mockResolvedValue(true);
    const w = await mountView("/security/detections?detection=alert-access-key");
    const drawer = w.find('[data-test="security-detection-drawer"]');
    expect(drawer.text()).toContain(RULE_ACCESS_KEY.title);
    await w.find('[data-test="security-detection-drawer-delete"]').trigger("click");
    await flushPromises();
    expect(confirmMock).toHaveBeenCalled();
    expect(alertsService.delete_by_alert_id).toHaveBeenCalledWith(
      "default",
      "alert-access-key",
      "default",
    );
    expect(rowOf(w, RULE_ACCESS_KEY.title)).toBeUndefined();
  });

  it("marks a detection whose notifications fail instead of showing it healthy", async () => {
    const listed = alertListResponse() as { data: { list: Record<string, unknown>[] } };
    listed.data.list[0].last_outcome = "notify_failed";
    vi.mocked(alertsService.listByFolderId).mockResolvedValue(listed as never);
    const w = await mountView();
    expect(w.find('[data-test="security-detections-stat-notify-failing"]').text()).toContain("1");
    expect(
      rowOf(w, RULE_STOP_LOGGING.title)
        ?.find('[data-test="security-detections-notify-failing-icon"]')
        .exists(),
    ).toBe(true);
    expect(
      rowOf(w, RULE_ACCESS_KEY.title)
        ?.find('[data-test="security-detections-notify-failing-icon"]')
        .exists(),
    ).toBe(false);
  });

  it("filters the list by search text", async () => {
    const w = await mountView();
    await w.find('[data-test="security-detections-search"] input').setValue("T1098");
    await flushPromises();
    expect(rowOf(w, RULE_ACCESS_KEY.title)).toBeDefined();
    expect(rowOf(w, RULE_STOP_LOGGING.title)).toBeUndefined();
  });
});

describe("SecurityDetections authoring access", () => {
  const sel = (id: string) => `[data-test="${id}"]`;

  it("shows a triage-only analyst no authoring or delete controls", async () => {
    triageOnly();
    const w = await mountView("/security/detections?detection=alert-access-key");
    expect(w.find(sel("security-detections-new")).attributes("disabled")).toBeDefined();
    expect(
      w.find(sel("security-detections-toggle-alert-stop-logging-btn")).attributes("disabled"),
    ).toBeDefined();
    await w.find(sel("security-detections-toggle-alert-stop-logging")).trigger("click");
    await flushPromises();
    expect(alertsService.toggle_state_by_alert_id).not.toHaveBeenCalled();
    expect(w.find(sel("security-detection-drawer-toggle")).exists()).toBe(false);
    expect(w.find(sel("security-detection-drawer-delete")).exists()).toBe(false);
    expect(w.find(sel("security-detection-drawer-view-matches")).exists()).toBe(true);
  });

  it("lets an author create and enable a detection but not delete it", async () => {
    authorOnly();
    const w = await mountView("/security/detections?detection=alert-access-key");
    expect(w.find(sel("security-detections-new")).attributes("disabled")).toBeUndefined();
    expect(
      w.find(sel("security-detections-toggle-alert-stop-logging-btn")).attributes("disabled"),
    ).toBeUndefined();
    expect(w.find(sel("security-detection-drawer-toggle")).exists()).toBe(true);
    expect(w.find(sel("security-detection-drawer-delete")).exists()).toBe(false);
  });
});
