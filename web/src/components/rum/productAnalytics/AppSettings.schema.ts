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
import type { TranslateFn } from "@/types/i18n";
import {
  MAX_KEY_LENGTH,
  regexProblem,
  type AppExclusions,
  type MatchOp,
  type PageRule,
  type SessionField,
  type SessionRule,
} from "@/utils/rum/productAnalyticsModel";

export const MAX_SESSION_RULES = 20;
export const MAX_PAGE_RULES = 20;
export const MAX_RULE_VALUES = 20;

export const SESSION_FIELDS: readonly SessionField[] = [
  "user_agent_user_agent_family",
  "user_agent_os_family",
  "user_agent_device_family",
  "geo_info_country",
  "geo_info_city",
  "usr_id",
  "usr_email",
  "usr_anonymous_id",
  "env",
  "version",
];
export const MATCH_OPS: readonly MatchOp[] = ["eq", "in", "prefix", "suffix", "contains", "regex"];
export const PAGE_OPS: readonly PageRule["op"][] = ["eq", "prefix", "regex"];

export type AppSettingsForm = {
  bots: boolean;
  sessions: SessionRule[];
  pages: PageRule[];
};

const valueOk = (op: string, v: string) =>
  v.length > 0 && v.length <= MAX_KEY_LENGTH && (op !== "regex" || !regexProblem(v));

export const makeAppSettingsSchema = (t: TranslateFn) =>
  z.object({
    bots: z.boolean(),
    sessions: z
      .array(
        z
          .object({
            field: z.enum(SESSION_FIELDS as [SessionField, ...SessionField[]]),
            op: z.enum(MATCH_OPS as [MatchOp, ...MatchOp[]]),
            values: z.array(z.string()),
          })
          .superRefine((rule, ctx) => {
            if (
              !rule.values.length ||
              rule.values.length > MAX_RULE_VALUES ||
              rule.values.some((v) => !valueOk(rule.op, v))
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["values"],
                message: t("rum.analytics.exclusions.valuesInvalid", { max: MAX_RULE_VALUES }),
              });
            }
          }),
      )
      .max(MAX_SESSION_RULES),
    pages: z
      .array(
        z
          .object({ op: z.enum(["eq", "prefix", "regex"]), value: z.string() })
          .superRefine((rule, ctx) => {
            if (!valueOk(rule.op, rule.value)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["value"],
                message: t("rum.analytics.exclusions.valueInvalid"),
              });
            }
          }),
      )
      .max(MAX_PAGE_RULES),
  });

export const appSettingsDefaults = (ex: AppExclusions): AppSettingsForm => ({
  bots: ex.bots,
  sessions: ex.sessions.map((r) => ({ field: r.field, op: r.op, values: [...r.values] })),
  pages: ex.pages.map((p) => ({ op: p.op, value: p.value })),
});
