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

import type { AssistantHostAdapter } from "./assistantStore.types";

export type HelperLanguage = AssistantHostAdapter["language"];

/** The query helper's request prefix per editor language; the request is `{prefix} : {ask}`. */
export const HELPER_PREFIXES: Readonly<Record<HelperLanguage, string>> = {
  sql: "Generate SQL query",
  promql: "Generate PromQL query",
  vrl: "Generate VRL function",
  js: "Generate JavaScript function",
  regex: "Generate SQL query",
  json: "Generate SQL query",
};

/** How a helper request starts; SQL keeps its ` : ` because people type "Generate SQL query for…" themselves. */
export const HELPER_REQUEST_STARTS: readonly string[] = [
  "Generate SQL query : ",
  "Generate PromQL query",
  "Generate VRL function",
  "Generate JavaScript function",
];
