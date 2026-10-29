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
  approvalDiff,
  approvalEditor,
  approvalName,
  approvalObjectId,
  approvalVerb,
  isApprovalChange,
} from "./approvalAnatomy";
import { approvalOf } from "./reducer";

const pause = (args: Record<string, unknown>, tool = "EnableAlert") =>
  approvalOf({ type: "confirmation_required", tool, args });

describe("approvalVerb", () => {
  it("reads a toggle tool as pause or resume, whatever its prefix or casing", () => {
    expect(approvalVerb(pause({ alert_id: "a1", value: false }))).toBe("pause");
    expect(approvalVerb(pause({ alert_id: "a1", value: true }, "o2_enable_alert"))).toBe("resume");
    expect(approvalVerb(pause({ alert_id: "a1", request_body: { enabled: "false" } }))).toBe(
      "pause",
    );
  });

  it("reads a typed change as its kind, and a permission or command prompt as no change", () => {
    expect(approvalVerb(approvalOf({ kind: "update", tool: "o2_UpdateAlert" }))).toBe("update");
    expect(approvalVerb(approvalOf({ tool: "o2_delete", args: { items: [] } }))).toBe("delete");
    expect(approvalVerb(approvalOf({ tool: "bash" }))).toBeNull();
    expect(approvalVerb(pause({ alert_id: "a1" }))).toBeNull();
    expect(isApprovalChange(approvalOf({ tool: "acme", args: { command: "x" } }))).toBe(false);
  });
});

describe("approvalName and approvalObjectId", () => {
  it("names the object by its target, else its request body, and never by its id", () => {
    const card = pause({ org_id: "default", alert_id: "a1", value: false });
    expect(approvalName(card)).toBeNull();
    expect(approvalObjectId(card)).toBe("a1");
    expect(approvalName(pause({ alert_id: "a1", request_body: { name: "cart" } }))).toBe("cart");
  });
});

describe("approvalDiff", () => {
  it("shows a toggle as its one enabled field, one-sided without a current value", () => {
    expect(approvalDiff(pause({ alert_id: "a1", value: false }))).toEqual({
      rows: [{ field: "enabled", after: false }],
      oneSided: true,
    });
  });

  it("keeps only changed fields and drops where the object lives and its own id", () => {
    const card = approvalOf({
      kind: "update",
      tool: "o2_UpdateAlert",
      targets: [{ type: "alert", name: "a", id: "a1" }],
      before: { threshold: "1s", name: "a" },
      after: { threshold: "2s", name: "a", org_id: "o", folder: "f", alert_id: "a1" },
    });
    expect(approvalDiff(card)).toEqual({
      rows: [{ field: "threshold", after: "2s", before: "1s" }],
      oneSided: false,
    });
  });

  it("reads the request body of a raw update and has no diff for a delete", () => {
    const raw = approvalOf({
      kind: "update",
      tool: "o2_UpdateAlert",
      args: { alert_id: "a1", request_body: { threshold: 5 } },
    });
    expect(approvalDiff(raw)?.rows).toEqual([{ field: "threshold", after: 5 }]);
    expect(approvalDiff(approvalOf({ tool: "o2_delete", args: { items: [] } }))).toBeNull();
  });
});

describe("approvalEditor", () => {
  it("opens a single alert change in the alert editor by id", () => {
    expect(approvalEditor(pause({ alert_id: "a1", value: false }), "default")).toEqual({
      type: "alert",
      route: {
        name: "alertList",
        query: { action: "update", alert_id: "a1", name: "", org_identifier: "default" },
      },
    });
  });

  it("offers no editor for a delete, a batch, a type without one or an object without an id", () => {
    const del = approvalOf({
      tool: "o2_delete",
      args: { items: [{ resource_type: "alert", name: "a", id: "1" }] },
    });
    expect(approvalEditor(del, "default")).toBeNull();
    const dashboard = approvalOf({
      kind: "update",
      tool: "o2_UpdateDashboard",
      targets: [{ type: "dashboard", name: "d", id: "d1" }],
    });
    expect(approvalEditor(dashboard, "default")).toBeNull();
    expect(approvalEditor(pause({ value: false }), "default")).toBeNull();
  });
});
