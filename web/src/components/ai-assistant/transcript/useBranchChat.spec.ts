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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import http from "@/services/http";

import { useBranchChat, type BranchChat } from "./useBranchChat";

const { openSession, toast, track } = vi.hoisted(() => ({
  openSession: vi.fn(),
  toast: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: (...args: unknown[]) => track(...args),
}));

vi.mock("@/services/http", () => ({ default: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => ({ openSession }),
}));

const created = {
  session_id: "new-1",
  title: "Branch of Checkout failures",
  branched_from: { session_id: "s1", turn_id: "t2", title: "Checkout failures" },
};

function withBranch(): BranchChat {
  let api: BranchChat | null = null;
  mount(
    defineComponent({
      setup() {
        api = useBranchChat(() => "default");
        return () => null;
      },
    }),
  );
  return api!;
}

describe("useBranchChat", () => {
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    post = vi.fn().mockResolvedValue({ data: created });
    (http as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ post });
    openSession.mockReset().mockResolvedValue("new-1");
    toast.mockReset();
    track.mockReset();
  });

  it("posts the turn and version as JSON, then opens the new chat", async () => {
    const branch = withBranch();
    const result = await branch.branch({ sid: "s 1", turnId: "t2", version: 1 });
    expect(post).toHaveBeenCalledWith(
      "/api/default/ai/chats/s%201/branch",
      { turn_id: "t2", version: 1 },
      { headers: { "Content-Type": "application/json" } },
    );
    expect(openSession).toHaveBeenCalledWith({ sid: "new-1" }, { focus: true });
    expect(result).toEqual(created);
    expect(branch.pending.value).toBe(false);
    expect(track).toHaveBeenCalledWith("ai_branch", { result: "created" });
  });

  it("sends no version when none is given", async () => {
    await withBranch().branch({ sid: "s1", turnId: "t2" });
    expect(post.mock.calls[0][1]).toEqual({ turn_id: "t2" });
  });

  it("toasts and opens nothing when the server refuses (409 turn not finished)", async () => {
    post.mockRejectedValue({ response: { status: 409 } });
    const result = await withBranch().branch({ sid: "s1", turnId: "t2" });
    await flushPromises();
    expect(result).toBeNull();
    expect(openSession).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ variant: "error", message: "Couldn't branch this chat" });
    expect(track).toHaveBeenCalledWith("ai_branch", { result: "failed", status: 409 });
  });

  it("keeps a branch that failed to open as created, and says the open failed", async () => {
    openSession.mockRejectedValue(new Error("gone"));
    const result = await withBranch().branch({ sid: "s1", turnId: "t2" });
    expect(result).toEqual(created);
    expect(track).toHaveBeenCalledWith("ai_branch", { result: "created" });
    expect(track).not.toHaveBeenCalledWith(
      "ai_branch",
      expect.objectContaining({ result: "failed" }),
    );
    expect(toast).toHaveBeenCalledWith({ variant: "error", message: "Couldn't open this chat" });
  });

  it("ignores a second click while the first is in flight", async () => {
    let resolve!: (value: unknown) => void;
    post.mockReturnValue(new Promise((r) => (resolve = r)));
    const branch = withBranch();
    const first = branch.branch({ sid: "s1", turnId: "t2" });
    expect(await branch.branch({ sid: "s1", turnId: "t2" })).toBeNull();
    resolve({ data: created });
    await first;
    expect(post).toHaveBeenCalledTimes(1);
  });
});
