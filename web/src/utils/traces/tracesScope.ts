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

export type TracesScope = "all" | "root" | "entrypoint";

export const TRACES_SCOPES: readonly TracesScope[] = ["all", "root", "entrypoint"];

export const ROOT_SPAN_PREDICATE =
  "(reference_parent_span_id IS NULL OR reference_parent_span_id = '')";

export interface TracesScopeState {
  meta: { searchMode?: string; sqlMode?: boolean; scope?: unknown };
  data: { stream: { hasParentColumn?: boolean } };
}

export function isTracesScope(value: unknown): value is TracesScope {
  return TRACES_SCOPES.includes(value as TracesScope);
}

/** Server and consumer spans, plus any root span when the stream records parents. */
export function entrypointPredicate(hasParentColumn: boolean): string {
  const kinds = "CAST(span_kind AS VARCHAR) IN ('2','5')";
  if (!hasParentColumn) return `(${kinds})`;
  // Any root counts, whatever its kind: a trace that starts at a client span still entered the system there.
  return `(${kinds} OR ${ROOT_SPAN_PREDICATE})`;
}

/** The condition a scope adds; empty for All spans, and for Root spans on a stream without parent ids. */
export function scopePredicate(scope: TracesScope, hasParentColumn: boolean): string {
  if (scope === "entrypoint") return entrypointPredicate(hasParentColumn);
  if (scope === "root" && hasParentColumn) return ROOT_SPAN_PREDICATE;
  return "";
}

/** The filter narrowed to the scope, bracketed so an OR in the filter cannot bind past it. */
export function withScope(filter: string, predicate: string): string {
  if (!predicate) return filter;
  const trimmed = filter.trim();
  return trimmed ? `(${trimmed}) AND ${predicate}` : predicate;
}

/** The scope condition the current search applies: the Spans view with SQL mode off only. */
export function activeScopePredicate(state: TracesScopeState): string {
  const { searchMode, sqlMode, scope } = state.meta;
  if (searchMode !== "spans" || sqlMode || !isTracesScope(scope)) return "";
  return scopePredicate(scope, !!state.data.stream.hasParentColumn);
}
