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
  type SessionField,
} from "@/utils/rum/productAnalyticsModel";
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
  field: SessionField | null;
  status: "idle" | "loading" | "ok" | "error";
  rows: FilterValueRow[];
}

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

/** The funnel with `field` kept to `values`, replacing any filter already on that field; null when invalid. */
export function setFilter(def: FunnelDef, field: SessionField, values: string[]): FunnelDef | null {
  const filter = parseFunnelFilter({ field, op: "in", values: [...new Set(values)] });
  if (!filter) return null;
  const rest = (def.f ?? []).filter((r) => r.field !== field);
  return { ...def, f: [...rest, filter] };
}

export function removeFilter(def: FunnelDef, field: SessionField): FunnelDef {
  const rest = (def.f ?? []).filter((r) => r.field !== field);
  const next: FunnelDef = { ...def, f: rest };
  if (!rest.length) delete next.f;
  return next;
}

export function filterOn(def: FunnelDef, field: SessionField): FunnelFilter | undefined {
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
