// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { z } from "zod";
import { stepIsMissingTarget } from "@/utils/synthetics/stepTarget";
import { isStorableAction } from "@/utils/synthetics/buildV2Steps";
import { assertionNeedsExpected, START_LOAD_STEP_ID } from "@/constants/synthetics";
import { isHttpUrlTemplate } from "@/components/synthetics/variables/placeholders";
import type { AssertionKind } from "@/types/synthetics";

/**
 * Message factory. Params are passed through to vue-i18n so a failure can name
 * the step it is about — "Selector is required" on a twenty-step journey is a
 * scavenger hunt.
 */
type Translate = (_key: string, _params?: Record<string, unknown>) => string;

/** The locator bundle, as it sits on an editor step. */
const compositePartSchema = z.object({ value: z.string(), relation: z.string().optional() });
const locatorCandidateSchema = z.object({
  kind: z.string(),
  value: z.string(),
  origin: z.string().optional(),
  from: z.array(compositePartSchema).optional(),
});
// Declared, not tolerated: z.object strips what it does not declare, so an
// undeclared `origin` would be dropped here and the payload built from the
// parsed value would carry none.
const locatorSchema = z.object({
  candidates: z.array(locatorCandidateSchema).nullish(),
  author_ordered: z.boolean().optional(),
});

const isPlainHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/** The Navigate-step rule: a plain http(s) URL, or a template the server's `check_http_url` accepts. */
const httpUrlOrTemplate = (t: Translate) =>
  z
    .string()
    .min(1, t("synthetics.validation.urlRequired"))
    .refine((v) => isPlainHttpUrl(v) || (v.includes("{{") && isHttpUrlTemplate(v)), {
      message: t("synthetics.validation.urlInvalid"),
    });

export const makeBrowserCheckGateSchema = (t: Translate) =>
  z.object({
    name: z.string().min(1, t("synthetics.validation.nameRequired")).trim(),
    url: httpUrlOrTemplate(t),
  });

export type BrowserCheckGateForm = z.infer<ReturnType<typeof makeBrowserCheckGateSchema>>;

export const browserCheckGateDefaults = (): BrowserCheckGateForm => ({
  name: "",
  url: "",
});

export const makeBrowserCheckSaveSchema = (t: Translate) =>
  z
    .object({
      name: z.string().min(1, t("synthetics.validation.nameRequired")).trim(),
      url: httpUrlOrTemplate(t),
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
            value: z.string().optional(),
            timeout: z.number().optional(),
            subtest: z.object({ id: z.string(), name: z.string().optional() }).optional(),
            optional: z.boolean().optional(),
            alwaysRun: z.boolean().optional(),
            // A step names its element here, and nowhere else. Declared
            // explicitly because z.object strips what it does not declare —
            // leaving it out made every step look target-less to the
            // refinement below.
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
      // The two rules that decide whether a journey can be stored at all.
      // They used to be answered by isV2Journey, whose only consequence was a
      // quiet fall back to the version-1 payload shape — which discarded every
      // locator bundle the recorder had captured. Version 1 is gone, so the
      // answer has to reach the author, on the step it is about.
      for (let i = 0; i < val.journey.length; i++) {
        const step = val.journey[i];

        if (step.id === START_LOAD_STEP_ID) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["journey", i, "id"],
            message: t("synthetics.validation.stepIdReserved"),
          });
        }

        if (step.action === "subtest") {
          if (!step.subtest?.id) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["journey", i, "subtest"],
              message: t("synthetics.validation.subtestRequired"),
            });
          }
          if (step.optional) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["journey", i, "optional"],
              message: t("synthetics.validation.subtestFlags"),
            });
          }
          if (step.alwaysRun) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["journey", i, "alwaysRun"],
              message: t("synthetics.validation.subtestFlags"),
            });
          }
          continue;
        }

        if (!isStorableAction(step.action)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["journey", i, "action"],
            message: t("synthetics.validation.retiredAction", {
              step: step.name,
              action: step.action,
            }),
          });
        }

        if (stepIsMissingTarget(step)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["journey", i, "selector"],
            // Field-scoped: this issue reaches the author only through
            // `setStepFieldErrors`, which renders it on the locator input of the
            // step it names. The accompanying toast is `fixHighlightedFields`, so
            // repeating the step name here says it twice inside its own row.
            message: t("synthetics.validation.locatorRequired"),
          });
        }
      }

      // Field-level step rules. These live here rather than in
      // validateJourneySteps so there is one enforcement path, and so every
      // failure carries a field path the editor can bind an inline error to.
      for (let i = 0; i < val.journey.length; i++) {
        const step = val.journey[i];

        if (
          step.action === "navigate" &&
          !/^https?:\/\/\S+$/i.test(step.value ?? "") &&
          !((step.value ?? "").includes("{{") && isHttpUrlTemplate(step.value ?? ""))
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["journey", i, "value"],
            message: t("synthetics.validation.navigateUrlInvalid"),
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
