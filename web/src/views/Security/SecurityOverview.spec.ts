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
import { ref } from "vue";
import type { Router } from "vue-router";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";
import incidentsService from "@/services/incidents";
import streamService from "@/services/stream";
import { invalidateSiemDetections } from "@/composables/security/useSiemDetections";
import {
  alertListResponse,
  historyResponse,
  historySummaryResponse,
  incident,
  makeSecurityRouter,
  okResponse,
  streamListEntry,
} from "./__fixtures__/securityFixtures";

const sourceNames = ref<string[]>([]);

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
vi.mock("@/services/stream", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/stream")>());
});
vi.mock("@/composables/security/useSecuritySources", async () => {
  const { computed, ref } = await import("vue");
  const { sourceRow } = await import("./__fixtures__/securityFixtures");
  const docs: Record<string, number> = { aws_cloudtrail: 311, okta_auth: 243 };
  return {
    useSecuritySources: () => {
      const sources = computed(() => sourceNames.value.map((n) => sourceRow(n, docs[n] ?? 300)));
      return {
        sourceNames,
        sources,
        rows: sources,
        loading: ref(false),
        load: vi.fn(),
        refetch: vi.fn(async () => {}),
      };
    },
  };
});

import SecurityOverview from "./SecurityOverview.vue";

let wrapper: VueWrapper | null = null;
let router: Router;

const mountView = async () => {
  router = await makeSecurityRouter("/security/overview");
  wrapper = mount(SecurityOverview, { global: { provide: { store }, plugins: [store, router] } });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  invalidateSiemDetections();
  sourceNames.value = ["aws_cloudtrail", "okta_auth"];
  vi.mocked(alertsService.listByFolderId).mockResolvedValue(alertListResponse() as never);
  vi.mocked(alertsService.getHistorySummary).mockResolvedValue(historySummaryResponse() as never);
  vi.mocked(alertsService.getHistory).mockResolvedValue(historyResponse() as never);
  vi.mocked(streamService.schema).mockResolvedValue(okResponse({ settings: {} }) as never);
  vi.mocked(streamService.nameList).mockResolvedValue(
    okResponse({
      list: [
        streamListEntry("aws_cloudtrail", 311),
        streamListEntry("okta_auth", 243),
        streamListEntry("web_access", 436),
      ],
    }) as never,
  );
  vi.mocked(incidentsService.list).mockImplementation(((_org: string, status: string) =>
    Promise.resolve(
      okResponse(
        status === "open" ? { incidents: [incident()], total: 1 } : { incidents: [], total: 0 },
      ),
    )) as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityOverview", () => {
  const rejectCases = (response: Record<string, unknown>) =>
    vi.mocked(incidentsService.list).mockRejectedValue(
      Object.assign(new Error("denied"), {
        response,
        config: { method: "get", url: "/api/default/alerts/incidents" },
      }),
    );

  it("locks the cases panel when incidents are on and the role is refused", async () => {
    store.state.zoConfig.incidents_enabled = true;
    rejectCases({ status: 403, data: {} });
    try {
      const w = await mountView();
      expect(w.find('[data-test="security-overview-cases-access-lock"]').exists()).toBe(true);
      expect(w.find('[data-test="security-overview-cases"]').text()).not.toContain(
        "Case management is not available",
      );
    } finally {
      delete store.state.zoConfig.incidents_enabled;
    }
  });

  it("reads a 403 as cases unsupported when incidents are off", async () => {
    rejectCases({ status: 403, data: {} });
    const w = await mountView();
    expect(w.find('[data-test="security-overview-cases-access-lock"]').exists()).toBe(false);
    expect(w.find('[data-test="security-overview-cases"]').text()).toContain(
      "Case management is not available",
    );
  });

  it("shows the firing detection, the open case and the selected sources", async () => {
    const w = await mountView();
    expect(w.find('[data-test="security-overview-triage-table"]').text()).toContain(
      "AWS CloudTrail Logging Disabled",
    );
    expect(
      w
        .find(
          '[data-test="security-overview-top-detection-AWS_CloudTrail_Logging_Disabled__aws_cloudtrail"]',
        )
        .text(),
    ).toContain("3");
    expect(w.find('[data-test="security-overview-case-inc-svc-deploy"]').text()).toContain(
      "svc-deploy key used from 185.220.101.47",
    );
    expect(w.find('[data-test="security-overview-source-aws_cloudtrail"]').exists()).toBe(true);
    expect(w.find('[data-test="security-overview-source-okta_auth"]').exists()).toBe(true);
    expect(w.find('[data-test="security-overview-source-web_access"]').exists()).toBe(false);
  });

  it("scopes history to SIEM detections only, never the ordinary CPU alert", async () => {
    await mountView();
    const [, query] = vi.mocked(alertsService.getHistorySummary).mock.calls[0];
    expect(query.alert_ids).toBe("alert-stop-logging,alert-access-key");
    expect(incidentsService.list).toHaveBeenCalledWith("default", "open", 50, 0, undefined, true);
  });

  it("opens the full alert queue filtered to a top detection", async () => {
    const w = await mountView();
    const push = vi.spyOn(router, "push");
    await w
      .find(
        '[data-test="security-overview-top-detection-AWS_CloudTrail_Logging_Disabled__aws_cloudtrail"]',
      )
      .trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/security/alerts",
        query: expect.objectContaining({
          org_identifier: "default",
          q: "AWS_CloudTrail_Logging_Disabled__aws_cloudtrail",
        }),
      }),
    );
  });

  it("re-queries a wider window when the range switches to 7 days", async () => {
    const w = await mountView();
    vi.mocked(alertsService.getHistorySummary).mockClear();
    await w.find('[data-test="security-overview-range-7d"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.period).toBe("7d");
    const [, query] = vi.mocked(alertsService.getHistorySummary).mock.calls[0];
    expect(query.end_time - query.start_time).toBe(7 * 24 * 3_600_000 * 1000);
  });
});
