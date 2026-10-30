// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { FilterGroup } from "@/utils/query/filterBar";
import { engineCodec, type EngineGroup } from "./engineCodec";
import { anomalyFlatCodec, type AnomalyFilter } from "./listCodecs";
import { isPlainObject, isTreePristine, rawOf, type FilterCodec } from "./types";

export type AnomalyFilters = AnomalyFilter[] | EngineGroup | null;

const isFlatAnd = (tree: FilterGroup): boolean =>
  tree.items.every(
    (item, index) => item.kind !== "group" && (index === 0 || item.connector === "AND"),
  );

/** Anomaly filters: the flat row list, or a V2 group once the tree needs OR or nesting. */
export function anomalyCodec(): FilterCodec<AnomalyFilters> {
  const flat = anomalyFlatCodec();
  const grouped = engineCodec();
  return {
    parse: (saved, context) =>
      isPlainObject(saved) && saved.filterType === "group"
        ? grouped.parse(saved, context)
        : flat.parse(Array.isArray(saved) ? saved : null, context),
    serialize: (tree, context) => {
      if (isTreePristine(tree)) return rawOf<AnomalyFilters>(tree) ?? [];
      return isFlatAnd(tree)
        ? flat.serialize(tree, context)
        : (grouped.serialize(tree, context) as AnomalyFilters);
    },
  };
}
