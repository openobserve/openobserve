// Copyright 2026 OpenObserve Inc.
import { z } from "zod";
import type { TranslateFn } from "@/types/i18n";

export function isPromptLabelName(name: string): boolean {
  return (
    Boolean(name.trim()) &&
    new TextEncoder().encode(name).length <= 128 &&
    !name.includes("/") &&
    ![...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  );
}

export function makePromptLabelSchema(t: TranslateFn, existingNames: string[]) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t("aiObservability.promptManagement.labelRequired"))
      .refine(isPromptLabelName, t("aiObservability.promptManagement.labelInvalid"))
      .refine((name) => name !== "latest", t("aiObservability.promptManagement.latestLabelHelp"))
      .refine(
        (name) => !existingNames.includes(name),
        t("aiObservability.promptManagement.labelExists"),
      ),
    version: z.number().int().positive(),
  });
}

export type PromptLabelForm = z.infer<ReturnType<typeof makePromptLabelSchema>>;
export const promptLabelDefaults = (version: number): PromptLabelForm => ({ name: "", version });
