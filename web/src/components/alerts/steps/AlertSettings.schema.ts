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

// Validation rules for the AlertSettings step of AddAlert. The step is a
// DESCENDANT of the ONE AddAlert <OForm>; these fragments are composed into
// the orchestrator schema (AddAlert.schema.ts). SCOPED STRICTLY to this step's
// OWN fields:
//   - trigger_condition.silence  (cooldown, minutes)   — required, ≥ 0
//   - trigger_condition.period   (evaluation window)   — required, ≥ 1
//                                                         (SCHEDULED-only, see below)
//   - destinations               (multi-select)        — at least one required
//   - creates_incident           (switch)              — optional boolean
//
// The cross-step threshold / promql / aggregation / group_by / frequency / cron
// checks are NOT here — they belong to QueryConfig / the AddAlert orchestrator.
// Do not add them.
//
// Number inputs emit STRINGS out of OFormInput → `z.coerce.number()`. TanStack
// does NOT write the coerced value back onto the field, so the component
// re-coerces (`Number(...)`) when it emits the payload up so the parent's
// trigger_condition keeps number types.

import { z } from "zod";
import type { Translator } from "./QueryConfig.schema";

// Validation messages are i18n-driven — `alerts.validation.*` locale keys,
// resolved via the injected `t`.

// ── Composable field FRAGMENTS (factories over the injected `t`) ─────────────
// Exposed so the AddAlert orchestrator schema can compose the SAME rules into
// its (bigger) alert schema — call these instead of re-declaring the rules, so
// the step and the orchestrator can never drift.
//
// The orchestrator applies the period rule MODE-CONDITIONALLY (scheduled only)
// via `createAlertSettingsSchema(t, isRealTime)`.

/** True when the RAW input value is empty (unset). */
const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || v === "";

/** silence ≥ 0 (required).
 *
 *  ⚠️ Checked on the RAW value — NOT `z.coerce.number()`. Because
 *  `Number("") === 0`, a coerced blank would PASS `.min(0)` (0 is a legal
 *  silence!), save, and then `parseInt("")` in getAlertPayload → `NaN` →
 *  serialised to `null`. Zero-safety is exactly why this rule cannot coerce:
 *  it must tell "" apart from 0. */
export const makeSilenceSchema = (t: Translator) =>
  z
    .unknown()
    .refine(
      (v) => !isBlank(v) && !Number.isNaN(Number(v)) && Number(v) >= 0,
      t("alerts.validation.silenceNonNegative"),
    )
    // Output stays `number` so composed z.infer types are unchanged. Inert at
    // runtime — TanStack does not write a validator's parsed output back onto
    // the field.
    .transform((v) => Number(v));

/** period ≥ 1 (required). Applies in the SCHEDULED branch only (the period input
 *  only renders for scheduled alerts). Compose it conditionally in the
 *  orchestrator; standalone AlertSettings applies it via
 *  `createAlertSettingsSchema(t, isRealTime)` below. */
export const makePeriodSchema = (t: Translator) =>
  z.coerce.number().min(1, t("alerts.validation.periodPositive"));

/** destinations: at least one required. Elements are destination NAME strings
 *  (the OSelect options are `formattedDestinations` = array of names). */
export const makeDestinationsSchema = (t: Translator) =>
  z.array(z.string()).min(1, t("alerts.validation.destinationRequired"));

/** creates_incident: optional boolean. */
export const alertSettingsCreatesIncidentSchema = z.boolean().optional();

/**
 * Shape object for composition — spread into a bigger `z.object({ ... })` so the
 * alert schema reuses the EXACT same field rules. The period rule is
 * unconditional here; the orchestrator overrides it with a mode-conditional
 * (scheduled-only) refinement.
 */
export const makeAlertSettingsShape = (t: Translator) =>
  ({
    trigger_condition: z.object({
      silence: makeSilenceSchema(t),
      period: makePeriodSchema(t),
    }),
    destinations: makeDestinationsSchema(t),
    creates_incident: alertSettingsCreatesIncidentSchema,
  }) as const;

// ── Mode-conditional composite ──────────────────────────────────────────────

/**
 * The AlertSettings rule set, composed into the AddAlert orchestrator schema.
 *
 * `isRealTime` gates the period rule: the period input renders (and is validated
 * ≥ 1) only for scheduled alerts. In realtime mode period is not rendered and
 * keeps its default value, so it is a plain `z.coerce.number()` with no min.
 */
export const createAlertSettingsSchema = (
  t: Translator,
  isRealTime: boolean,
  // ENTERPRISE/CLOUD only. An alert can be delivered to a destination OR to a
  // linked workflow, so with workflows available the "destinations ≥ 1" rule
  // becomes "at least ONE of the two". Defaults to false so OSS — and every
  // existing caller/spec passing two args — keeps main's exact rule and message.
  allowWorkflows = false,
) => {
  const base = z.object({
    trigger_condition: z.object({
      silence: makeSilenceSchema(t),
      period: isRealTime ? z.coerce.number() : makePeriodSchema(t),
    }),
    // With workflows in play the per-field `min(1)` can't express the rule (it
    // is cross-field), so it moves to the refinement below.
    destinations: allowWorkflows
      ? z.array(z.string()).optional()
      : makeDestinationsSchema(t),
    workflows: z.array(z.string()).optional(),
    creates_incident: alertSettingsCreatesIncidentSchema,
  });

  if (!allowWorkflows) return base;

  return base.superRefine((val, ctx) => {
    const hasDestination = (val.destinations?.length ?? 0) > 0;
    const hasWorkflow = (val.workflows?.length ?? 0) > 0;
    if (hasDestination || hasWorkflow) return;
    // Reported on `destinations` so it renders under the combined targets
    // control (AlertSettings surfaces it via fieldError("destinations")).
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["destinations"],
      message: t("alerts.destinationOrWorkflowRequired"),
    });
  });
};

export type AlertSettingsForm = z.infer<
  ReturnType<typeof createAlertSettingsSchema>
>;
