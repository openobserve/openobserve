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
  alertListResponse,
  authorOnly,
  grantAll,
  historySummaryResponse,
  makeSecurityRouter,
  triageOnly,
} from "./__fixtures__/securityFixtures";

vi.mock("@/services/securitySigma", async () =>
  (await import("@/views/Security/__fixtures__/sigmaFixtures")).mockSigmaService(),
);
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
vi.mock("@/lib/overlay/Drawer/ODrawer.vue", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return f.drawerStubModule;
});

import SecurityMitre from "./SecurityMitre.vue";

let wrapper: VueWrapper | null = null;
let router: Router;

const mountView = async () => {
  router = await makeSecurityRouter("/security/mitre");
  wrapper = mount(SecurityMitre, { global: { provide: { store }, plugins: [store, router] } });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  grantAll();
  invalidateSiemDetections();
  vi.mocked(alertsService.listByFolderId).mockResolvedValue(alertListResponse() as never);
  vi.mocked(alertsService.getHistorySummary).mockResolvedValue(historySummaryResponse() as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityMitre", () => {
  it("colours techniques covered by the seed detections and counts the firings", async () => {
    const w = await mountView();
    const stopLogging = w.find('[data-test="security-mitre-cell-T1562.008"]');
    expect(stopLogging.exists()).toBe(true);
    expect(stopLogging.text()).toContain("3");
    expect(w.find('[data-test="security-mitre-cell-T1098.001"]').exists()).toBe(true);
    expect(w.find('[data-test="security-mitre-stat-firing"]').text()).toContain("1");
    expect(alertsService.getHistorySummary).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ alert_ids: "alert-stop-logging,alert-access-key" }),
    );
  });

  it("opens a technique and shows the installed detection in the drawer", async () => {
    const w = await mountView();
    await w.find('[data-test="security-mitre-cell-T1562.008"]').trigger("click");
    await flushPromises();
    const drawer = w.find('[data-test="security-mitre-drawer"]');
    expect(drawer.exists()).toBe(true);
    expect(drawer.text()).toContain("T1562.008");
    expect(
      w
        .find(
          '[data-test="security-mitre-detection-AWS_CloudTrail_Logging_Disabled__aws_cloudtrail"]',
        )
        .exists(),
    ).toBe(true);
  });

  it("routes Enable on an uninstalled catalog rule to Detections with its sigma id", async () => {
    const w = await mountView();
    await w.find('[data-test="security-mitre-cell-T1078.004"]').trigger("click");
    await flushPromises();
    const push = vi.spyOn(router, "push");
    await w
      .find('[data-test="security-mitre-enable-2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1"]')
      .trigger("click");
    expect(push).toHaveBeenCalledWith({
      path: "/security/detections",
      query: { org_identifier: "default", sigma_id: "2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1" },
    });
  });

  it("hides covered techniques under the Gaps view", async () => {
    const w = await mountView();
    await w.find('[data-test="security-mitre-view-gaps"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="security-mitre-cell-T1562.008"]').exists()).toBe(false);
    expect(w.find('[data-test="security-mitre-cell-T1078.004"]').exists()).toBe(true);
  });
});

describe("SecurityMitre authoring access", () => {
  const ENABLE = '[data-test="security-mitre-enable-2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1"]';
  const openGap = async () => {
    const w = await mountView();
    await w.find('[data-test="security-mitre-cell-T1078.004"]').trigger("click");
    await flushPromises();
    return w;
  };

  it("shows a triage-only analyst the gap without an Enable control", async () => {
    triageOnly();
    const w = await openGap();
    expect(w.find('[data-test="security-mitre-drawer"]').exists()).toBe(true);
    expect(w.find(ENABLE).exists()).toBe(false);
  });

  it("offers Enable to an author", async () => {
    authorOnly();
    const w = await openGap();
    expect(w.find(ENABLE).exists()).toBe(true);
  });
});
