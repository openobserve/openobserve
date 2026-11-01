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

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkAttachments,
  knownAttachments,
  resetAttachmentChecks,
  turnsHaveAttachments,
} from "./chatAttachments";

const { api } = vi.hoisted(() => ({ api: { chatTurns: vi.fn() } }));

vi.mock("@/services/ai_chat_share", () => ({ default: api }));

const turn = (user: unknown) => ({ user, frames: [] });

afterEach(() => {
  vi.clearAllMocks();
  resetAttachmentChecks();
});

describe("chatAttachments", () => {
  it("finds images and attachment blocks in stored prompts, and nothing in plain ones", () => {
    expect(turnsHaveAttachments([turn({ text: "why is checkout slow" })])).toBe(false);
    expect(turnsHaveAttachments([turn({ text: "q", images: [{ filename: "a.png" }] })])).toBe(true);
    expect(turnsHaveAttachments([turn({ text: "q\n--- rows.csv ---\na,b\n--- end ---" })])).toBe(
      true,
    );
  });

  it("counts a reply it can't read as holding attachments", () => {
    expect(turnsHaveAttachments(undefined)).toBe(true);
    expect(turnsHaveAttachments({ length: 1 })).toBe(true);
    expect(turnsHaveAttachments([null, turn(null), turn("x")])).toBe(false);
  });

  it("answers from loaded messages, else from an earlier check, else unknown", async () => {
    expect(knownAttachments("o", "c1", [{ role: "user", content: "q" } as any])).toBe("no");
    expect(knownAttachments("o", "c1", undefined)).toBe("unknown");
    api.chatTurns.mockResolvedValue({ data: { turns: [turn({ text: "q" })], has_more: false } });
    expect(await checkAttachments("o", "c1")).toBe(false);
    expect(api.chatTurns).toHaveBeenCalledWith("o", "c1");
    expect(knownAttachments("o", "c1", undefined)).toBe("no");
    expect(knownAttachments("other", "c1", undefined)).toBe("unknown");
  });

  it("treats a cut-off history as holding attachments and lets a failed read throw", async () => {
    api.chatTurns.mockResolvedValue({ data: { turns: [], has_more: true } });
    expect(await checkAttachments("o", "c2")).toBe(true);
    api.chatTurns.mockRejectedValue(new Error("offline"));
    await expect(checkAttachments("o", "c3")).rejects.toThrow("offline");
    expect(knownAttachments("o", "c3", undefined)).toBe("unknown");
  });
});
