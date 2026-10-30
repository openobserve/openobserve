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

import { raw } from "@/types/i18n";

import { mergeLocalRecord, messageGroups, type LocalRecord } from "./historyDb";

const base = (over: Partial<LocalRecord> = {}): LocalRecord => ({
  id: 1,
  timestamp: "2026-10-21T10:00:00.000Z",
  title: "Checkout 5xx",
  messages: [],
  sessionId: "s1",
  userOrgKey: "k1",
  ...over,
});

const turn = (turnId: string, startedAt: number) => ({
  turn_id: turnId,
  startedAt,
  user: { text: turnId },
  frames: [{ type: "message", content: turnId }],
  status: "completed" as const,
});

describe("mergeLocalRecord", () => {
  it("keeps both tabs' turns by id, in start order, and moves rev on each write", () => {
    const tabA = mergeLocalRecord(undefined, base({ turns: [turn("t1", 1)] }), "a");
    expect(tabA.rev).toBe(1);
    const tabB = mergeLocalRecord(tabA, base({ turns: [turn("t2", 2)] }), "b");
    expect(tabB.turns?.map((t) => t.turn_id)).toEqual(["t1", "t2"]);
    expect(tabB.rev).toBe(2);
    expect(tabB.writer).toBe("b");
    const again = mergeLocalRecord(
      tabB,
      base({ turns: [{ ...turn("t1", 1), status: "failed" }] }),
      "a",
    );
    expect(again.turns?.find((t) => t.turn_id === "t1")?.status).toBe("failed");
    expect(again.turns).toHaveLength(2);
  });

  it("treats a legacy row without rev as base zero and keeps its messages", () => {
    const legacy = base({
      messages: [
        { role: "user", content: raw("legacy q"), sentAt: 1 },
        { role: "assistant", content: raw("legacy a") },
      ],
    });
    const next = mergeLocalRecord(
      legacy,
      base({
        messages: [
          { role: "user", content: raw("new q"), sentAt: 2 },
          { role: "assistant", content: raw("new a") },
        ],
      }),
      "a",
    );
    expect(next.rev).toBe(1);
    expect(next.messages.map((m) => String(m.content))).toEqual([
      "legacy q",
      "legacy a",
      "new q",
      "new a",
    ]);
  });

  it("keeps a rename made in another tab over a generated title", () => {
    const renamed = base({ title: "Mine", titleSource: "renamed" });
    const next = mergeLocalRecord(
      renamed,
      base({ title: "Generated", titleSource: "generated" }),
      "b",
    );
    expect(next.title).toBe("Mine");
    expect(next.titleSource).toBe("renamed");
  });
});

describe("messageGroups", () => {
  it("keys a turn by its id, then its send time, then its prompt", () => {
    const groups = messageGroups([
      { role: "user", content: raw("a"), turnId: "t1" },
      { role: "assistant", content: raw("1") },
      { role: "user", content: raw("b"), sentAt: 5 },
      { role: "user", content: raw("c") },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["turn:t1", "at:5", "text:c"]);
    expect(groups[0].messages).toHaveLength(2);
  });
});
