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
import {
  RUM_SESSION_USER_LABEL_ORDERS,
  resolveRumSessionUserLabel,
  rumSessionUserIdentitySelect,
} from "./sessionUserIdentity";

const identity = { user_name: " Ada ", user_email: "ada@example.test", user_id: "42" };

describe("RUM session user labels", () => {
  it.each(RUM_SESSION_USER_LABEL_ORDERS)("uses the first configured field in %s", (order) => {
    const first = order.split("-")[0] as "name" | "email" | "id";
    expect(resolveRumSessionUserLabel(identity, order)).toBe(identity[`user_${first}`].trim());
  });

  it("uses the requested fallback order and skips blank values", () => {
    const withoutName = { ...identity, user_name: " \t\n " };
    expect(resolveRumSessionUserLabel(withoutName, "name-id-email")).toBe("42");
    expect(resolveRumSessionUserLabel(withoutName, "name-email-id")).toBe("ada@example.test");
    expect(
      resolveRumSessionUserLabel({ user_email: " ", user_name: null }, "name-email-id"),
    ).toBeNull();
  });

  it("emits typed nulls for missing columns and normalizes present values before aggregation", () => {
    const sql = rumSessionUserIdentitySelect({ usr_id: true }).join(", ");
    expect(sql).not.toMatch(/usr_name|usr_email/);
    expect(sql).toContain("CAST(NULL AS VARCHAR) AS user_name");
    expect(sql).toContain("CAST(NULL AS VARCHAR) AS user_email");
    expect(sql).toContain(
      "MAX(NULLIF(regexp_replace(CAST(usr_id AS VARCHAR), '^\\s+|\\s+$', '', 'g'), '')) AS user_id",
    );
  });
});
