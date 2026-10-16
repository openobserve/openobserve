// Copyright 2026 OpenObserve Inc.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/composables/query/queryClient";
import prompts from "./llm-prompts.service";
import {
  llmPromptsQuery,
  promptSettingsQuery,
  movePromptLabelMutation,
  createPromptVersionMutation,
} from "./llm-prompts.service.queries";
import { llmPromptKeys } from "./llm-prompts.service.querykeys";

vi.mock("./llm-prompts.service", () => ({
  default: {
    list: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({ protectedLabels: ["production"], webhook: null }),
    moveLabel: vi.fn().mockResolvedValue({ name: "staging", version: 2 }),
    createVersion: vi.fn().mockResolvedValue({}),
  },
}));

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("prompt query lifecycle", () => {
  it("reuses a fresh list on revisit and forces one request on refresh", async () => {
    await queryClient.fetchQuery(llmPromptsQuery("org-a"));
    await queryClient.fetchQuery(llmPromptsQuery("org-a"));
    expect(prompts.list).toHaveBeenCalledTimes(1);
    await queryClient.refetchQueries({ queryKey: llmPromptKeys.list("org-a") });
    expect(prompts.list).toHaveBeenCalledTimes(2);
    await queryClient.fetchQuery(llmPromptsQuery("org-b"));
    expect(prompts.list).toHaveBeenLastCalledWith("org-b", { includeArchived: true });
  });

  it("invalidates this organization's list and settings after moving a label", async () => {
    await queryClient.fetchQuery(llmPromptsQuery("org-a"));
    await queryClient.fetchQuery(promptSettingsQuery("org-a"));
    await queryClient.fetchQuery(llmPromptsQuery("org-b"));
    const mutation = queryClient
      .getMutationCache()
      .build(queryClient, movePromptLabelMutation("org-a"));
    await mutation.execute({ entityId: "prompt", name: "staging", version: 2, ifVersion: 1 });
    expect(prompts.moveLabel).toHaveBeenCalledWith("org-a", "prompt", "staging", 2, 1);
    expect(queryClient.getQueryState(llmPromptKeys.list("org-a"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(llmPromptKeys.settings("org-a"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(llmPromptKeys.list("org-b"))?.isInvalidated).toBe(false);
    await queryClient.fetchQuery(llmPromptsQuery("org-a"));
    expect(prompts.list).toHaveBeenCalledTimes(3);
  });

  it("preserves the head guard and idempotency key when appending a version", async () => {
    queryClient.setQueryData(llmPromptKeys.list("org-a"), []);
    const mutation = queryClient
      .getMutationCache()
      .build(queryClient, createPromptVersionMutation("org-a"));
    const input = { payload: "Updated", commitMessage: "Update", baseVersion: 2, baseHash: "hash" };
    await mutation.execute({ entityId: "prompt", input, ifHead: 2, idempotencyKey: "request-1" });
    expect(prompts.createVersion).toHaveBeenCalledWith("org-a", "prompt", input, {
      ifHead: 2,
      idempotencyKey: "request-1",
    });
    expect(queryClient.getQueryState(llmPromptKeys.list("org-a"))?.isInvalidated).toBe(true);
  });
});
