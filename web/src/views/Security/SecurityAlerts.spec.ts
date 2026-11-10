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
import searchService from "@/services/search";
import streamService from "@/services/stream";
import securitySigma from "@/services/securitySigma";
import { invalidateSiemDetections } from "@/composables/security/useSiemDetections";
import {
  ATTACKER_IP,
  RULE_ACCESS_KEY,
  RULE_STOP_LOGGING,
  alertListResponse,
  cloudtrailEvent,
  grantAll,
  historyResponse,
  historyRow,
  historySummaryResponse,
  makeSecurityRouter,
  okResponse,
  settle,
  triageOnly,
} from "./__fixtures__/securityFixtures";

vi.mock("@/services/securitySources.queries", async () =>
  (await import("./__fixtures__/securityFixtures")).sourceQueriesModule(),
);
vi.mock("@/services/alerts", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/alerts")>());
});
vi.mock("@/services/incidents", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/incidents")>());
});
vi.mock("@/services/securityCases", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securityCases")>());
});
vi.mock("@/services/search", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/search")>());
});
vi.mock("@/composables/security/useSecurityStreamPlans", async (importOriginal) => {
  const f = await import("./__fixtures__/securityFixtures");
  const { default: searchService } = await import("@/services/search");
  return {
    ...(await importOriginal<typeof import("@/composables/security/useSecurityStreamPlans")>()),
    runSql: f.runSqlVia((body, type) => searchService.search(body, type)),
  };
});
vi.mock("@/services/securitySigma", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securitySigma")>());
});
vi.mock("@/services/stream", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/stream")>());
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
vi.mock("@/components/security/SecuritySeverityChart.vue", () => ({
  default: { name: "SecuritySeverityChart", template: "<div />" },
}));
vi.mock("@/lib/overlay/Drawer/ODrawer.vue", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return f.drawerStubModule;
});

import SecurityAlerts from "./SecurityAlerts.vue";

let wrapper: VueWrapper | null = null;
let router: Router;

const firings = [
  historyRow(),
  historyRow({
    timestamp: historyRow().timestamp - 600_000_000,
    alert_name: "AWS_IAM_Access_Key_Created__aws_cloudtrail",
    alert_id: "alert-access-key",
  }),
];

const mountView = async (start = "/security/alerts") => {
  router = await makeSecurityRouter(start);
  wrapper = mount(SecurityAlerts, { global: { provide: { store }, plugins: [store, router] } });
  await settle();
  return wrapper;
};

const rowOf = (w: VueWrapper, title: string) =>
  w.findAll('[data-test="security-alerts-table"] tr').find((tr) => tr.text().includes(title));

