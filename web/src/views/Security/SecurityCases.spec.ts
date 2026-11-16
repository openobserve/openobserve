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
import incidentsService from "@/services/incidents";
import securityCases from "@/services/securityCases";
import securitySigma from "@/services/securitySigma";
import { invalidateSiemDetections } from "@/composables/security/useSiemDetections";
import {
  ATTACKER_IP,
  HOUR_US,
  RULE_STOP_LOGGING,
  alertListResponse,
  grantAll,
  incident,
  makeSecurityRouter,
  nowMicros,
  okResponse,
  readOnly,
  settle,
  triageOnly,
} from "./__fixtures__/securityFixtures";

const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});
vi.mock("@/services/alerts", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/alerts")>());
});
vi.mock("@/services/incidents", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/incidents")>());
});
vi.mock("@/services/securitySigma", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securitySigma")>());
});
vi.mock("@/services/securityCases", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securityCases")>());
});
vi.mock("@/composables/security/useSecurityAccess", async (importOriginal) => {
  const f = await import("./__fixtures__/securityFixtures");
  return {
    ...(await importOriginal<typeof import("@/composables/security/useSecurityAccess")>()),
    useSecurityAccess: f.mockSecurityAccess,
    loadSecurityAccess: async () => ({ read: true, ...f.accessGrants }),
    isSecurityGated: () => false,
  };
});
vi.mock("@/composables/useRcaTrigger", () => ({
  useRcaTrigger: () => ({ requestRca: vi.fn() }),
  default: () => ({ requestRca: vi.fn() }),
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: (...args: unknown[]) => toastMock(...args),
}));
vi.mock("@/lib/overlay/Drawer/ODrawer.vue", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return f.drawerStubModule;
});

import SecurityCases from "./SecurityCases.vue";

let wrapper: VueWrapper | null = null;
let router: Router;

const okta = incident({
  id: "inc-carol-mfa",
  severity: "P2",
  status: "acknowledged",
  title: "carol@acme.io MFA reset after password spray",
  assigned_to: "dave@acme.io",
  group_values: { actor_alternateid: "carol@acme.io", client_ipaddress: ATTACKER_IP },
});

const caseDetail = () => ({
  ...incident(),
  alerts: [],
  triggers: [
    {
      alert_id: "alert-stop-logging",
      alert_name: "AWS_CloudTrail_Logging_Disabled__aws_cloudtrail",
      alert_fired_at: nowMicros() - HOUR_US,
    },
    {
      alert_id: "alert-cpu",
      alert_name: "High_CPU_on_web-01",
      alert_fired_at: nowMicros() - HOUR_US,
    },
  ],
});

const mountView = async (start = "/security/cases") => {
  router = await makeSecurityRouter(start);
  wrapper = mount(SecurityCases, { global: { provide: { store }, plugins: [store, router] } });
  await settle();
  return wrapper;
};

const TILE_TOTALS: Record<string, number> = { open: 1, acknowledged: 1, resolved: 4 };
/** The page's search, and the stat tiles' per-status count searches (`limit: 1`). */
const listWithTotals =
  (rows: unknown[] = [incident(), okta], total = rows.length) =>
  async (_org: string, params: any) =>
    okResponse(
      params.limit === 1 && params.status?.length === 1 && !params.select_all
        ? { incidents: [], total: TILE_TOTALS[params.status[0]], capped: false }
        : { incidents: rows, total, capped: false },
    );

