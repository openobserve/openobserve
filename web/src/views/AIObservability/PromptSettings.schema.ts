// Copyright 2026 OpenObserve Inc.
import { z } from "zod";
import type { TranslateFn } from "@/types/i18n";
import type { PromptSettings } from "@/services/llm-prompts.service";
import { isPromptLabelName } from "./PromptLabel.schema";

export const makePromptSettingsSchema = (t: TranslateFn) =>
  z
    .object({
      protectedLabels: z
        .array(z.string())
        .refine(
          (names) => names.every((name) => name !== "latest" && isPromptLabelName(name)),
          t("aiObservability.promptManagement.protectedLabelsInvalid"),
        ),
      webhookEnabled: z.boolean(),
      endpoint: z.string(),
      events: z.array(z.enum(["version_created", "label_moved", "label_deleted", "archived"])),
      secret: z.string(),
    })
    .superRefine((value, context) => {
      if (!value.webhookEnabled) return;
      let validUrl = false;
      try {
        validUrl = ["http:", "https:"].includes(new URL(value.endpoint.trim()).protocol);
      } catch {
        validUrl = false;
      }
      if (!validUrl)
        context.addIssue({
          code: "custom",
          path: ["endpoint"],
          message: t("aiObservability.promptManagement.webhookUrlInvalid"),
        });
      if (!value.events.length)
        context.addIssue({
          code: "custom",
          path: ["events"],
          message: t("aiObservability.promptManagement.webhookEventsRequired"),
        });
    });

export type PromptSettingsForm = z.infer<ReturnType<typeof makePromptSettingsSchema>>;
export const promptSettingsDefaults = (settings?: PromptSettings): PromptSettingsForm => ({
  protectedLabels: settings?.protectedLabels ?? [],
  webhookEnabled: Boolean(settings?.webhook),
  endpoint: settings?.webhook?.endpoint ?? "",
  events: settings?.webhook?.events ?? [],
  secret: "",
});
