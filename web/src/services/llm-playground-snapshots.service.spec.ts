// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock("@/services/http", () => ({ default: () => ({ post: mockPost }) }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

import analytics from "@/services/product_analytics";
import llmPlaygroundSnapshotsService from "./llm-playground-snapshots.service";

beforeEach(() => {
  mockPost.mockReset();
  vi.mocked(analytics.track).mockClear();
});

describe("llmPlaygroundSnapshotsService.share", () => {
  it("tracks a fresh share as not forked", async () => {
    mockPost.mockResolvedValue({ data: { id: "snap-1" } });

    await llmPlaygroundSnapshotsService.share("acme", { variants: [] });

    expect(analytics.track).toHaveBeenCalledWith("llm_playground_snapshot_shared", {
      forked: false,
    });
  });

  it("tracks a share from an existing snapshot as forked", async () => {
    mockPost.mockResolvedValue({ data: { id: "snap-2" } });

    await llmPlaygroundSnapshotsService.share("acme", { variants: [] }, "snap-1");

    expect(analytics.track).toHaveBeenCalledWith("llm_playground_snapshot_shared", {
      forked: true,
    });
  });

  it("does not track a failed share", async () => {
    mockPost.mockRejectedValue(new Error("boom"));

    await expect(llmPlaygroundSnapshotsService.share("acme", {})).rejects.toThrow("boom");

    expect(analytics.track).not.toHaveBeenCalled();
  });
});