const noise = incident({
  id: "inc-gcp-noise",
  severity: "P3",
  status: "open",
  title: "GCP Service Account Key Created",
  group_values: { security_detection: "alert-gcp" },
  entities: [{ kind: "user", value: "ci@acme-prod.iam" }],
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => `inc-${i}`);

const selectPage = (w: VueWrapper) =>
  w.find('[data-test="o2-table-select-all"] button[role="checkbox"]').trigger("click");

const openMenu = async (w: VueWrapper) => {
  const trigger = w.find('[data-test="security-cases-drawer-more"]');
  await trigger.trigger("keydown", { key: "Enter" });
  await settle();
};
const menuItem = (w: VueWrapper, test: string) =>
  w.findAllComponents({ name: "ODropdownItem" }).find((c) => c.attributes("data-test") === test);

const rowOf = (w: VueWrapper, text: string) =>
  w.findAll('[data-test="security-cases-table"] tr').find((tr) => tr.text().includes(text));

beforeEach(() => {
  grantAll();
  invalidateSiemDetections();
  vi.mocked(alertsService.listByFolderId).mockResolvedValue(alertListResponse() as never);
  vi.mocked(incidentsService.list).mockImplementation(((
    _org: string,
    status: string | undefined,
    size: number,
  ) =>
    Promise.resolve(
      okResponse(
        size === 1
          ? { incidents: [], total: { open: 1, acknowledged: 1, resolved: 4 }[status ?? "open"] }
          : { incidents: [incident(), okta], total: 2 },
      ),
    )) as never);
  vi.mocked(securityCases.searchCases).mockImplementation(listWithTotals() as never);
  vi.mocked(incidentsService.get).mockResolvedValue(okResponse(caseDetail()) as never);
  vi.mocked(incidentsService.getEvents).mockResolvedValue(okResponse({ events: [] }) as never);
  vi.mocked(incidentsService.updateStatus).mockResolvedValue(okResponse({}) as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
  localStorage.clear();
});

describe("SecurityCases", () => {
  it("lists correlated cases with priority, assignee and per-status totals", async () => {
    const w = await mountView();
    expect(rowOf(w, "svc-deploy key used from 185.220.101.47")?.text()).toContain("P1");
    const carol = rowOf(w, "carol@acme.io MFA reset after password spray");
    expect(carol?.text()).toContain("P2");
    expect(carol?.text()).toContain("dave@acme.io");
    expect(w.find('[data-test="security-cases-stat-resolved"]').text()).toContain("4");
  });

  it("locks the list for a role without the incidents read instead of printing the 403", async () => {
    vi.mocked(securityCases.searchCases).mockRejectedValue({
      response: { status: 403, data: "Unauthorized Access" },
      message: "Request failed with status code 403",
      config: { method: "get", url: "/api/default/security/cases/search" },
    });
    const w = await mountView();
    expect(w.find('[data-test="security-cases-access-lock"]').exists()).toBe(true);
    expect(w.text()).not.toContain("Request failed with status code 403");
  });

  it("opens a case showing only its SIEM detections and the correlated entities", async () => {
    const w = await mountView();
    await rowOf(w, "svc-deploy key used")!.trigger("click");
    await flushPromises();
    expect(incidentsService.get).toHaveBeenCalledWith("default", "inc-svc-deploy");
    const drawer = w.find('[data-test="security-cases-drawer"]');
    expect(drawer.text()).toContain(RULE_STOP_LOGGING.title);
    expect(drawer.text()).not.toContain("High_CPU_on_web-01");
    expect(w.find('[data-test="security-cases-hidden-alerts"]').exists()).toBe(true);
    expect(w.find('[data-test="security-cases-drawer-entities"]').text()).toContain(ATTACKER_IP);
  });

  it("moves an open case to investigating", async () => {
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    await w.find('[data-test="security-cases-drawer-status-acknowledged"]').trigger("click");
    await flushPromises();
    expect(incidentsService.updateStatus).toHaveBeenCalledWith(
      "default",
      "inc-svc-deploy",
      "acknowledged",
    );
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("hides status, priority, comment and analysis controls without triage access", async () => {
    readOnly();
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    expect(w.find('[data-test="security-cases-drawer"]').text()).toContain("svc-deploy");
    expect(w.find('[data-test="security-cases-drawer-status-acknowledged"]').exists()).toBe(false);
    expect(w.find('[data-test="security-cases-drawer-status-resolved"]').exists()).toBe(false);
    expect(w.find('[data-test="security-cases-drawer-priority"]').exists()).toBe(false);
    expect(w.find('[data-test="security-cases-drawer-comment"]').exists()).toBe(false);
    expect(w.find('[data-test="security-cases-drawer-run-analysis"]').exists()).toBe(false);
  });

  it("lets a triage-only analyst comment on and acknowledge a case", async () => {
    triageOnly();
    vi.mocked(incidentsService.postComment).mockResolvedValue(okResponse({}) as never);
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    w.findComponent({ name: "SecurityRecordDrawer" }).vm.$emit("update:tab", "timeline");
    await flushPromises();
    await w.find('[data-test="security-cases-drawer-comment-field"]').setValue("Checked the key");
    await w.find('[data-test="security-cases-drawer-post-comment"]').trigger("click");
    await flushPromises();
    expect(incidentsService.postComment).toHaveBeenCalledWith(
      "default",
      "inc-svc-deploy",
      "Checked the key",
    );
    await w.find('[data-test="security-cases-drawer-status-acknowledged"]').trigger("click");
    await flushPromises();
    expect(incidentsService.updateStatus).toHaveBeenCalledWith(
      "default",
      "inc-svc-deploy",
      "acknowledged",
    );
  });

  it("tags a backfill-only case as historical in the list and the drawer", async () => {
    vi.mocked(securityCases.searchCases).mockResolvedValue(
      okResponse({
        incidents: [incident({ historical: true }), okta],
        total: 2,
        capped: false,
      }) as never,
    );
    vi.mocked(incidentsService.get).mockResolvedValue(
      okResponse({ ...caseDetail(), historical: true }) as never,
    );
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    expect(w.find('[data-test="security-cases-historical-inc-svc-deploy"]').text()).toContain(
      "Historical (backfill)",
    );
    expect(w.find('[data-test="security-cases-historical-inc-carol-mfa"]').exists()).toBe(false);
    expect(w.find('[data-test="security-cases-drawer-historical"]').exists()).toBe(true);
  });

  it("shows no duration for one moment of activity and the time a closed case took", async () => {
    const at = nowMicros() - 3 * HOUR_US;
    const closed = {
      ...caseDetail(),
      status: "resolved",
      first_alert_at: at,
      last_alert_at: at,
      created_at: at,
      resolved_at: at + 34 * 60_000_000,
    };
    vi.mocked(incidentsService.get).mockResolvedValue(okResponse(closed) as never);
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    const drawer = w.find('[data-test="security-cases-drawer"]').text();
    expect(drawer).toMatch(/Duration\s*—/);
    expect(drawer).toContain("Time to close");
    expect(drawer).toContain("34");
  });

  it("offers case settings to a Security admin", async () => {
    const w = await mountView();
    await w.find('[data-test="security-cases-settings"]').trigger("click");
    await settle();
    expect(w.findComponent({ name: "SecurityCaseSettingsDialog" }).props("open")).toBe(true);
  });

  it("hides case settings from an analyst who cannot administer Security", async () => {
    triageOnly();
    const w = await mountView();
    expect(w.find('[data-test="security-cases-settings"]').exists()).toBe(false);
    expect(w.findComponent({ name: "SecurityCaseSettingsDialog" }).exists()).toBe(false);
  });
  it("searches every page on the server with the filters and keeps them in the URL", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const w = await mountView(
        "/security/cases?priority=P1,P2&assignee=none&detection=alert-stop-logging",
      );
      expect(securityCases.searchCases).toHaveBeenCalledWith("default", {
        status: ["open", "acknowledged"],
        priority: ["P1", "P2"],
        alert_id: ["alert-stop-logging"],
        assignee: "none",
        limit: 50,
        offset: 0,
      });
      await w.find('[data-test="security-cases-search"] input').setValue("svc-deploy");
      await w.find('[data-test="security-cases-filter-entity"] input').setValue("10.0.0.5");
      await vi.advanceTimersByTimeAsync(400);
      await flushPromises();
      expect(securityCases.searchCases).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({ q: "svc-deploy", entity: "10.0.0.5", offset: 0 }),
      );
      expect(router.currentRoute.value.query).toMatchObject({
        priority: "P1,P2",
        assignee: "none",
        detection: "alert-stop-logging",
        q: "svc-deploy",
        entity: "10.0.0.5",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters by status through the stat tiles", async () => {
    const w = await mountView();
    await w.find('[data-test="security-cases-stat-resolved"]').trigger("click");
    await settle();
    expect(securityCases.searchCases).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ status: ["resolved"], limit: 50 }),
    );
  });

  it("counts the stat tiles under the active filters other than status", async () => {
    const w = await mountView("/security/cases?priority=P3&detection=alert-gcp,alert-cpu");
    for (const status of ["open", "acknowledged", "resolved"]) {
      expect(securityCases.searchCases).toHaveBeenCalledWith("default", {
        priority: ["P3"],
        alert_id: ["alert-gcp", "alert-cpu"],
        status: [status],
        limit: 1,
      });
    }
    expect(w.find('[data-test="security-cases-stat-resolved"]').text()).toContain("4");
  });

  it("shows each case's primary entity in its own column, with the rest on hover", async () => {
    vi.mocked(securityCases.searchCases).mockImplementation(
      listWithTotals([
        incident({
          entity: "185.220.101.47",
          entity_kind: "ip",
          entities: [
            { kind: "ip", value: "185.220.101.47" },
            { kind: "user", value: "svc-deploy" },
          ],
          detections: 3,
        }),
        noise,
      ]) as never,
    );
    const w = await mountView();
    const cell = w.find('[data-test="security-cases-entity-inc-svc-deploy"]');
    expect(cell.text()).toContain("185.220.101.47");
    expect(cell.text()).toContain("+1");
    expect(rowOf(w, "svc-deploy key used")?.text()).toContain("3 detections · inc-svc-deploy");
    expect(w.find('[data-test="security-cases-entity-inc-gcp-noise"]').text()).toContain(
      "ci@acme-prod.iam",
    );
  });

  it("offers to select every matching case once the page is selected", async () => {
    vi.mocked(securityCases.searchCases).mockImplementation((async (_org: string, params: any) =>
      okResponse(
        params.select_all && params.priority
          ? { incidents: [], total: 0, ids: [], capped: false }
          : params.select_all
            ? { incidents: [], total: 1500, ids: ids(1000), capped: true }
            : { incidents: [incident(), okta], total: 1500, capped: false },
      )) as never);
    const w = await mountView();
    selectPage(w);
    await settle();
    expect(w.find('[data-test="security-cases-selection-page"]').text()).toContain(
      "All 2 cases on this page are selected.",
    );
    await w.find('[data-test="security-cases-selection-page-action"]').trigger("click");
    await settle();
    expect(securityCases.searchCases).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ select_all: true }),
    );
    expect(w.find('[data-test="security-cases-selection-capped"]').text()).toContain(
      "Only the first 1,000 matching cases are selected.",
    );
    await w.findComponent({ name: "SecurityCaseBulkBar" }).vm.$emit("priority", "P1");
    await settle();
    expect(securityCases.bulkUpdate).toHaveBeenCalledWith("default", {
      ids: ids(1000),
      action: "priority",
      severity: "P1",
    });
  });

  it("leaves P1/P2 cases out of a bulk close unless included, and lists every case's outcome", async () => {
    vi.mocked(securityCases.searchCases).mockImplementation(
      listWithTotals([incident(), okta, noise]) as never,
    );
    vi.mocked(securityCases.bulkUpdate).mockResolvedValue(
      okResponse({ updated: ["inc-gcp-noise"], failed: [] }) as never,
    );
    const w = await mountView();
    selectPage(w);
    await settle();
    await w.find('[data-test="security-cases-bulk-close"]').trigger("click");
    await settle();
    const dialog = w
      .findAllComponents({ name: "SecurityCaseCloseDialog" })
      .find((d) => d.props("count") === 3)!;
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("high")).toEqual([
      expect.objectContaining({ id: "inc-svc-deploy", priority: "P1" }),
      expect.objectContaining({ id: "inc-carol-mfa", priority: "P2" }),
    ]);
    const listCalls = vi.mocked(securityCases.searchCases).mock.calls.length;
    const form = {
      verdict: "benign",
      reason: "Office NAT",
      suppressMinutes: 0,
      includeHigh: false,
    };
    await expect(dialog.props("close")(form)).resolves.toBe(false);
    await settle();
    expect(securityCases.bulkUpdate).toHaveBeenCalledWith("default", {
      ids: ["inc-gcp-noise"],
      action: "close",
      verdict: "benign",
      reason: "Office NAT",
    });
    expect(dialog.props("results")).toEqual([
      expect.objectContaining({ id: "inc-svc-deploy", outcome: "skipped" }),
      expect.objectContaining({ id: "inc-carol-mfa", outcome: "skipped" }),
      expect.objectContaining({
        id: "inc-gcp-noise",
        outcome: "updated",
        entity: "ci@acme-prod.iam",
      }),
    ]);
    expect(vi.mocked(securityCases.searchCases).mock.calls.length).toBeGreaterThan(listCalls);
  });

  it("closes P1/P2 cases only when the analyst includes them", async () => {
    vi.mocked(securityCases.searchCases).mockImplementation(
      listWithTotals([incident(), noise]) as never,
    );
    vi.mocked(securityCases.bulkUpdate).mockResolvedValue(
      okResponse({
        updated: ["inc-svc-deploy", "inc-gcp-noise"],
        failed: [],
        results: [
          { id: "inc-svc-deploy", outcome: "updated", priority: "P1" },
          { id: "inc-gcp-noise", outcome: "updated", priority: "P3", error: "suppress refused" },
        ],
      }) as never,
    );
    const w = await mountView();
    selectPage(w);
    await settle();
    await w.find('[data-test="security-cases-bulk-close-suppress"]').trigger("click");
    await settle();
    const dialog = w
      .findAllComponents({ name: "SecurityCaseCloseDialog" })
      .find((d) => d.props("count") === 2)!;
    expect(dialog.props("suppressPreset")).toBe(true);
    await dialog.props("close")({
      verdict: "benign",
      reason: "Pen test",
      suppressMinutes: 1440,
      includeHigh: true,
    });
    await settle();
    expect(securityCases.bulkUpdate).toHaveBeenCalledWith("default", {
      ids: ["inc-svc-deploy", "inc-gcp-noise"],
      action: "close",
      verdict: "benign",
      reason: "Pen test",
      include_high: true,
      suppress_minutes: 1440,
    });
    expect(dialog.props("results")[1]).toMatchObject({
      outcome: "updated",
      error: "suppress refused",
    });
  });

  it("leaves P1/P2 matches out of select all matching until the analyst includes them", async () => {
    vi.mocked(securityCases.searchCases).mockImplementation((async (_org: string, params: any) =>
      okResponse(
        params.select_all && params.priority
          ? { incidents: [incident()], total: 1, ids: ["inc-svc-deploy"], capped: false }
          : params.select_all
            ? { incidents: [], total: 3, ids: ["inc-svc-deploy", "inc-a", "inc-b"], capped: false }
            : { incidents: [incident(), noise], total: 3, capped: false },
      )) as never);
    const w = await mountView();
    selectPage(w);
    await settle();
    await w.find('[data-test="security-cases-selection-page-action"]').trigger("click");
    await settle();
    expect(securityCases.searchCases).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ priority: ["P1", "P2"], select_all: true }),
    );
    expect(w.find('[data-test="security-cases-selection-high-left-out"]').text()).toContain(
      "1 P1/P2 case was left out of the selection.",
    );
    await w.findComponent({ name: "SecurityCaseBulkBar" }).vm.$emit("priority", "P4");
    await settle();
    expect(securityCases.bulkUpdate).toHaveBeenLastCalledWith(
      "default",
      expect.objectContaining({ ids: ["inc-a", "inc-b"] }),
    );
  });

  it("keeps the cases that failed selected and says why", async () => {
    vi.mocked(securityCases.bulkUpdate).mockResolvedValue(
      okResponse({
        updated: ["inc-svc-deploy"],
        failed: [{ id: "inc-carol-mfa", error: "case is locked" }],
      }) as never,
    );
    const w = await mountView();
    selectPage(w);
    await settle();
    await w.findComponent({ name: "SecurityCaseBulkBar" }).vm.$emit("assign", "");
    await settle();
    expect(securityCases.bulkUpdate).toHaveBeenCalledWith("default", {
      ids: ["inc-svc-deploy", "inc-carol-mfa"],
      action: "assign",
      assigned_to: "",
    });
    expect(toastMock).toHaveBeenCalledWith({
      variant: "warning",
      message: "1 of 2 cases couldn't be updated: case is locked",
    });
    expect(w.find('[data-test="o2-table-selected-count"]').text()).toContain("1");
  });

  it("merges the selected cases into the one the analyst keeps", async () => {
    vi.mocked(securityCases.mergeCases).mockResolvedValue(okResponse(incident()) as never);
    const w = await mountView();
    selectPage(w);
    await settle();
    await w.find('[data-test="security-cases-bulk-merge"]').trigger("click");
    await settle();
    const dialog = w.findComponent({ name: "SecurityCaseMergeDialog" });
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("cases")).toEqual([
      expect.objectContaining({
        id: "inc-svc-deploy",
        title: "svc-deploy key used from 185.220.101.47",
        priority: "P1",
        alertCount: 4,
        createdAt: expect.any(Number),
      }),
      expect.objectContaining({
        id: "inc-carol-mfa",
        title: "carol@acme.io MFA reset after password spray",
        priority: "P2",
      }),
    ]);
    const listCalls = vi.mocked(securityCases.searchCases).mock.calls.length;
    await dialog.props("merge")("inc-svc-deploy", ["inc-carol-mfa"], "same key");
    await settle();
    expect(securityCases.mergeCases).toHaveBeenCalledWith("default", {
      target_id: "inc-svc-deploy",
      source_ids: ["inc-carol-mfa"],
      reason: "same key",
    });
    expect(toastMock).toHaveBeenCalledWith({
      variant: "success",
      message: "1 case merged into svc-deploy key used from 185.220.101.47",
    });
    expect(vi.mocked(securityCases.searchCases).mock.calls.length).toBeGreaterThan(listCalls);
  });

  it("offers no row selection to a reader without triage", async () => {
    readOnly();
    const w = await mountView();
    expect(w.find('[data-test="o2-table-select-all"]').exists()).toBe(false);
    expect(w.find('[data-test="o2-table-select-0"]').exists()).toBe(false);
  });

  it("suppresses similar alerts from a case for a detection author", async () => {
    vi.mocked(securityCases.searchCases).mockImplementation(
      listWithTotals([incident({ entity: "svc-deploy", entity_kind: "user" }), okta]) as never,
    );
    vi.mocked(securityCases.suppress).mockResolvedValue(okResponse({ suppressions: [] }) as never);
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    await openMenu(w);
    menuItem(w, "security-cases-drawer-suppress")!.vm.$emit("select", new Event("select"));
    await settle();
    const dialog = w.findComponent({ name: "SecurityCaseSuppressDialog" });
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("allowLong")).toBe(true);
    await dialog.props("suppress")({ duration: 60, reason: "Scanner", closeCase: true });
    await settle();
    expect(securityCases.suppress).toHaveBeenCalledWith("default", {
      case_id: "inc-svc-deploy",
      duration_minutes: 60,
      reason: "Scanner",
      close_case: true,
    });
    expect(toastMock).toHaveBeenCalledWith({
      variant: "success",
      message: "Similar alerts suppressed for 1 hour",
    });
  });

  it("lets a triage analyst suppress similar for up to 7 days, and close as benign with it", async () => {
    vi.mocked(securityCases.searchCases).mockImplementation(
      listWithTotals([incident({ entity: "svc-deploy", entity_kind: "user" }), okta]) as never,
    );
    triageOnly();
    vi.mocked(securityCases.suppress).mockResolvedValue(okResponse({ suppressions: [] }) as never);
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    await openMenu(w);
    expect(menuItem(w, "security-cases-drawer-suppress")).toBeDefined();
    menuItem(w, "security-cases-drawer-close-suppress")!.vm.$emit("select", new Event("select"));
    await settle();
    const dialog = w
      .findAllComponents({ name: "SecurityCaseCloseDialog" })
      .find((d) => d.props("open"))!;
    expect(dialog.props("suppressPreset")).toBe(true);
    await dialog.props("close")({
      verdict: "benign",
      reason: "Expected CI key rotation",
      suppressMinutes: 1440,
      includeHigh: false,
    });
    await settle();
    expect(securityCases.suppress).toHaveBeenCalledWith("default", {
      case_id: "inc-svc-deploy",
      duration_minutes: 1440,
      reason: "Expected CI key rotation",
      close_case: true,
    });
    expect(securityCases.close).not.toHaveBeenCalled();
  });

  it("offers a triage analyst suppressions of up to 7 days only", async () => {
    vi.mocked(securityCases.searchCases).mockImplementation(
      listWithTotals([incident({ entity: "svc-deploy", entity_kind: "user" }), okta]) as never,
    );
    triageOnly();
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    await openMenu(w);
    menuItem(w, "security-cases-drawer-suppress")!.vm.$emit("select", new Event("select"));
    await settle();
    expect(w.findComponent({ name: "SecurityCaseSuppressDialog" }).props("allowLong")).toBe(false);
  });

  it("hides suppress similar from a reader without triage", async () => {
    readOnly();
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    await openMenu(w);
    expect(menuItem(w, "security-cases-drawer-open-alerts")).toBeDefined();
    expect(menuItem(w, "security-cases-drawer-suppress")).toBeUndefined();
    expect(menuItem(w, "security-cases-drawer-close-suppress")).toBeUndefined();
  });

  it("names the case's detection instead of listing its id as an entity", async () => {
    vi.mocked(incidentsService.get).mockResolvedValue(
      okResponse({
        ...caseDetail(),
        group_values: { security_detection: "alert-stop-logging", security_user: "bob@acme.io" },
      }) as never,
    );
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    const entities = w.find('[data-test="security-cases-drawer-entities"]').text();
    expect(entities).toContain(RULE_STOP_LOGGING.title);
    expect(entities).toContain("bob@acme.io");
    expect(entities).not.toContain("security_detection");
  });

  it("shows each security firing's evidence rows in the drawer's Alerts tab", async () => {
    vi.mocked(securitySigma.evidence).mockResolvedValue(
      okResponse({
        stream: "aws_cloudtrail",
        correlation: false,
        stored: true,
        groups: [
          {
            values: {},
            first_seen: 1,
            last_seen: 2,
            event_count: 1,
            sql: "SELECT 1",
            rows: [{ _timestamp: 2, eventname: "StopLogging", src_ip: ATTACKER_IP }],
          },
        ],
      }) as never,
    );
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    w.findComponent({ name: "SecurityRecordDrawer" }).vm.$emit("update:tab", "alerts");
    await settle();
    const evidence = w.findAllComponents({ name: "SecurityCaseFiringEvidence" });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].props("alertId")).toBe("alert-stop-logging");
    expect(w.find('[data-test="security-cases-drawer-evidence-0"]').text()).toContain(ATTACKER_IP);
  });

  it("names an unassigned case in the drawer's assignee picker instead of leaving it blank", async () => {
    const w = await mountView("/security/cases?case=inc-svc-deploy");
    const picker = w.find('[data-test="security-cases-drawer-assignee"]');
    expect(picker.text()).toContain("Unassigned");
    expect(
      w
        .findAllComponents({ name: "OSelect" })
        .find((s) => s.attributes("data-test") === "security-cases-drawer-assignee")
        ?.props("modelValue"),
    ).toBeNull();
  });

  describe("round 6", () => {
    const joinedAt = nowMicros() - 5 * 60_000_000;
    const updated = incident({
      id: "inc-sqli",
      severity: "P1",
      status: "acknowledged",
      assigned_to: "dave@acme.io",
      title: "2 detections on 185.220.101.47",
      entity: "185.220.101.47",
      entity_kind: "ip",
      last_detection_at: joinedAt,
    });
    const seenKey = () => `o2.security.caseSeen.default.${store.state.userInfo.email}`;

    it("shows only open and investigating cases by default, and Closed on request", async () => {
      const w = await mountView();
      expect(securityCases.searchCases).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({ status: ["open", "acknowledged"], limit: 50 }),
      );
      w.findComponent('[data-test="security-cases-show-closed"]').vm.$emit(
        "update:modelValue",
        true,
      );
      await settle();
      const last = vi.mocked(securityCases.searchCases).mock.calls.at(-1)![1];
      expect(last.status).toBeUndefined();
      expect(router.currentRoute.value.query.status).toBe("all");
    });

    it("flags a case another detection joined since I last looked, first on the page", async () => {
      vi.mocked(securityCases.searchCases).mockImplementation(
        listWithTotals([incident(), okta, updated]) as never,
      );
      const w = await mountView();
      expect(w.find('[data-test="security-cases-updated-inc-sqli"]').exists()).toBe(true);
      expect(w.find('[data-test="security-cases-updated-inc-svc-deploy"]').exists()).toBe(false);
      const rows = w.findAll('[data-test="security-cases-table"] tbody tr');
      expect(rows[0].text()).toContain("2 detections on 185.220.101.47");
    });

    it("marks the case seen when its drawer opens, keeping the badge in the drawer", async () => {
      vi.mocked(securityCases.searchCases).mockImplementation(
        listWithTotals([incident(), updated]) as never,
      );
      const w = await mountView("/security/cases?case=inc-sqli");
      expect(w.find('[data-test="security-cases-drawer-updated"]').exists()).toBe(true);
      const stored = JSON.parse(localStorage.getItem(seenKey()) ?? "{}");
      expect(stored["inc-sqli"]).toBeGreaterThanOrEqual(joinedAt);
      expect(w.find('[data-test="security-cases-updated-inc-sqli"]').exists()).toBe(false);
    });

    it("lists only detections with cases in the filter, with their counts", async () => {
      vi.mocked(securityCases.searchCases).mockImplementation((async (org: string, params: any) => {
        const res = await listWithTotals()(org, params);
        return okResponse({
          ...res.data,
          detection_facets: [
            { alert_id: "alert-gcp", alert_name: "GCP_Key__gcp", title: "GCP key", count: 1 },
            { alert_id: "alert-stop-logging", alert_name: "x", title: "y", count: 3 },
          ],
        });
      }) as never);
      const w = await mountView();
      const options = w
        .findAllComponents({ name: "OSelect" })
        .find((c) => c.attributes("data-test") === "security-cases-filter-detection")!
        .props("options") as { label: string; value: string }[];
      expect(options.map((o) => o.value)).toEqual(["alert-stop-logging", "alert-gcp"]);
      expect(options[0].label).toMatch(/· 3 cases$/);
      expect(options[1].label).toBe("GCP key · 1 case");
    });

    it("offers no suppress similar on a case that names no entity, and says why", async () => {
      const w = await mountView("/security/cases?case=inc-svc-deploy");
      await openMenu(w);
      expect(menuItem(w, "security-cases-drawer-suppress")).toBeUndefined();
      expect(menuItem(w, "security-cases-drawer-suppress-unavailable")?.props("disabled")).toBe(
        true,
      );
      menuItem(w, "security-cases-drawer-close-suppress")!.vm.$emit("select", new Event("select"));
      await settle();
      const dialog = w
        .findAllComponents({ name: "SecurityCaseCloseDialog" })
        .find((d) => d.props("open"))!;
      expect(dialog.props("noEntity")).toBe(1);
    });

    it("lets a triage analyst read the active suppressions without ending them", async () => {
      triageOnly();
      vi.mocked(securityCases.listSuppressions).mockResolvedValue(
        okResponse({
          suppressions: [
            {
              id: "s1",
              alert_id: null,
              entity_kind: "ip",
              entity_value: "198.51.100.10",
              until: nowMicros() + HOUR_US,
              reason: "Office NAT",
              created_by: "dave@acme.io",
              created_at: nowMicros(),
            },
          ],
        }) as never,
      );
      const w = await mountView();
      await w.find('[data-test="security-cases-suppressions"]').trigger("click");
      await settle();
      expect(w.find('[data-test="security-suppression-s1"]').text()).toContain("198.51.100.10");
      expect(w.find('[data-test="security-suppression-end-s1"]').exists()).toBe(false);
    });
  });
});
