// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the pipeline Query node drawer. Models the `streamRoute`
// shape that Query's save reads. Validated rules:
//   • trigger_condition.period ≥ 1  ("Period should be greater than 0").
//   • frequency / cron validity (superRefine):
//       – frequency_type === "cron": cron required + interval ≥ min seconds.
//       – frequency_type === "minutes": frequency ≥ ceil(min/60).
//   • query_condition.aggregation.group_by (superRefine): when aggregation is
//     enabled, every group_by row must be non-empty.
//
// SQL validity is NOT modelled here — the Monaco SQL editor is bare, so
// `validateSqlQuery()` stays a pre-submit guard inside Query's onSubmit.

import { z } from "zod";
import { getCronIntervalDifferenceInSeconds, isAboveMinRefreshInterval } from "@/utils/zincutils";

// Minimal translator type — Query passes vue-i18n's `t`. Falls back to the
// literal key so the schema is usable without an i18n instance (tests). Accepts
// an optional named-params object for interpolated messages (frequency/minutes).
type Translate = (_key: string, _params?: Record<string, unknown>) => string;

const aggregationShape = z
  .object({
    group_by: z.array(z.any()).optional().nullable(),
    // aggregation function + having.{column,operator,value} are form fields in
    // ScheduledPipeline; modelled loosely (passthrough) so their values survive
    // the payload build.
    function: z.any().optional().nullable(),
    having: z
      .object({
        column: z.any().optional().nullable(),
        operator: z.any().optional().nullable(),
        value: z.any().optional().nullable(),
      })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough();

/**
 * Build the Query-node schema. `min` is the org's min_auto_refresh_interval in
 * SECONDS (store.state.zoConfig.min_auto_refresh_interval); `t` is vue-i18n's
 * translator for the field-required / invalid-cron messages.
 */
export function makeQuerySchema(min: number, t: Translate = (k) => k) {
  const minSeconds = Number(min) || 1;
  const minMinutes = Math.ceil(minSeconds / 60) || 1;

  return z
    .object({
      // streamRoute shape — only the validated slices are described; the rest is
      // passed through so building the payload from the validated value keeps
      // every field (sql / promql / delay / stream_type / etc.).
      trigger_condition: z
        .object({
          period: z.coerce.number().min(1, t("pipeline.periodGreaterThanZero")),
          frequency_type: z.string().optional(),
          frequency: z.any().optional(),
          cron: z.string().optional().nullable(),
          timezone: z.any().optional(),
          // operator / threshold are form fields in ScheduledPipeline; left
          // optional (passthrough round-trips them).
          operator: z.any().optional(),
          threshold: z.any().optional(),
        })
        .passthrough(),
      query_condition: z
        .object({
          aggregation: aggregationShape.optional().nullable(),
        })
        .passthrough(),
    })
    .passthrough()
    .superRefine((val: any, ctx) => {
      const trigger = val?.trigger_condition ?? {};

      // ── frequency / cron validity ─────────────────────────────────────────
      if (trigger.frequency_type === "cron") {
        const cron = trigger.cron;
        if (!cron || !String(cron).trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["trigger_condition", "cron"],
            message: t("pipeline.cronRequired"),
          });
        } else {
          try {
            const intervalInSecs = getCronIntervalDifferenceInSeconds(cron);
            if (
              typeof intervalInSecs === "number" &&
              !isAboveMinRefreshInterval(intervalInSecs, {
                min_auto_refresh_interval: minSeconds,
              })
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["trigger_condition", "cron"],
                message: t("pipeline.frequencyGreaterThanSeconds", {
                  seconds: minSeconds - 1,
                }),
              });
            }
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["trigger_condition", "cron"],
              message: t("pipeline.invalidCronExpression"),
            });
          }
        }
      } else if (trigger.frequency_type === "minutes") {
        if (Number(trigger.frequency) < minMinutes) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["trigger_condition", "frequency"],
            message: t("pipeline.minimumFrequencyMinutes", {
              minutes: minMinutes,
            }),
          });
        }
      }

      // ── group_by rows required when aggregation enabled ───────────────────
      const aggregation = val?.query_condition?.aggregation;
      if (aggregation && Array.isArray(aggregation.group_by)) {
        aggregation.group_by.forEach((col: any, index: number) => {
          if (!col || !String(col).trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["query_condition", "aggregation", "group_by", index],
              message: t("pipeline.fieldRequired"),
            });
          }
        });
      }
    });
}

/**
 * The schema's output type. Modelled loosely (passthrough) since the payload is
 * built from the validated value which carries every streamRoute field.
 */
export type QueryForm = z.infer<ReturnType<typeof makeQuerySchema>>;
