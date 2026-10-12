// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/services/http", () => ({ default: () => ({ post: mockPost }) }));

import prompts from "./llm-prompts.service";
import analytics from "./product_analytics";

beforeEach(() => {
  mockPost.mockReset();
  vi.mocked(analytics.track).mockClear();
});

describe("create() analytics", () => {
  it("tracks llm_prompt_created with the prompt type once the server confirms", async () => {
    mockPost.mockResolvedValue({ data: { created: true, replayed: false } });
    await prompts.create("acme", { type: "chat", folderId: "default" } as any);
    expect(analytics.track).toHaveBeenCalledWith("llm_prompt_created", { type: "chat" });
  });

  it.each([
    ["an idempotent replay", { created: true, replayed: true }],
    ["nothing created", { created: false, replayed: false }],
  ])("does not track %s", async (_label, data) => {
    mockPost.mockResolvedValue({ data });
    await prompts.create("acme", { type: "chat" } as any);
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("does not track when the create is rejected", async () => {
    mockPost.mockRejectedValue(new Error("boom"));
    await expect(prompts.create("acme", { type: "text" } as any)).rejects.toThrow("boom");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});

describe("createVersion() analytics", () => {
  it("tracks llm_prompt_version_created once the server confirms", async () => {
    mockPost.mockResolvedValue({ data: { created: true, replayed: false } });
    await prompts.createVersion("acme", "p1", { commitMessage: "m" } as any);
    expect(analytics.track).toHaveBeenCalledWith("llm_prompt_version_created");
  });

  it.each([
    ["an idempotent replay", { created: true, replayed: true }],
    ["an unchanged version", { created: false, replayed: false }],
  ])("does not track %s", async (_label, data) => {
    mockPost.mockResolvedValue({ data });
    await prompts.createVersion("acme", "p1", { commitMessage: "m" } as any);
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("does not track when the new version is rejected", async () => {
    mockPost.mockRejectedValue(new Error("conflict"));
    await expect(
      prompts.createVersion("acme", "p1", { commitMessage: "m" } as any),
    ).rejects.toThrow("conflict");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
