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

import { MISC_GROUP_ID } from "./prefixGrouping";

export interface RelatedMetric {
  name: string;
  /** Label names both metrics carry, alphabetical. */
  sharedLabels: string[];
}

/** The rest of the metric's prefix group; a "misc" metric has no group, so every metric qualifies. */
export function relatedCandidates(
  selected: string,
  names: string[],
  prefixOf: (name: string) => string,
): string[] {
  const group = prefixOf(selected);
  return names.filter(
    (name) => name !== selected && (group === MISC_GROUP_ID || prefixOf(name) === group),
  );
}

const segmentsOf = (name: string) => new Set(name.split("_").filter(Boolean));

/** By shared name segments, then label Jaccard, then name; the metric's own family is left out. */
export function rankRelatedMetrics(
  selected: string,
  candidates: string[],
  labelsByStream: Record<string, string[]>,
  familyOf: (name: string) => string,
): RelatedMetric[] {
  const family = familyOf(selected);
  const segments = segmentsOf(selected);
  const labels = new Set(labelsByStream[selected] ?? []);

  return candidates
    .filter((name) => name !== selected && familyOf(name) !== family)
    .map((name) => {
      const theirs = labelsByStream[name] ?? [];
      const sharedLabels = [...new Set(theirs.filter((l) => labels.has(l)))].sort();
      const union = new Set([...labels, ...theirs]).size;
      return {
        name,
        sharedLabels,
        segments: [...segmentsOf(name)].filter((s) => segments.has(s)).length,
        jaccard: union ? sharedLabels.length / union : 0,
      };
    })
    .sort(
      (a, b) => b.segments - a.segments || b.jaccard - a.jaccard || a.name.localeCompare(b.name),
    )
    .map(({ name, sharedLabels }) => ({ name, sharedLabels }));
}
