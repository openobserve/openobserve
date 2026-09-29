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

/** Chart types that draw time on the horizontal axis without stacking. */
export const EXEMPLAR_CHART_TYPES = ["line", "area", "bar", "scatter"] as const;

export interface ExemplarPanelLike {
  type?: string;
  queryType?: string;
  queries?: { config?: { query_type?: string } }[];
}

const isRangeQuery = (query: { config?: { query_type?: string } } | undefined): boolean =>
  query?.config?.query_type !== "instant";

export function isExemplarEligible(panel: ExemplarPanelLike | null | undefined): boolean {
  if (!panel || panel.queryType !== "promql") return false;
  if (!(EXEMPLAR_CHART_TYPES as readonly string[]).includes(panel.type ?? "")) return false;
  return (panel.queries ?? []).some(isRangeQuery);
}

/** Indexes of the range queries that fetch exemplars; instant and editor-hidden ones are skipped. */
export function exemplarQueryIndexes(
  panel: ExemplarPanelLike | null | undefined,
  hiddenQueries: number[] = [],
): number[] {
  if (!isExemplarEligible(panel)) return [];
  const indexes: number[] = [];
  (panel?.queries ?? []).forEach((query, index) => {
    if (isRangeQuery(query) && !hiddenQueries.includes(index)) indexes.push(index);
  });
  return indexes;
}
