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
import { assertionNeedsExpected } from "@/constants/synthetics";
import type { AssertionKind } from "@/types/synthetics";

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
            // `expected` is declared, not just tolerated by `.loose()`, so the
            // refinement below can read it in a typed way.
            assertion: z
              .object({ kind: z.string().optional(), expected: z.string().optional() })
              .loose()
              .optional(),
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

      // Field-level step rules. These live here rather than in
      // validateJourneySteps so there is one enforcement path, and so every
      // failure carries a field path the editor can bind an inline error to.
      for (let i = 0; i < val.journey.length; i++) {
        const step = val.journey[i];

        if (step.action === "navigate" && !/^https?:\/\/\S+$/i.test(step.value ?? "")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["journey", i, "value"],
            message: t("synthetics.validation.urlInvalid"),
          });
        }

        // A `type` step with no text types nothing and the run still passes.
        if (step.action === "type" && !(step.value ?? "").trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["journey", i, "value"],
            message: t("synthetics.validation.typeTextRequired"),
          });
        }

        if (
          step.action === "assert" &&
          step.assertion?.kind &&
          assertionNeedsExpected(step.assertion.kind as AssertionKind) &&
          !(step.assertion.expected ?? "").trim()
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["journey", i, "assertion", "expected"],
            message: t("synthetics.validation.expectedRequired"),
          });
        }
      }
    });

export type BrowserCheckSaveForm = z.infer<ReturnType<typeof makeBrowserCheckSaveSchema>>;
