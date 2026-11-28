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

import { describe, expect, it } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import type { SecretDetail } from "@/services/secrets";
import {
  buildPolicyRequest,
  makeSecretPolicySchema,
  secretPolicyDefaults,
  type SecretPolicyForm,
} from "./SecretPolicy.schema";
import { buildCreateRequest, createDefaults } from "./SecretForms.schema";

const t = i18n.global.t as unknown as TranslateFn;

const detail = (over: Partial<SecretDetail> = {}): SecretDetail => ({
  id: "s1",
  name: "SLACK_WEBHOOK_PATH",
  description: "",
  kind: "secret",
  state: "active",
  envs: [],
  allowed_consumers: [{ type: "alert_destination", ids: ["ops-alerts"] }],
  allowed_hosts: ["hooks.slack.com"],
  pin_mode: "hosts",
  private_locations: "off",
  policy_rev: "rev-1",
  usage_count: 1,
  ...over,
});

const issues = (v: SecretPolicyForm, kind: "secret" | "variable" = "secret") => {
  const r = makeSecretPolicySchema(t, kind).safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("secret policy form (V38, R17)", () => {
  it("accepts the stored policy as is", () => {
    expect(issues(secretPolicyDefaults(detail()))).toEqual([]);
  });

  it("refuses Allow any host without a reason", () => {
    const v = { ...secretPolicyDefaults(detail()), pin_mode: "any" as const };
    expect(issues(v)).toEqual(["pin_override_reason"]);
    expect(issues({ ...v, pin_override_reason: "  " })).toEqual(["pin_override_reason"]);
    expect(issues({ ...v, pin_override_reason: "rotated weekly" })).toEqual([]);
  });

  it("refuses private locations without a reason", () => {
    const v = { ...secretPolicyDefaults(detail()), private_locations: true };
    expect(issues(v)).toEqual(["private_locations_reason"]);
    expect(issues({ ...v, private_locations_reason: "EU agent" })).toEqual([]);
  });

  it("refuses an empty host pin and a bare *", () => {
    const v = secretPolicyDefaults(detail());
    expect(issues({ ...v, hosts: [] })).toEqual(["hosts"]);
    expect(issues({ ...v, hosts: ["*"] })).toEqual(["hosts"]);
  });

  it("needs no pin for a variable", () => {
    const v = secretPolicyDefaults(detail({ kind: "variable", allowed_hosts: [] }));
    expect(issues(v, "variable")).toEqual([]);
  });

  it("builds an any-host body with its reason and no hosts", () => {
    const v = {
      ...secretPolicyDefaults(detail()),
      pin_mode: "any" as const,
      pin_override_reason: " per-customer hosts ",
    };
    expect(buildPolicyRequest(v, detail())).toEqual({
      allowed_consumers: [{ type: "alert_destination", ids: ["ops-alerts"] }],
      allowed_hosts: [],
      pin_mode: "any",
      pin_override_reason: "per-customer hosts",
      private_locations: "off",
      expected_policy_rev: "rev-1",
    });
  });

  it("leaves a legacy private-locations value alone unless it is turned on", () => {
    const d = detail({ private_locations: "legacy" });
    expect(buildPolicyRequest(secretPolicyDefaults(d), d).private_locations).toBeUndefined();
    const on = {
      ...secretPolicyDefaults(d),
      private_locations: true,
      private_locations_reason: "x",
    };
    expect(buildPolicyRequest(on, d)).toMatchObject({
      private_locations: "on",
      private_locations_reason: "x",
    });
  });

  it("starts an unpinned secret on Only these hosts", () => {
    expect(secretPolicyDefaults(detail({ pin_mode: "none", allowed_hosts: [] })).pin_mode).toBe(
      "hosts",
    );
  });
});

describe("create body", () => {
  it("sends hosts only for a secret and grants only with FGA on", () => {
    const v = {
      ...createDefaults("secret"),
      name: " PD_KEY ",
      value: "v",
      hosts: ["events.pagerduty.com"],
      use_roles: ["sre"],
    };
    expect(buildCreateRequest("secret", v, false)).toEqual({
      name: "PD_KEY",
      kind: "secret",
      description: "",
      value: "v",
      allowed_consumers: [{ type: "alert_destination" }],
      allowed_hosts: ["events.pagerduty.com"],
    });
    expect(buildCreateRequest("secret", v, true).grants).toEqual({ use: ["sre"], manage: [] });
    expect(buildCreateRequest("variable", v, false).allowed_hosts).toBeUndefined();
  });
});
