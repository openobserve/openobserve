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

import { gt } from "@/types/i18n";

import {
  chatStatusClass,
  chatStatusOf,
  chatStatusWord,
  inProgressFirst,
  isInProgress,
} from "./chatStatus";

describe("chatStatus", () => {
  it("puts a waiting approval before a running answer, and a failed turn only from this tab", () => {
    expect(chatStatusOf({ pendingApproval: true, activeTurn: true })).toBe("needs_you");
    expect(chatStatusOf({ pendingApproval: false, activeTurn: true })).toBe("answering");
    expect(chatStatusOf({ pendingApproval: false, activeTurn: false }, "failed")).toBe("failed");
    expect(chatStatusOf({ pendingApproval: false, activeTurn: false }, "done")).toBeNull();
  });

  it("reads an expired request as Expired, not as a failure", () => {
    const row = { pendingApproval: false, activeTurn: false };
    const turn = { state: "failed", error: { code: "approval_expired" } };
    expect(chatStatusOf(row, turn)).toBe("expired");
    expect(chatStatusOf(row, { state: "failed", error: { code: "provider_error" } })).toBe(
      "failed",
    );
  });

  it("words a waiting chat with its countdown once the end is known", () => {
    expect(chatStatusWord("needs_you", 202_000, 0, gt)).toBe("Needs you · 3:22");
    expect(chatStatusWord("needs_you", null, 0, gt)).toBe("Needs you");
    expect(chatStatusWord("failed", null, 0, gt)).toBe("Failed");
    expect(chatStatusWord("draft", null, 0, gt)).toBe("Draft");
  });

  it("keeps amber and red off a filled row", () => {
    expect(chatStatusClass("needs_you", false)).toBe("text-assistant-signal-attention");
    expect(chatStatusClass("failed", false)).toBe("text-status-error-text");
    expect(chatStatusClass("answering", false)).toBe("text-text-secondary");
    expect(chatStatusClass("needs_you", true)).toBe("text-text-body");
    expect(chatStatusClass("failed", true)).toBe("text-text-body");
  });

  it("counts only chats that still answer or wait as in progress", () => {
    expect(isInProgress("needs_you")).toBe(true);
    expect(isInProgress("answering")).toBe(true);
    expect(isInProgress("failed")).toBe(false);
    expect(isInProgress(null)).toBe(false);
  });

  it("moves in-progress rows first and keeps each set in its own order", () => {
    const rows = [
      { id: "a", s: null },
      { id: "b", s: "answering" },
      { id: "c", s: "failed" },
      { id: "d", s: "needs_you" },
    ] as const;
    expect(inProgressFirst(rows, (row) => row.s).map((row) => row.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });
});
