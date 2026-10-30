// Copyright 2026 OpenObserve Inc.
import { z } from "zod";
import type { TranslateFn } from "@/types/i18n";

export function makeSaveAsPromptSchema(t: TranslateFn) {
  return z
    .object({
      mode: z.enum(["create", "append"]),
      name: z.string().trim(),
      targetId: z.string(),
      commitMessage: z.string().trim().min(1, t("aiObservability.promptManagement.commitRequired")),
    })
    .superRefine((value, context) => {
      if (value.mode === "create" && !/^[a-z0-9_-]+$/.test(value.name)) {
        context.addIssue({
          code: "custom",
          path: ["name"],
          message: t("aiObservability.promptManagement.nameInvalid"),
        });
      }
      if (value.mode === "append" && !value.targetId) {
        context.addIssue({
          code: "custom",
          path: ["targetId"],
          message: t("aiObservability.promptManagement.selectActivePrompt"),
        });
      }
    });
}

export type SaveAsPromptForm = z.infer<ReturnType<typeof makeSaveAsPromptSchema>>;
export const saveAsPromptDefaults = (): SaveAsPromptForm => ({
  mode: "create",
  name: "",
  targetId: "",
  commitMessage: "",
});
