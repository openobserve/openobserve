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

import type { PendingApproval } from "@/composables/assistant";
import { gt, raw } from "@/types/i18n";

import { runRequest, runTitle } from "./runsText";
import { runRow } from "./runsTestKit";

const card = (over = {}) =>
  ({
    kind: "delete",
    tool: "delete_alert",
    targets: [{ type: "alert", name: "nginx_5xx", id: "1" }],
    ...over,
  }) as unknown as PendingApproval;

describe("runsText", () => {
  it("titles a row, and says where a titleless chat lives", () => {
    expect(runTitle(runRow("a", { title: raw("Top errors") }), gt)).toBe("Top errors");
    expect(runTitle(runRow("a", { title: null }), gt)).toBe("New chat");
    expect(runTitle(runRow("a", { title: null, otherOrg: true, org: "payments" }), gt)).toBe(
      "A chat in payments",
    );
  });

  it("states the request in the card's own words", () => {
    expect(runRequest(runRow("a", { card: card() }), gt)).toBe("Delete alert nginx_5xx");
    expect(runRequest(runRow("a", { card: card({ kind: "update" }) }), gt)).toBe(
      "Update alert nginx_5xx",
    );
    expect(runRequest(runRow("a"), gt)).toBeNull();
  });
});
