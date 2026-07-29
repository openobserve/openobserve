// Copyright 2026 OpenObserve Inc.
//
// Validation schema for CreateBrowserTest.vue (create/edit browser check).
// Built via a factory so error messages stay i18n-driven (pass useI18n's `t`).
//
// Field ownership:
//   • name   — required.
//   • url    — required + valid HTTP(S) URL.

import { z } from "zod";
import { stepIsMissingTarget } from "@/utils/synthetics/stepTarget";

/** The version-2 locator bundle, as it sits on an editor step. */
const locatorCandidateSchema = z.object({ kind: z.string(), value: z.string() });
const locatorSchema = z.object({
  candidates: z.array(locatorCandidateSchema).nullish(),
  user_override: locatorCandidateSchema.nullish(),
});

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
            // The string a failed run displays, so it cannot be blank. Recorded
            // steps arrive named from the recorder, which is why requiring it
            // lands on hand-added steps rather than on every recording.
            name: z.string().trim().min(1, t("synthetics.validation.stepNameRequired")),
            selector: z.string().optional(),
            selectorType: z.string().optional(),
            value: z.string().optional(),
            timeout: z.number().optional(),
            code: z.string().optional(),
            // A version-2 step names its element here and carries no `selector`.
            // Declared explicitly because z.object strips what it does not
            // declare — leaving it out made every v2 step look target-less to
            // the refinement below.
            locator: locatorSchema.optional(),
            assertion: z.object({ kind: z.string().optional() }).loose().optional(),
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

      // Every element-acting step must name its element, by either channel.
      for (let i = 0; i < val.journey.length; i++) {
        if (stepIsMissingTarget(val.journey[i])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["journey", i, "selector"],
            message: t("synthetics.validation.selectorRequired"),
          });
        }
      }
    });

export type BrowserCheckSaveForm = z.infer<ReturnType<typeof makeBrowserCheckSaveSchema>>;
