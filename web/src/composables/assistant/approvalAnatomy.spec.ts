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
  approvalFolderId,
  approvalName,
  approvalNotifies,
  approvalObjectId,
  approvalUntil,
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

describe("the tool arguments a card reads", () => {
  const mute = (args: Record<string, unknown>) => pause(args, "o2_MuteAlert");

  it("reads a mute as pause, ending at ends_at in microseconds or minutes from now", () => {
    const body = { all_groups: true, until_clear: false, minutes: 30 };
    expect(approvalVerb(mute({ alert_id: "a1", request_body: body }))).toBe("pause");
    expect(approvalUntil(mute({ request_body: body }), 1_000)).toBe(1_000 + 30 * 60_000);
    expect(approvalUntil(mute({ ends_at: 1_800_000_000_000_000 }))).toBe(1_800_000_000_000);
  });

  it("names no end for an until-clear mute or a plain disable", () => {
    expect(approvalUntil(mute({ request_body: { until_clear: true } }))).toBeNull();
    expect(approvalUntil(pause({ alert_id: "a1", value: false }))).toBeNull();
  });

  it("takes the folder id from the query or the body", () => {
    expect(approvalFolderId(pause({ folder: "f1" }))).toBe("f1");
    expect(approvalFolderId(mute({ request_body: { folder_id: "f2" } }))).toBe("f2");
    expect(approvalFolderId(pause({}))).toBeNull();
  });

  it("names an alert's destinations and leaves out what is not a name", () => {
    expect(approvalNotifies(pause({ request_body: { destinations: ["a", "b"] } }))).toBe("a, b");
    expect(approvalNotifies(pause({ request_body: { destinations: [{}] } }))).toBeNull();
    expect(approvalNotifies(pause({}))).toBeNull();
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

// The CreateDowntime card o2-ai sends for a bulk mute (o2-ai tests/test_card_gather.py `_DOWNTIME`).
const DOWNTIME_FRAME = {
  type: "confirmation_required",
  id: "apr_dt",
  tool: "CreateDowntime",
  kind: "create",
  operation: "create",
  title: "Mute 2 alerts",
  targets: [
    { type: "alert", id: "a1", name: "latency_high" },
    { type: "alert", id: "a2", name: "checkout_5xx" },
  ],
  schedule: {
    starts_at: 1794226306391,
    ends_at: 1794226306391 + 1_200_000,
    duration_secs: 1200,
    timezone: "Asia/Calcutta",
    repeat: "none",
  },
  args: {
    request_body: {
      name: "Bulk mute",
      reason: "maintenance",
      starts_at: 1794226306391000,
      duration_secs: 1200,
      timezone: "Asia/Calcutta",
      repeat: "none",
      targets: [{ module: "alerts", folders: { kind: "all" }, ids: ["a1", "a2"] }],
    },
  },
};

describe("N3: a downtime (bulk mute) card", () => {
  it("reads as a pause of its alerts", () => {
    expect(approvalVerb(approvalOf(DOWNTIME_FRAME))).toBe("pause");
  });

  it("ends at its start plus its duration, from the microsecond request body", () => {
    expect(approvalUntil(approvalOf(DOWNTIME_FRAME))).toBe(1794226306391 + 1_200_000);
  });

  it("ends at the schedule's end when the window is nested under schedule, as the API takes it", () => {
    const nested = approvalOf({
      ...DOWNTIME_FRAME,
      args: {
        request_body: {
          name: "Bulk mute",
          schedule: {
            repeat: "none",
            starts_at: 1794226306391000,
            ends_at: 1794229906391000,
            duration_secs: 3600,
          },
        },
      },
    });
    expect(approvalUntil(nested)).toBe(1794229906391);
  });
});

describe("N2: a multi-target card keeps each target's own change", () => {
  it("bounds and keeps after, before and before_digest per target", () => {
    const digest = "8d9e9ad0c4595ed3ad067dba4d2fcece7695d1ba5c194b2c16f94e1a6f0580b3";
    const card = approvalOf({
      type: "confirmation_required",
      id: "apr_m",
      tool: "UpdateAlert",
      kind: "update",
      targets: [
        {
          type: "alert",
          id: "3Lrp",
          name: "ta_approvals_rca_latency_high",
          after: { threshold: 4 },
          before: { threshold: 3 },
          before_digest: digest,
        },
        {
          type: "alert",
          id: "3Lrq",
          name: "ta_approvals_rca_checkout_5xx",
          after: { threshold: 6 },
        },
      ],
    });
    expect(card.targets).toEqual([
      {
        type: "alert",
        id: "3Lrp",
        name: "ta_approvals_rca_latency_high",
        after: { threshold: 4 },
        before: { threshold: 3 },
        beforeDigest: digest,
      },
      { type: "alert", id: "3Lrq", name: "ta_approvals_rca_checkout_5xx", after: { threshold: 6 } },
    ]);
  });
});
