// Copyright 2026 OpenObserve Inc.
import { describe, expect, it } from "vitest";
import type { TranslateFn } from "@/types/i18n";
import { makePromptEditorSchema, promptEditorDefaults } from "./PromptEditor.schema";
import { makePromptLabelSchema } from "./PromptLabel.schema";

const t = ((key: string) => key) as TranslateFn;

describe("prompt form validation", () => {
  it("reports every missing required field when a blank prompt is submitted", () => {
    const result = makePromptEditorSchema(t).safeParse(promptEditorDefaults());
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(["name", "textPayload", "commitMessage"]),
      );
  });

  it("validates the active prompt type and every JSON field", () => {
    const draft = {
      ...promptEditorDefaults(),
      name: "incident-summary",
      type: "chat" as const,
      chatContent: ["Hello"],
      commitMessage: "Initial version",
    };
    const schema = makePromptEditorSchema(t);
    expect(schema.safeParse(draft).success).toBe(true);
    expect(schema.safeParse({ ...draft, chatContent: [" "] }).success).toBe(false);
    expect(schema.safeParse({ ...draft, paramsText: "[]" }).success).toBe(false);
    expect(schema.safeParse({ ...draft, toolsText: "{" }).success).toBe(false);
    expect(schema.safeParse({ ...draft, responseFormatText: "{" }).success).toBe(false);
    expect(schema.safeParse({ ...draft, toolsText: "null" }).success).toBe(true);
  });

  it("rejects reserved, duplicate, unsafe, and overlong labels", () => {
    const schema = makePromptLabelSchema(t, ["production"]);
    for (const name of [
      "",
      "latest",
      "production",
      " production ",
      "bad/label",
      "bad\nlabel",
      "é".repeat(65),
    ])
      expect(schema.safeParse({ name, version: 2 }).success).toBe(false);
    expect(schema.parse({ name: " staging ", version: 2 })).toEqual({
      name: "staging",
      version: 2,
    });
    expect(schema.safeParse({ name: "é".repeat(64), version: 2 }).success).toBe(true);
  });
});
