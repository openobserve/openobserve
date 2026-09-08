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

import type { TranslateFn } from "@/types/i18n";

export interface StreamSearchRow {
  name: string;
  stream_type?: string;
}

/** What every entity provider needs; kept narrow so providers stay unit-testable. */
export interface EntityProviderContext {
  store: { state: any };
  t: TranslateFn;
  org: string;
  hasRoute(name: string): boolean;
  /** Names of the rail links currently shown; the rail already applied role and config gates. */
  navNames: Set<string>;
  /** Keyword search for one stream type; created inside a component setup because useStreams needs the store. */
  searchStreams(
    type: string,
    query: string,
    limit: number,
  ): Promise<{ list?: StreamSearchRow[]; total?: number }>;
}
