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
  vi.mocked(incidentsService.get).mockResolvedValue(okResponse(caseDetail()) as never);
  vi.mocked(incidentsService.getEvents).mockResolvedValue(okResponse({ events: [] }) as never);
  vi.mocked(incidentsService.updateStatus).mockResolvedValue(okResponse({}) as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
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
    vi.mocked(incidentsService.list).mockRejectedValue({
      response: { status: 403, data: "Unauthorized Access" },
      message: "Request failed with status code 403",
      config: { method: "get", url: "/api/v2/default/alerts/incidents" },
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
    vi.mocked(incidentsService.list).mockResolvedValue(
      okResponse({ incidents: [incident({ historical: true }), okta], total: 2 }) as never,
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
});
