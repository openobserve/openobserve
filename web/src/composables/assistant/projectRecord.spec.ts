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

import { describe, expect, it, vi } from "vitest";

import type { TranslateFn } from "@/types/i18n";

import { assistantFrameSchema } from "./frames";
import {
  KNOWN_FRAME_TYPES,
  hidesAttachments,
  minuteLabel,
  projectRecord,
  type StoredTurn,
} from "./record";

const t = ((key: string) =>
  key === "assistant.record.theModel" ? "the model" : key) as TranslateFn;

const turn = (frames: any[], extra: Partial<StoredTurn> = {}): StoredTurn => ({
  turn_id: "t1",
  created: Date.UTC(2026, 2, 2, 2, 14, 37) * 1000,
  user: { text: "delete it" },
  frames,
  status: "completed",
  ...extra,
});

const card = {
  type: "confirmation_required",
  id: "c1",
  tool: "o2_update",
  kind: "update",
  operation: "Update 1 alert",
  targets: [{ type: "alert", id: "a1", name: "checkout" }],
  before: { threshold: 1 },
  after: { threshold: 2 },
  args: { threshold: 2 },
};

const blocks = (messages: ReturnType<typeof projectRecord>) =>
  messages.flatMap((message) => message.contentBlocks ?? []);

describe("projectRecord", () => {
  it("knows every frame type the parser does", () => {
    const parsed = assistantFrameSchema.options.map((option) => option.shape.type.value);
    expect([...KNOWN_FRAME_TYPES].sort()).toEqual([...parsed].sort());
  });

  it("renders a card with no decision as a record, never as pending", () => {
    const out = projectRecord([turn([card], { status: "running" })], "owner", {
      timezone: "UTC",
      scrubModels: false,
      t,
    });
    const approval = blocks(out).find((block) => block.type === "approval");
    expect(approval?.approval?.noDecision).toBe(true);
    expect(blocks(out).some((block) => block.pendingConfirmation)).toBe(false);
  });

  it("keeps a resolved card's decision and leaves noDecision off", () => {
    const resolved = { type: "confirmation_resolved", id: "c1", approved: false, at: 1_000_123 };
    const out = projectRecord([turn([card, resolved, { type: "complete" }])], "viewer", {
      timezone: "UTC",
      scrubModels: true,
      t,
    });
    expect(blocks(out).find((b) => b.type === "approval")?.approval?.noDecision).toBeUndefined();
    expect(blocks(out).find((b) => b.type === "approval_result")?.resolved?.at).toBe(960_000);
  });

  it("reads how a card without a resolution frame was answered from the chat's approvals", () => {
    const project = (approvals: any[]) =>
      blocks(
        projectRecord([turn([card, { type: "complete" }])], "owner", {
          timezone: "UTC",
          scrubModels: false,
          t,
          approvals,
        }),
      ).find((block) => block.type === "approval")?.approval;
    expect(project([{ id: "c1", status: "approved", at: 1_000_123 }])).toMatchObject({
      recorded: { status: "approved", at: 960_000 },
    });
    expect(project([{ id: "c1", status: "denied" }])?.recorded).toEqual({ status: "denied" });
    expect(project([{ id: "c1", status: "expired" }])?.recorded).toEqual({ status: "expired" });
    expect(project([{ id: "c1", status: "withdrawn" }])?.recorded).toEqual({ status: "withdrawn" });
    expect(project([{ id: "c1", status: "pending" }])?.noDecision).toBe(true);
    expect(project([{ id: "c1", status: "approved" }])?.noDecision).toBe(true);
    expect(project([{ id: "other", status: "denied" }])?.noDecision).toBe(true);
    expect(project([])?.recorded).toBeUndefined();
  });

  it("redacts a link to its kind and action, and a navigation action to the fixed label", () => {
    const nav = {
      type: "navigation_action",
      resource_type: "logs",
      action: "load_query",
      label: "payments errors",
      target: { stream: "payments", sql: "SELECT * FROM payments", from: 1, to: 2 },
    };
    const out = projectRecord([turn([nav, { type: "complete" }])], "viewer", {
      timezone: "UTC",
      scrubModels: true,
      redacted: true,
      t,
    });
    const link = blocks(out).find((block) => block.type === "link")?.link;
    expect(link).toEqual({
      resourceType: "logs",
      action: "load_query",
      target: {},
      redacted: true,
    });
    expect(JSON.stringify(out)).not.toMatch(/payments|SELECT/);
  });

  it("keeps only what a redacted card was, its count and its answer, naming no resource", () => {
    const resolved = {
      type: "confirmation_resolved",
      id: "c1",
      approved: true,
      by: "Priya",
      at: 1_000_123,
    };
    const out = projectRecord([turn([card, resolved, { type: "complete" }])], "viewer", {
      timezone: "UTC",
      scrubModels: true,
      redacted: true,
      t,
    });
    expect(blocks(out).find((b) => b.type === "approval")?.approval).toEqual({
      id: "c1",
      kind: "update",
      total: 1,
    });
    expect(blocks(out).find((b) => b.type === "approval_result")?.resolved).toEqual({
      id: "c1",
      approved: true,
      at: 960_000,
    });
    expect(JSON.stringify(out)).not.toMatch(/checkout|a1|Update 1 alert/);
  });

  it("never names the stream of a hidden step on a redacted link", () => {
    const frames = [
      { type: "tool_call", tool: "SearchSQL", call_id: "q1", context: {} },
      { type: "tool_result", tool: "SearchSQL", call_id: "q1", summary: { rows: 4 } },
      { type: "complete" },
    ];
    const hidden = { q1: { reason: "stream_forbidden" as const, stream: "payments_audit" } };
    const step = (redacted: boolean) =>
      blocks(
        projectRecord([turn(frames)], "viewer", {
          timezone: "UTC",
          scrubModels: true,
          redacted,
          hidden,
          t,
        }),
      ).find((b) => b.call_id === "q1")?.hidden;
    expect(step(false)).toEqual({ reason: "stream_forbidden", stream: "payments_audit" });
    expect(step(true)).toEqual({ reason: "stream_forbidden", stream: "" });
  });

  it("drops the prompt's images when attachments are hidden, by default on public links", () => {
    const image = {
      filename: "a.png",
      mime: "image/png",
      url: "data:image/png;base64,iVBORw0KGgo=",
    };
    const withImage = turn([{ type: "complete" }], { user: { text: "see", images: [image] } });
    const shown = projectRecord([withImage], "viewer", { timezone: "UTC", scrubModels: true, t });
    const hiddenOut = projectRecord([withImage], "viewer", {
      timezone: "UTC",
      scrubModels: true,
      hideAttachments: true,
      t,
    });
    expect(shown[0].images).toHaveLength(1);
    expect(hiddenOut[0].images).toBeUndefined();
    expect(hidesAttachments({ visibility: "public" })).toBe(true);
    expect(hidesAttachments({ visibility: "org" })).toBe(false);
    expect(hidesAttachments({ visibility: "public", hide_attachments: false })).toBe(false);
    expect(hidesAttachments({ visibility: "org", hide_attachments: true })).toBe(true);
  });

  it("scrubs model names for viewers and exports and keeps them for the owner unless asked", () => {
    const frames = [{ type: "message_delta", content: "Using gpt-4o today" }, { type: "complete" }];
    const owner = projectRecord([turn(frames)], "owner", {
      timezone: "UTC",
      scrubModels: false,
      t,
    });
    const ownerScrubbed = projectRecord([turn(frames)], "owner", {
      timezone: "UTC",
      scrubModels: true,
      t,
    });
    const exported = projectRecord([turn(frames)], "export", {
      timezone: "UTC",
      scrubModels: false,
      t,
    });
    expect(String(owner[1].content)).toContain("gpt-4o");
    expect(String(ownerScrubbed[1].content)).toBe("Using the model today");
    expect(String(exported[1].content)).toBe("Using the model today");
  });

  it("ignores unknown kinds with one warning per kind", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = projectRecord(
      [turn([{ type: "future" }, { type: "future" }, { type: "message_delta", content: "ok" }])],
      "owner",
      { timezone: "UTC", scrubModels: false, t },
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(out[1].content)).toBe("ok");
    warn.mockRestore();
  });

  it("floors times to the minute and labels them in the org zone", () => {
    const out = projectRecord([turn([{ type: "complete" }])], "owner", {
      timezone: "UTC",
      scrubModels: false,
      t,
    });
    expect(out[0].sentAt).toBe(Date.UTC(2026, 2, 2, 2, 14));
    expect(minuteLabel(Date.UTC(2026, 2, 2, 2, 14), "Asia/Kolkata")).toBe("07:44");
    expect(minuteLabel(Date.UTC(2026, 2, 2, 2, 14), "Not/AZone")).toMatch(/^\d\d:\d\d$/);
  });
});
