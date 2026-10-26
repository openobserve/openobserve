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

import { beforeEach, describe, expect, it, vi } from "vitest";
import config from "@/aws-exports";
import store from "@/stores";
import { routeGuard } from "@/utils/zincutils";
import { slackRouteGuard } from "./slackRouteGuard";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/stores", () => ({ default: { state: { zoConfig: {} as Record<string, unknown> } } }));
vi.mock("@/utils/zincutils", () => ({ routeGuard: vi.fn() }));

const to = { query: { org_identifier: "acme" } };
const toGeneral = { name: "general", query: { org_identifier: "acme" } };

const enter = (zoConfig: Record<string, unknown> | null) => {
  (store.state as any).zoConfig = zoConfig;
  const next = vi.fn();
  slackRouteGuard(to, {}, next);
  return next;
};

beforeEach(() => {
  vi.clearAllMocks();
  config.isEnterprise = "true";
  config.isCloud = "false";
});

describe("slackRouteGuard", () => {
  it("lets an enabled org through on self-hosted and Cloud", () => {
    for (const isCloud of ["false", "true"]) {
      config.isCloud = isCloud;
      const next = enter({ slack_enabled: true });
      expect(next).not.toHaveBeenCalled();
      expect(routeGuard).toHaveBeenLastCalledWith(to, {}, next);
    }
  });

  it("sends every disabled reason to General, on self-hosted and Cloud", () => {
    for (const isCloud of ["false", "true"]) {
      config.isCloud = isCloud;
      for (const reason of ["flag", "master_key", "super_cluster"]) {
        expect(enter({ slack_enabled: false, slack_disabled_reason: reason })).toHaveBeenCalledWith(
          toGeneral,
        );
      }
    }
    expect(routeGuard).not.toHaveBeenCalled();
  });

  it("waits for /config on a cold load instead of bouncing a valid deep link", () => {
    for (const zoConfig of [null, {}]) {
      const next = enter(zoConfig);
      expect(next).not.toHaveBeenCalled();
      expect(routeGuard).toHaveBeenLastCalledWith(to, {}, next);
    }
  });

  it("sends OSS to General before /config loads, never to the locked page", () => {
    config.isEnterprise = "false";
    expect(enter(null)).toHaveBeenCalledWith(toGeneral);
    expect(enter({ slack_enabled: false, slack_disabled_reason: "edition" })).toHaveBeenCalledWith(
      toGeneral,
    );
    expect(routeGuard).not.toHaveBeenCalled();
  });
});
