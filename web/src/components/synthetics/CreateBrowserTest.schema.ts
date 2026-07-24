// Copyright 2026 OpenObserve Inc.
//
// Validation schema for CreateBrowserTest.vue (create/edit browser check).
// Built via a factory so error messages stay i18n-driven (pass useI18n's `t`).
//
// Field ownership:
//   • name   — required.
//   • url    — required + valid HTTP(S) URL.

import { z } from "zod";

export const makeBrowserCheckGateSchema = (t: (_key: string) => string) =>
  z.object({
    name: z.string().min(1, t("synthetics.validation.nameRequired")).trim(),
    url: z
      .string()
      .min(1, t("synthetics.validation.urlRequired"))
      .refine(
        (v) => {
          try {
            const u = new URL(v);
            return u.protocol === "http:" || u.protocol === "https:";
          } catch {
            return false;
          }
        },
        { message: t("synthetics.validation.urlInvalid") },
      ),
  });

export type BrowserCheckGateForm = z.infer<ReturnType<typeof makeBrowserCheckGateSchema>>;

export const browserCheckGateDefaults = (): BrowserCheckGateForm => ({
  name: "",
  url: "",
});

export const makeBrowserCheckSaveSchema = (t: (_key: string) => string) =>
  z
    .object({
      name: z.string().min(1, t("synthetics.validation.nameRequired")).trim(),
      url: z
        .string()
        .min(1, t("synthetics.validation.urlRequired"))
        .refine(
          (v) => {
            try {
              const u = new URL(v);
              return u.protocol === "http:" || u.protocol === "https:";
            } catch {
              return false;
            }
          },
          { message: t("synthetics.validation.urlInvalid") },
        ),
      locations: z.array(z.string()).min(1, t("synthetics.validation.locationsRequired")),
      journey: z
        .array(
          z.object({
            id: z.string(),
            action: z.string(),
            name: z.string().optional(),
            selector: z.string().optional(),
            selectorType: z.string().optional(),
            value: z.string().optional(),
            timeout: z.number().optional(),
            code: z.string().optional(),
          }),
        )
        .optional()
        .default([]),
    })
    .superRefine((val, ctx) => {
      // First step must be "navigate"
      const first = val.journey[0];
      if (first && first.action !== "navigate") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["journey", 0, "action"],
          message: t("synthetics.validation.firstStepMustNavigate"),
        });
      }

      // Validate selectors on steps that require them
      const SELECTOR_ACTIONS = ["click", "type", "select", "hover", "assert"] as const;
      for (let i = 0; i < val.journey.length; i++) {
        const step = val.journey[i];
        if (
          SELECTOR_ACTIONS.includes(step.action as any) &&
          (!step.selector || step.selector.trim() === "")
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["journey", i, "selector"],
            message: t("synthetics.validation.selectorRequired"),
          });
        }
      }
    });

export type BrowserCheckSaveForm = z.infer<ReturnType<typeof makeBrowserCheckSaveSchema>>;
