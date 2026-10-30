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

import type { FilterField } from "@/utils/query/filterBar";

export interface SqlFilterBuilderProps {
  /** The page's WHERE text; the builder parses it and writes it back. */
  query: string;
  fields: FilterField[];
  loadValues?: (field: string, search: string) => Promise<string[]>;
  fieldsLoading?: boolean;
  /** Offer `match_all` full-text search for typed words. */
  freeText?: boolean;
  dataTest?: string;
}

export interface SqlFilterBuilderEmits {
  (_e: "update:query", _value: string): void;
  (_e: "submit"): void;
  /** The user chose to keep editing an unparsable query as text. */
  (_e: "exit"): void;
}
