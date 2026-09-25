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

import { describe, it, expect } from "vitest";
import { buildNavGateContext } from "./useNavGateContext";
import { isNavChildVisible } from "./navGroups";

const oss = { isEnterprise: false, isCloud: false };
const ent = { isEnterprise: true, isCloud: false };

describe("buildNavGateContext", () => {
  it("defaults every flag safely before zoConfig has loaded", () => {
    const ctx = buildNavGateContext({ selectedOrganization: { identifier: "default" } }, oss);
    expect(ctx).toMatchObject({
      isEnterprise: false,
      isCloud: false,
      isMeta: false,
      rbac: false,
      serviceAccount: true,
      orgStorage: false,
      modelPricing: false,
      serviceStreams: true,
      onlineEvals: false,
      databaseMonitoring: false,
    });
    expect(ctx.hiddenMenus.has("")).toBe(true);
  });

  it("reads zoConfig, org settings and the meta org identifier", () => {
    const ctx = buildNavGateContext(
      {
        zoConfig: {
          meta_org: "_meta",
          rbac_enabled: true,
          service_account_enabled: false,
          model_pricing_enabled: true,
          service_streams_enabled: false,
          online_evals_enabled: true,
          database_monitoring_enabled: true,
          custom_hide_menus: "pipelines, alertList",
        },
        organizationData: { organizationSettings: { org_storage_enabled: true } },
        selectedOrganization: { identifier: "_meta" },
      },
      ent,
    );
    expect(ctx).toMatchObject({
      isEnterprise: true,
      isMeta: true,
      rbac: true,
      serviceAccount: false,
      orgStorage: true,
      modelPricing: true,
      serviceStreams: false,
      onlineEvals: true,
      databaseMonitoring: true,
    });
    // Raw split, no trim: mirrors how pages test custom_hide_menus.
    expect(ctx.hiddenMenus.has("pipelines")).toBe(true);
    expect(ctx.hiddenMenus.has(" alertList")).toBe(true);
    expect(ctx.hiddenMenus.has("alertList")).toBe(false);
  });
});

describe("isNavChildVisible", () => {
  const router = { hasRoute: (name: string) => name !== "missing" };
  const ctx = buildNavGateContext({ zoConfig: { custom_hide_menus: "hidden" } }, oss);

  it("hides unregistered routes", () => {
    expect(isNavChildVisible({ name: "missing" }, ctx, router)).toBe(false);
  });

  it("hides routes named in custom_hide_menus", () => {
    expect(isNavChildVisible({ name: "hidden" }, ctx, router)).toBe(false);
  });

  it("applies the gate predicate when present", () => {
    expect(isNavChildVisible({ name: "nodes", gate: "enterprise" }, ctx, router)).toBe(false);
    const entCtx = buildNavGateContext({}, ent);
    expect(isNavChildVisible({ name: "nodes", gate: "enterprise" }, entCtx, router)).toBe(true);
  });

  it("shows an ungated, registered, unhidden child", () => {
    expect(isNavChildVisible({ name: "logstreams" }, ctx, router)).toBe(true);
  });

  it("treats an unknown gate name as open", () => {
    expect(isNavChildVisible({ name: "x", gate: "nope" }, ctx, router)).toBe(true);
  });
});
