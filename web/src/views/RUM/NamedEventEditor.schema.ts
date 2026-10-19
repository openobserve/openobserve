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
  parseNamedEventDraft,
  regexProblem,
  type NamedEvent,
  type NamedRule,
} from "@/utils/rum/productAnalyticsModel";

export type RuleKind = "view" | "action" | "error";
export type RuleOp = "eq" | "prefix" | "regex" | "param" | "ref" | "in" | "contains";
export type RuleForm = {
  t: RuleKind;
  op: RuleOp;
  name: string;
  value: string;
  targets: string[];
  onPage: string;
};
export type NamedEventForm = {
  name: string;
  rules: RuleForm[];
};
type Issue = { path: keyof RuleForm; message: string };

export const RULE_OPS: Readonly<Record<RuleKind, readonly RuleOp[]>> = {
  view: ["eq", "prefix", "regex", "param", "ref"],
  action: ["in", "prefix", "contains", "regex"],
  error: ["eq", "prefix", "contains", "regex"],
};
export const DEFAULT_OP: Readonly<Record<RuleKind, RuleOp>> = {
  view: "eq",
  action: "in",
  error: "contains",
};

export const emptyRule = (t: RuleKind = "view"): RuleForm => ({
  t,
  op: DEFAULT_OP[t],
  name: "",
  value: "",
  targets: [],
  onPage: "",
});

const withOnPage = <T extends object>(rule: T, onPage: string): T =>
  onPage ? { ...rule, onPage } : rule;

export const toRule = (r: RuleForm): NamedRule => {
  if (r.t === "error")
    return withOnPage<NamedRule>(
      { t: "error", op: r.op as "eq" | "prefix" | "contains" | "regex", value: r.value },
      r.onPage,
    );
  if (r.t === "action")
    return r.op === "in"
      ? withOnPage<NamedRule>({ t: "action", targets: [...r.targets] }, r.onPage)
      : withOnPage<NamedRule>(
          { t: "action", op: r.op as "prefix" | "contains" | "regex", value: r.value },
          r.onPage,
        );
  if (r.op === "param")
    return withOnPage<NamedRule>(
      r.value
        ? { t: "view", op: "param", name: r.name, value: r.value }
        : { t: "view", op: "param", name: r.name },
      r.onPage,
    );
  if (r.op === "ref")
    return withOnPage<NamedRule>({ t: "view", op: "ref", value: r.value }, r.onPage);
  return { t: "view", op: r.op as "eq" | "prefix" | "regex", value: r.value };
};

// The model parser owns the parameter and host grammar and the credential denylist.
const ruleParses = (r: RuleForm): boolean =>
  parseNamedEventDraft({ name: "rule", rules: [toRule(r)] }, "app") !== null;

const valueIssue = (rule: RuleForm, t: TranslateFn): Issue | null => {
  if (rule.t === "action" && rule.op === "in") {
    const bad =
      !rule.targets.length ||
      rule.targets.length > MAX_TARGETS ||
      rule.targets.some((x) => !x || x.length > MAX_KEY_LENGTH);
    return bad ? { path: "targets", message: t("rum.analytics.events.targetsRequired") } : null;
  }
  if (rule.t === "view" && rule.op === "param") {
    if (!rule.name) return { path: "name", message: t("rum.analytics.events.paramNameRequired") };
    return ruleParses(rule)
      ? null
      : { path: "name", message: t("rum.analytics.events.paramNameInvalid") };
  }
  if (rule.t === "view" && rule.op === "ref")
    return ruleParses(rule)
      ? null
      : { path: "value", message: t("rum.analytics.events.refHostInvalid") };
  if (!rule.value || rule.value.length > MAX_KEY_LENGTH) {
    const key =
      rule.t === "view" ? "valueRequired" : rule.t === "action" ? "clickRequired" : "errorRequired";
    return { path: "value", message: t(`rum.analytics.events.${key}`) };
  }
  return rule.op === "regex" && regexProblem(rule.value)
    ? { path: "value", message: t("rum.analytics.events.invalidPattern") }
    : null;
};

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
            t: z.enum(["view", "action", "error"]),
            op: z.enum(["eq", "prefix", "regex", "param", "ref", "in", "contains"]),
            name: z.string(),
            value: z.string(),
            targets: z.array(z.string()),
            onPage: z.string(),
          })
          .superRefine((rule, ctx) => {
            const issue = valueIssue(rule, t);
            if (issue) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [issue.path],
                message: issue.message,
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

const toForm = (r: NamedRule): RuleForm => {
  const onPage = ("onPage" in r && r.onPage) || "";
  if (r.t === "action")
    return {
      ...emptyRule("action"),
      op: r.op ?? "in",
      targets: [...(r.targets ?? [])],
      value: r.value ?? "",
      onPage,
    };
  if (r.t === "error") return { ...emptyRule("error"), op: r.op, value: r.value, onPage };
  return {
    ...emptyRule("view"),
    op: r.op,
    name: r.op === "param" ? r.name : "",
    value: r.value ?? "",
    onPage,
  };
};

export const namedEventDefaults = (initial?: Partial<NamedEvent> | null): NamedEventForm => ({
  name: initial?.name ?? "",
  rules: initial?.rules?.length ? initial.rules.map(toForm) : [emptyRule()],
});

export const toRules = (rules: RuleForm[]): NamedRule[] => rules.map(toRule);
