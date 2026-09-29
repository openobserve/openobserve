// Copyright 2026 OpenObserve Inc.
import { z } from "zod";
import type { TranslateFn } from "@/types/i18n";

export function isPromptJson(value: string, objectOnly = false): boolean {
  if (!value.trim()) return !objectOnly;
  try {
    const parsed: unknown = JSON.parse(value);
    return !objectOnly || (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

export function makePromptEditorSchema(t: TranslateFn) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .regex(/^[a-z0-9_-]+$/, t("aiObservability.promptManagement.nameInvalid")),
      type: z.enum(["text", "chat"]),
      description: z.string(),
      tagsText: z.string(),
      textPayload: z.string(),
      chatContent: z.array(z.string()),
      model: z.string().nullable(),
      paramsText: z
        .string()
        .refine(
          (value) => isPromptJson(value, true),
          t("aiObservability.promptManagement.objectJsonRequired"),
        ),
      toolsText: z
        .string()
        .refine((value) => isPromptJson(value), t("aiObservability.promptManagement.jsonInvalid")),
      responseFormatText: z
        .string()
        .refine((value) => isPromptJson(value), t("aiObservability.promptManagement.jsonInvalid")),
      commitMessage: z.string().trim().min(1, t("aiObservability.promptManagement.commitRequired")),
    })
    .superRefine((value, context) => {
      const hasBody =
        value.type === "text"
          ? Boolean(value.textPayload.trim())
          : value.chatContent.some((content) => content.trim());
      if (!hasBody)
        context.addIssue({
          code: "custom",
          path: [value.type === "text" ? "textPayload" : "chatContent"],
          message: t("aiObservability.promptManagement.bodyRequired"),
        });
    });
}
export type PromptEditorForm = z.infer<ReturnType<typeof makePromptEditorSchema>>;
export const promptEditorDefaults = (): PromptEditorForm => ({
  name: "",
  type: "text",
  description: "",
  tagsText: "",
  textPayload: "",
  chatContent: [],
  model: "",
  paramsText: "{}",
  toolsText: "",
  responseFormatText: "",
  commitMessage: "",
});