beforeEach(() => {
  grantAll();
  invalidateSiemDetections();
  vi.mocked(alertsService.listByFolderId).mockResolvedValue(alertListResponse() as never);
  vi.mocked(alertsService.getHistorySummary).mockResolvedValue(historySummaryResponse() as never);
  vi.mocked(alertsService.getHistory).mockResolvedValue(historyResponse(firings) as never);
  vi.mocked(streamService.schema).mockResolvedValue(okResponse({ settings: {} }) as never);
  vi.mocked(searchService.search).mockImplementation(((body: {
    query: { query: { sql: string } };
  }) =>
    Promise.resolve(
      okResponse({
        hits: body.query.query.sql.includes("COUNT(*)")
          ? [{ zo_n: 7 }]
          : [
              cloudtrailEvent({
                eventname: "StopLogging",
                eventsource: "cloudtrail.amazonaws.com",
              }),
            ],
      }),
    )) as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityAlerts", () => {
  it("lists firings of SIEM detections with their rule title and technique", async () => {
    const w = await mountView();
    expect(rowOf(w, RULE_STOP_LOGGING.title)?.text()).toContain("T1562.008");
    expect(rowOf(w, RULE_ACCESS_KEY.title)?.text()).toContain("T1098.001");
    const [, query] = vi.mocked(alertsService.getHistory).mock.calls[0];
    expect(query.alert_ids).toBe("alert-stop-logging,alert-access-key");
    expect(query.outcome).toBe("firing,notify_failed,error");
  });

  it("opens a firing and shows the matched CloudTrail events as evidence", async () => {
    const w = await mountView();
    await rowOf(w, RULE_STOP_LOGGING.title)!.trigger("click");
    await flushPromises();
    expect(w.find('[data-test="security-alerts-drawer"]').text()).toContain(
      RULE_STOP_LOGGING.title,
    );
    const sqls = vi.mocked(searchService.search).mock.calls.map(([b]) => b.query.query.sql);
    expect(sqls.some((sql) => sql.includes("StopLogging") && !sql.includes("COUNT"))).toBe(true);
    await w.find('[data-test="security-alerts-drawer-tab-evidence"]').trigger("mousedown", {
      button: 0,
    });
    await flushPromises();
    const evidence = w.find('[data-test="security-alerts-drawer-evidence"]');
    expect(evidence.text()).toContain("svc-deploy");
    expect(evidence.text()).toContain(ATTACKER_IP);
  });

  it("shows the access lock, not the raw error, when the evidence search is forbidden", async () => {
    vi.mocked(searchService.search).mockRejectedValue(
      Object.assign(new Error("Request failed with status code 403"), {
        response: { status: 403, data: {} },
      }),
    );
    const w = await mountView();
    await rowOf(w, RULE_STOP_LOGGING.title)!.trigger("click");
    await flushPromises();
    await w.find('[data-test="security-alerts-drawer-tab-evidence"]').trigger("mousedown", {
      button: 0,
    });
    await flushPromises();
    expect(w.find('[data-test="security-alerts-evidence-access-lock"]').exists()).toBe(true);
    expect(w.text()).not.toContain("Request failed with status code 403");
  });

  it("shows only the rows each fired group stored, with that group's own query", async () => {
    vi.mocked(securitySigma.evidence).mockResolvedValue(
      okResponse({
        stream: "aws_cloudtrail",
        correlation: true,
        stored: true,
        groups: [
          {
            values: { useridentity_username: "svc-deploy" },
            first_seen: 1_700_000_000_000_000,
            last_seen: 1_700_000_060_000_000,
            event_count: 41,
            sql: "SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY x) AS zo_rn) WHERE zo_rn = 1",
            rows: [cloudtrailEvent({ eventname: "StopLogging" })],
          },
        ],
      }) as never,
    );
    const w = await mountView();
    await rowOf(w, RULE_STOP_LOGGING.title)!.trigger("click");
    await flushPromises();
    await w.find('[data-test="security-alerts-drawer-tab-evidence"]').trigger("mousedown", {
      button: 0,
    });
    await flushPromises();
    const groups = w.findAll('[data-test="security-alerts-drawer-evidence-group"]');
    expect(groups).toHaveLength(1);
    expect(groups[0].text()).toContain("useridentity_username=svc-deploy");
    expect(w.find('[data-test="security-alerts-drawer-evidence"]').exists()).toBe(false);
    expect(w.find('[data-test="security-alerts-drawer-sql"]').text()).toContain("zo_rn");
    expect(securitySigma.evidence).toHaveBeenCalledWith(
      "default",
      expect.any(String),
      expect.objectContaining({ firing_time: expect.any(Number) }),
    );
  });

  it("investigates a firing in Events with the detection's own SQL and window", async () => {
    const w = await mountView();
    await rowOf(w, RULE_STOP_LOGGING.title)!.trigger("click");
    await flushPromises();
    const push = vi.spyOn(router, "push");
    await w.find('[data-test="security-alerts-drawer-investigate"]').trigger("click");
    expect(push).toHaveBeenCalledWith({
      path: "/security/events",
      query: expect.objectContaining({
        org_identifier: "default",
        stream: "aws_cloudtrail",
        sql_mode: "true",
        from: String(firings[0].start_time),
        to: String(firings[0].end_time),
      }),
    });
  });

  it("lets a triage-only analyst acknowledge the case a firing belongs to", async () => {
    triageOnly();
    vi.mocked(securityCases.lookup).mockResolvedValue(
      okResponse({
        cases: { "alert-stop-logging": { id: "inc-1", status: "open", severity: "P2" } },
      }) as never,
    );
    vi.mocked(incidentsService.updateStatus).mockResolvedValue(okResponse({}) as never);
    const w = await mountView();
    await rowOf(w, RULE_STOP_LOGGING.title)!.trigger("click");
    await settle();
    await w.find('[data-test="security-alerts-drawer-acknowledge"]').trigger("click");
    await flushPromises();
    expect(incidentsService.updateStatus).toHaveBeenCalledWith("default", "inc-1", "acknowledged");
  });

  it("narrows the queue to the search text and mirrors it in the URL", async () => {
    const w = await mountView();
    await w.find('[data-test="security-alerts-search"] input').setValue("Access Key");
    await settle();
    expect(rowOf(w, RULE_ACCESS_KEY.title)).toBeDefined();
    expect(rowOf(w, RULE_STOP_LOGGING.title)).toBeUndefined();
    expect(router.currentRoute.value.query.q).toBe("Access Key");
  });
});
