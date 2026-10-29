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

import { filterTreeToSql } from "@/utils/query/filterBar";
import { parseSqlFilter } from "@/utils/query/filterBarParser";
import {
  isTreePristine,
  makeGroup,
  makeRawNode,
  rawOf,
  stampTree,
  type FilterCodec,
} from "./types";

/** A WHERE expression as text; a query the parser cannot draw is kept whole as one locked chip. */
export function sqlCodec(): FilterCodec<string> {
  return {
    parse: (saved) => {
      const text = (saved ?? "").trim();
      const tree = parseSqlFilter(text);
      if (tree) return stampTree(tree, saved ?? "");
      return stampTree(makeGroup([makeRawNode(text, "AND", text)], "AND", "root"), saved ?? "");
    },
    serialize: (tree, context) => {
      if (isTreePristine(tree)) return rawOf<string>(tree) ?? "";
      return filterTreeToSql(tree, context.fields);
    },
  };
}
