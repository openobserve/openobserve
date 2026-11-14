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

import aiChatBranch from "./ai_chat_branch";
import http from "./http";

vi.mock("./http", () => ({ default: vi.fn() }));

describe("ai chat branch service", () => {
  it("leaves a 403 and a 401 to the assistant, like its other calls", async () => {
    const post = vi.fn().mockResolvedValue({ data: {} });
    vi.mocked(http).mockReturnValue({ post } as never);
    await aiChatBranch.branch("org 1", "s/1", { turn_id: "t1" });
    expect(post).toHaveBeenCalledWith(
      "/api/org%201/ai/chats/s%2F1/branch",
      { turn_id: "t1" },
      {
        headers: { "Content-Type": "application/json" },
        silentForbidden: true,
        assistantManaged: true,
      },
    );
  });
});
