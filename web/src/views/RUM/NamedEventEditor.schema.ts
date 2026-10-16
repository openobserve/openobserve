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
  MAX_NAME_LENGTH,
  MAX_RULES,
  MAX_TARGETS,
  nameFits,
  regexProblem,
  type NamedActionRule,
  type NamedEvent,
  type NamedEventRule,
} from "@/utils/rum/productAnalyticsModel";

export type RuleForm = {
  t: "view" | "action";
  op: "eq" | "prefix" | "regex";
  value: string;
  targets: string[];
  onPage: string;
};
export type NamedEventForm = {
  name: string;
  rules: RuleForm[];
};

export const emptyRule = (t: RuleForm["t"] = "view"): RuleForm => ({
  t,
  op: "eq",
  value: "",
  targets: [],
  onPage: "",
});

export const makeNamedEventSchema = (
  t: TranslateFn,
  taken: (name: string) => boolean = () => false,
) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("rum.analytics.events.nameRequired"))
      .max(MAX_NAME_LENGTH, t("rum.analytics.events.nameTooLong"))
      .refine(nameFits, t("rum.analytics.events.nameKeyTooLong"))
      .refine((name) => !taken(name), t("rum.analytics.events.duplicateName")),
    rules: z
      .array(
        z
          .object({
            t: z.enum(["view", "action"]),
            op: z.enum(["eq", "prefix", "regex"]),
            value: z.string(),
            targets: z.array(z.string()),
            onPage: z.string(),
          })
          .superRefine((rule, ctx) => {
            if (rule.t === "view") {
              if (!rule.value || rule.value.length > MAX_KEY_LENGTH) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: ["value"],
                  message: t("rum.analytics.events.valueRequired"),
                });
              } else if (rule.op === "regex" && regexProblem(rule.value)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: ["value"],
                  message: t("rum.analytics.events.invalidPattern"),
                });
              }
              return;
            }
            if (
              !rule.targets.length ||
              rule.targets.length > MAX_TARGETS ||
              rule.targets.some((x) => !x || x.length > MAX_KEY_LENGTH)
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["targets"],
                message: t("rum.analytics.events.targetsRequired"),
              });
            }
            if (rule.onPage.length > MAX_KEY_LENGTH) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["onPage"],
                message: t("rum.analytics.events.onPageTooLong"),
              });
            }
          }),
      )
      .min(1)
      .max(MAX_RULES),
  });

export const namedEventDefaults = (initial?: Partial<NamedEvent> | null): NamedEventForm => ({
  name: initial?.name ?? "",
  rules: initial?.rules?.length
    ? initial.rules.map((r) =>
        r.t === "view"
          ? { ...emptyRule("view"), op: r.op, value: r.value }
          : { ...emptyRule("action"), targets: [...r.targets], onPage: r.onPage ?? "" },
      )
    : [emptyRule()],
});

export const toRules = (rules: RuleForm[]): (NamedEventRule | NamedActionRule)[] =>
  rules.map((r) =>
    r.t === "view"
      ? { t: "view", op: r.op, value: r.value }
      : r.onPage
        ? { t: "action", targets: [...r.targets], onPage: r.onPage }
        : { t: "action", targets: [...r.targets] },
  );
