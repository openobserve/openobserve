// Copyright 2026 OpenObserve Inc.
import { describe, expect, it } from "vitest";
import type { TranslateFn } from "@/types/i18n";
import { makePromptSettingsSchema, promptSettingsDefaults } from "./PromptSettings.schema";
import { makeSaveAsPromptSchema, saveAsPromptDefaults } from "./SaveAsPrompt.schema";

const t = ((key: string) => key) as TranslateFn;

describe("prompt settings and save destination validation", () => {
  it("requires a usable webhook endpoint and events only when enabled", () => {
    const schema = makePromptSettingsSchema(t);
    const defaults = promptSettingsDefaults();
    expect(schema.safeParse(defaults).success).toBe(true);
    const invalid = schema.safeParse({ ...defaults, webhookEnabled: true });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues.map((issue) => issue.path[0])).toEqual(["endpoint", "events"]);
    const enabled = {
      ...defaults,
      webhookEnabled: true,
      endpoint: "https://example.com/hook",
      events: ["label_moved"],
    };
    expect(schema.safeParse(enabled).success).toBe(true);
    expect(schema.safeParse({ ...enabled, endpoint: "file:///tmp/hook" }).success).toBe(false);
    expect(schema.safeParse({ ...defaults, protectedLabels: ["latest"] }).success).toBe(false);
  });

  it("validates only the active save destination and always requires a commit message", () => {
    const schema = makeSaveAsPromptSchema(t);
    expect(schema.safeParse(saveAsPromptDefaults()).success).toBe(false);
    const create = { ...saveAsPromptDefaults(), name: "summary", commitMessage: "Initial version" };
    expect(schema.safeParse(create).success).toBe(true);
    expect(schema.safeParse({ ...create, mode: "append" }).success).toBe(false);
    expect(
      schema.safeParse({ ...create, mode: "append", name: "", targetId: "prompt-1" }).success,
    ).toBe(true);
  });
});
