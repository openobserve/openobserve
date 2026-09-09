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

// SLO definition schema: mirrors the API's required fields client-side so a missing field names itself instead of surfacing as an unlabeled HTTP 422.

import { z } from "zod";

import type { I18nText } from "@/types/i18n";
import { isBlank } from "@/components/alerts/AddAlert.schema";

export type Translator = (_key: string, _named?: Record<string, unknown>) => I18nText;

/** What the form knows and the payload does not. */
export interface SloFormMeta {
  /** A count SLI written in PromQL: two expressions, no stream. */
  isPromqlCount: boolean;
  /** A time-slice SLI written in PromQL. Keeps the stream, unlike the above. */
  isPromqlTimeSlice: boolean;
  /** Whether any group-by field is selected. */
  isGrouped: boolean;
}

/** The server's inclusive bound: 257 characters is the first rejection. */
export const SLO_NAME_MAX = 256;

/** Targets sit strictly inside (0, 100): a 100% target has a zero error budget. */
export const TARGET_MIN_EXCLUSIVE = 0;
export const TARGET_MAX_EXCLUSIVE = 100;

/** Stored to 3 decimals; a 4th is silently truncated, changing the budget. */
export const TARGET_DECIMALS = 3;

/** D30: a grouped SLO is pinned to the 5-minute grid. */
export const GROUPED_SLICE_SECS = 300;

/** Builds the SLO form schema for one `_meta` snapshot; rebuild when the discriminators change. */
export const makeAddSloSchema = (t: Translator, meta: SloFormMeta) =>
  z
    .looseObject({
      name: z.string().optional(),
      description: z.string().optional(),
      sli_type: z.string().optional(),
      target: z.unknown().optional(),
      slice_interval_secs: z.number().optional(),
      config: z.looseObject({}).optional(),
    })
    .superRefine((val: any, ctx) => {
      const add = (path: (string | number)[], message: I18nText) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

      const config = val.config ?? {};
      const sliType = val.sli_type;

      // ── identity ──────────────────────────────────────────────────────────
      if (isBlank(val.name)) {
        add(["name"], t("slos.validation.nameRequired"));
      } else if (String(val.name).length > SLO_NAME_MAX) {
        add(["name"], t("slos.validation.nameTooLong"));
      }

      // ── objective ─────────────────────────────────────────────────────────
      // Checked on the RAW value, never coerced: `Number("") === 0`, so a
      // coerced blank would be indistinguishable from a deliberate 0 — and 0
      // has its own, different message.
      if (isBlank(val.target)) {
        add(["target"], t("slos.validation.targetRequired"));
      } else {
        const target = Number(val.target);
        if (!Number.isFinite(target)) {
          add(["target"], t("slos.validation.targetRequired"));
        } else if (target <= TARGET_MIN_EXCLUSIVE || target >= TARGET_MAX_EXCLUSIVE) {
          add(["target"], t("slos.validation.targetRange"));
        } else if (Math.round(target * 10 ** TARGET_DECIMALS) / 10 ** TARGET_DECIMALS !== target) {
          add(["target"], t("slos.validation.targetPrecision"));
        }
      }

      // ── the SLI itself ────────────────────────────────────────────────────
      // A stream is required by count-SQL and by BOTH time-slice languages; a
      // PromQL count is the one shape that carries none.
      const needsStream = (sliType === "count" && !meta.isPromqlCount) || sliType === "time_slice";
      if (needsStream) {
        if (isBlank(config.stream_type)) {
          add(["config", "stream_type"], t("slos.validation.streamTypeRequired"));
        }
        if (isBlank(config.stream)) {
          add(["config", "stream"], t("slos.validation.streamRequired"));
        }
      }

      if (sliType === "count") {
        if (meta.isPromqlCount) {
          // `CountSource::PromQl` is exactly two expressions and BOTH are needed.
          if (isBlank(config.good)) {
            add(["config", "good"], t("slos.validation.promqlGoodRequired"));
          }
          if (isBlank(config.total)) {
            add(["config", "total"], t("slos.validation.promqlTotalRequired"));
          }
        } else if (isBlank(config.good_expr)) {
          // Left blank, `wireConfig`'s `pruned()` DROPS the key rather than
          // sending "", so the server never sees the field it would explain.
          add(["config", "good_expr"], t("slos.validation.goodExprRequired"));
        }
      }

      if (sliType === "time_slice") {
        if (isBlank(config.query)) {
          add(["config", "query"], t("slos.validation.aggregateRequired"));
        }
        if (isBlank(config.comparator)) {
          add(["config", "comparator"], t("slos.validation.comparatorRequired"));
        }
        // Zero and negatives are legitimate thresholds ("errors < 1"), so this
        // must tell a blank apart from a 0 rather than testing truthiness.
        if (isBlank(config.threshold)) {
          add(["config", "threshold"], t("slos.validation.thresholdRequired"));
        } else if (!Number.isFinite(Number(config.threshold))) {
          add(["config", "threshold"], t("slos.validation.thresholdNumber"));
        }
      }

      if (sliType === "alert" && isBlank(config.alert_id)) {
        add(["config", "alert_id"], t("slos.validation.alertSourceRequired"));
      }

      // ── grouping ──────────────────────────────────────────────────────────
      // Both are the SLO's own fields, so the form can answer them without
      // asking the server.
      if (meta.isGrouped) {
        if (sliType === "alert") {
          add(["group_by"], t("slos.validation.alertCannotGroup"));
        } else if (val.slice_interval_secs !== GROUPED_SLICE_SECS) {
          add(["group_by"], t("slos.validation.groupedSlice"));
        }
      }
    });

export type AddSloForm = z.infer<ReturnType<typeof makeAddSloSchema>>;
