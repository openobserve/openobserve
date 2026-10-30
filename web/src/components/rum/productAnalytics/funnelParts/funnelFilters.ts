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

import {
  CREDENTIAL_PARAMS,
  MAX_FILTER_VALUES,
  MAX_VIEW_CONDS,
  parseFunnelFilter,
  parseStepRef,
  isFilterColumn,
  type MatchOp,
  type SessionField,
} from "@/utils/rum/productAnalyticsModel";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type {
  FunnelDef,
  FunnelFilter,
  StepFilters,
  StepRef,
  ViewCond,
} from "@/utils/rum/productAnalyticsQueries";

export interface FilterValueRow {
  value: string;
  sessions: number;
}

/** The value list a field picker shows; the owner runs the query and passes the rows down. */
export interface FilterValuesState {
  field: string | null;
  status: "idle" | "loading" | "ok" | "error";
  rows: FilterValueRow[];
}

export type FilterConditionId =
  | "in"
  | "notIn"
  | "contains"
  | "notContains"
  | "prefix"
  | "notPrefix"
  | "suffix"
  | "notSuffix"
  | "regex"
  | "notRegex";

/** A condition Filter all steps offers: a match op, kept or negated. */
export interface FilterCondition {
  id: FilterConditionId;
  op: MatchOp;
  not: boolean;
}

export const FILTER_CONDITIONS: readonly FilterCondition[] = [
  { id: "in", op: "in", not: false },
  { id: "notIn", op: "in", not: true },
  { id: "contains", op: "contains", not: false },
  { id: "notContains", op: "contains", not: true },
  { id: "prefix", op: "prefix", not: false },
  { id: "notPrefix", op: "prefix", not: true },
  { id: "suffix", op: "suffix", not: false },
  { id: "notSuffix", op: "suffix", not: true },
  { id: "regex", op: "regex", not: false },
  { id: "notRegex", op: "regex", not: true },
];

/** One "Only when" row as typed; `values` is the comma-separated text. */
export interface ViewCondDraft {
  t: ViewCond["t"];
  key: string;
  values: string;
}

const splitValues = (text: string): string[] => [
  ...new Set(
    text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];

// parseStepRef holds the one copy of the condition checks, so a row is valid exactly when a link would be.
const parsedConds = (vc: unknown[]): ViewCond[] | null =>
  parseStepRef(["p", "/", { vc }])?.f?.vc ?? null;

/** A built-in field's name, or an attribute column as the app named it. */
export function filterFieldLabel(t: TranslateFn, field: string): I18nText {
  return isFilterColumn(field)
    ? raw(field)
    : t(`rum.analytics.exclusions.fields.${field as SessionField}`);
}

/** A filter's condition; `eq` reads as "is one of" because one value in a list matches the same rows. */
export function conditionOf(r: Pick<FunnelFilter, "op" | "not">): FilterCondition {
  const op = r.op === "eq" ? "in" : r.op;
  return FILTER_CONDITIONS.find((c) => c.op === op && c.not === !!r.not) ?? FILTER_CONDITIONS[0];
}

/** The funnel with `rule` on its field, replacing any filter already on that field; null when invalid. */
export function setFilter(def: FunnelDef, rule: FunnelFilter): FunnelDef | null {
  const filter = parseFunnelFilter({ ...rule, values: [...new Set(rule.values)] });
  if (!filter) return null;
  const rest = (def.f ?? []).filter((r) => r.field !== rule.field);
  return { ...def, f: [...rest, filter] };
}

export function removeFilter(def: FunnelDef, field: string): FunnelDef {
  const rest = (def.f ?? []).filter((r) => r.field !== field);
  const next: FunnelDef = { ...def, f: rest };
  if (!rest.length) delete next.f;
  return next;
}

export function filterOn(def: FunnelDef, field: string): FunnelFilter | undefined {
  return def.f?.find((r) => r.field === field);
}

export function draftOf(c: ViewCond): ViewCondDraft {
  return { t: c.t, key: c.t === "param" ? c.key : "", values: c.values.join(", ") };
}

/** A typed row as the server would accept it, or null while it is incomplete or invalid. */
export function condOf(d: ViewCondDraft): ViewCond | null {
  const values = splitValues(d.t === "ref" ? d.values.toLowerCase() : d.values);
  if (!values.length || values.length > MAX_FILTER_VALUES) return null;
  const raw =
    d.t === "param"
      ? { t: "param", key: d.key.trim(), op: "eq", values }
      : { t: "ref", op: "eq", values };
  return parsedConds([raw])?.[0] ?? null;
}

/** Why a typed row cannot apply, or null while it is still incomplete or when it is valid. */
export function condProblem(d: ViewCondDraft): "credential" | "invalid" | null {
  if (!d.values.trim() || (d.t === "param" && !d.key.trim())) return null;
  if (d.t === "param" && CREDENTIAL_PARAMS.includes(d.key.trim())) return "credential";
  return condOf(d) ? null : "invalid";
}

/** The step with `conds` as its "Only when" list, keeping its other filters. */
export function withConds(step: StepRef, conds: ViewCond[]): StepRef {
  const f: StepFilters = { ...step.f, vc: conds.slice(0, MAX_VIEW_CONDS) };
  if (!conds.length) delete f.vc;
  return Object.keys(f).length
    ? { kind: step.kind, key: step.key, f }
    : { kind: step.kind, key: step.key };
}
