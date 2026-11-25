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
import type { AlertPrefill, AlertPrefillConditionGroup } from "@/ts/interfaces/alertPrefill";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import { ALERT_NAME_UNSUPPORTED_CHARS } from "@/components/alerts/AddAlert.schema";
import type { TranslateFn } from "@/types/i18n";
import { MAX_PERIOD_MINUTES } from "../alertPrefill";
import { buildPrefillFromLibrary } from "./fromLibrary";

/** The prefill source of an alert the assistant proposed; `ai` is taken by the AI Observability pages. */
export const ASSISTANT_SOURCE = "assistant";

const blank = (value: unknown) => typeof value !== "string" || value.trim() === "";

/** The create payload the agent proposes, checked for what a create needs before the user sees it. */
export const makeAlertProposalSchema = (t: TranslateFn) =>
  z
    .looseObject({
      name: z
        .string()
        .min(1, t("alerts.nameRequired"))
        .refine((name) => !ALERT_NAME_UNSUPPORTED_CHARS.test(name), t("alerts.nameNoSpecialChars")),
      stream_type: z.enum(["logs", "metrics", "traces"]),
      stream_name: z.string().min(1, t("alerts.validation.streamNameRequired")),
      is_real_time: z.boolean().optional(),
      query_condition: z.looseObject({
        type: z.enum(["sql", "promql", "custom"]),
        sql: z.string().nullish(),
        promql: z.string().nullish(),
        conditions: z.unknown().optional(),
      }),
      trigger_condition: z.looseObject({
        period: z.number().int().min(0).max(MAX_PERIOD_MINUTES).optional(),
        frequency: z.number().min(0).optional(),
        silence: z.number().min(0, t("alerts.validation.silenceNonNegative")).optional(),
      }),
      destinations: z.array(z.string()).optional(),
    })
    .superRefine((alert, ctx) => {
      const query = alert.query_condition;
      if (
        (query.type === "sql" && blank(query.sql)) ||
        (query.type === "promql" && blank(query.promql)) ||
        (query.type === "custom" && !query.conditions)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["query_condition", query.type],
          message: t("alerts.prefill.warnings.emptyQuery"),
        });
      }
      if (!alert.is_real_time && !(Number(alert.trigger_condition.period) >= 1)) {
        ctx.addIssue({
          code: "custom",
          path: ["trigger_condition", "period"],
          message: t("alerts.validation.periodPositive"),
        });
      }
    });

export type AlertProposal = z.infer<ReturnType<typeof makeAlertProposalSchema>>;

/** The proposal as an alert prefill, read like an alert file; `meta.assistantFields` names what the assistant set. */
export const buildPrefillFromAssistant = (
  proposal: AlertProposal,
  prompt: string,
): AlertPrefill => {
  const base = buildPrefillFromLibrary({
    entry: {} as AlertLibraryEntry,
    file: proposal as unknown as AlertLibraryFile,
  });
  // Never throws (contract invariant 6): a malformed proposal comes back blocked, not as an exception.
  const query: Partial<AlertProposal["query_condition"]> = proposal?.query_condition ?? {};
  // The builder's tree travels in the payload's v2 envelope; the form wants the bare group.
  const tree =
    (query.conditions as { conditions?: unknown } | undefined)?.conditions ?? query.conditions;
  return {
    ...base,
    source: ASSISTANT_SOURCE,
    sourceLabel: prompt,
    ...(query.type === "custom"
      ? { queryType: "custom", sql: undefined, conditions: tree as AlertPrefillConditionGroup }
      : {}),
    meta: {
      description: typeof proposal?.description === "string" ? proposal.description : "",
      destinations: proposal?.destinations ?? [],
      assistantFields: Object.keys(proposal ?? {}),
    },
  };
};
