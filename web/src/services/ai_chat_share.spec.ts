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

import { describe, it, expect, vi, beforeEach } from "vitest";
import aiChatShare from "./ai_chat_share";
import http from "./http";

vi.mock("./http", () => ({ default: vi.fn() }));

describe("ai_chat_share service", () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    api = {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(api);
  });

  it("creates a share on the chat's shares collection", async () => {
    await aiChatShare.create("org1", "sess-1", {
      mode: "snapshot",
      visibility: "org",
      redact_tools: false,
    });
    expect(api.post).toHaveBeenCalledWith("/api/org1/ai/chats/sess-1/shares", {
      mode: "snapshot",
      visibility: "org",
      redact_tools: false,
    });
  });

  it("lists one chat's shares and the caller's shares", async () => {
    await aiChatShare.listForChat("org1", "sess-1");
    await aiChatShare.listMine("org1");
    expect(api.get).toHaveBeenNthCalledWith(1, "/api/org1/ai/chats/sess-1/shares");
    expect(api.get).toHaveBeenNthCalledWith(2, "/api/org1/ai/shares");
  });

  it("lists every share in the org with all=true", async () => {
    await aiChatShare.listAll("org1");
    expect(api.get).toHaveBeenCalledWith("/api/org1/ai/shares", { params: { all: true } });
  });

  it("patches and revokes a share by id", async () => {
    await aiChatShare.update("org1", "sh1", { refresh_snapshot: true });
    await aiChatShare.revoke("org1", "sh1");
    expect(api.patch).toHaveBeenCalledWith("/api/org1/ai/shares/sh1", { refresh_snapshot: true });
    expect(api.delete).toHaveBeenCalledWith("/api/org1/ai/shares/sh1");
  });

  it("reads a shared chat, passing known_seq only when given", async () => {
    await aiChatShare.getShared("org1", "tok");
    await aiChatShare.getShared("org1", "tok", { seq: 12 });
    await aiChatShare.getShared("org1", "tok", { seq: 12, version: "v3" });
    expect(api.get).toHaveBeenNthCalledWith(1, "/api/org1/ai/shared/tok", { params: undefined });
    expect(api.get).toHaveBeenNthCalledWith(2, "/api/org1/ai/shared/tok", {
      params: { known_seq: 12 },
    });
    expect(api.get).toHaveBeenNthCalledWith(3, "/api/org1/ai/shared/tok", {
      params: { known_seq: 12, known_version: "v3" },
    });
  });

  it("forks through the org route and reads public links outside it", async () => {
    await aiChatShare.fork("org1", "tok");
    await aiChatShare.getPublic("tok");
    expect(api.post).toHaveBeenCalledWith(
      "/api/org1/ai/shared/tok/fork",
      {},
      { headers: { "Content-Type": "application/json" } },
    );
    expect(api.get).toHaveBeenCalledWith("/api/public/ai_chats/tok", { params: undefined });
  });

  it("encodes path segments", async () => {
    await aiChatShare.getPublic("a/b");
    expect(api.get).toHaveBeenCalledWith("/api/public/ai_chats/a%2Fb", { params: undefined });
  });
});
