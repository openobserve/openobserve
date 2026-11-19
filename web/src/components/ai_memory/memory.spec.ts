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
import type { PendingEdit } from "@/services/ai_memory";
import { authorLabel, diffLines, formatBytes, groupPending, memoryLine } from "./memory";

const edit = (id: string, extra: Partial<PendingEdit> = {}): PendingEdit => ({
  id,
  rev: null,
  state: "pending",
  base_rev: 1,
  edits: [{ op: "add", section: "Services", text: "checkout runs on k8s" }],
  updated_by: `agent:s/${id}`,
  reason: null,
  evidence: null,
  origin_region: "",
  op_id: id,
  created_at: 0,
  flags: [],
  scope: "org",
  scope_key: "",
  ...extra,
});

describe("ai memory helpers", () => {
  it("groups the same proposed change to the same memory and merges flags", () => {
    const groups = groupPending([
      edit("a"),
      edit("b", { flags: ["states_absence"] }),
      edit("c", { scope: "toolset", scope_key: "ts1" }),
    ]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([["a", "b"], ["c"]]);
    expect(groups[0].flags).toEqual(["states_absence"]);
  });

  it("reads update_memory results as saved, pending or refused lines", () => {
    expect(memoryLine("Saved to org memory · rev 4")).toEqual({
      kind: "saved",
      text: "Saved to org memory · rev 4",
    });
    expect(memoryLine("Sent for approval: org memory changes need…\nUse it")?.kind).toBe("pending");
    expect(
      memoryLine("Not saved: org memory changed since your base_rev; it is now rev 5."),
    ).toEqual({ kind: "refused", text: "Not saved: org memory changed since your base_rev" });
    expect(memoryLine("update_memory completed successfully")).toBeNull();
    expect(memoryLine(undefined)).toBeNull();
  });

  it("keeps different proposed texts apart", () => {
    const text = (id: string, content: string) => edit(id, { edits: null, content });
    const groups = groupPending([text("a", "x"), text("b", "y"), text("c", "x")]);
    expect(groups.map((g) => [g.content, g.items.length])).toEqual([
      ["x", 2],
      ["y", 1],
    ]);
  });

  it("diffs two texts by line", () => {
    expect(diffLines("a\nb\nc", "a\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
    expect(diffLines("", "x")).toEqual([{ kind: "added", text: "x" }]);
    const big = (tag: string) => Array.from({ length: 8000 }, (_, i) => `${tag}${i}`).join("\n");
    const huge = diffLines(`top\n${big("a")}`, `top\n${big("b")}`);
    expect(huge[0]).toEqual({ kind: "same", text: "top" });
    expect(huge.filter((l) => l.kind === "removed")).toHaveLength(8000);
  });

  it("formats sizes and authors", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(16384)).toBe("16.0 KiB");
    expect(authorLabel("user:a@b.c")).toBe("a@b.c");
    expect(authorLabel("agent:s1/t1")).toBe("AI agent");
  });
});
