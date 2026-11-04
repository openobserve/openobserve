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

import { orgKey } from "@/composables/query/keys";
import type { AutoObserveCoverageView } from "./autoobserve";

export const autoobserveKeys = {
  all: (org: string) => orgKey(org, "autoobserve"),
  coverage: (org: string, view: AutoObserveCoverageView) =>
    orgKey(org, "autoobserve", "coverage", view),
  suggestions: (org: string) => orgKey(org, "autoobserve", "suggestions"),
  suggestionsPage: (org: string, limit: number, offset: number) =>
    orgKey(org, "autoobserve", "suggestions", "proposed", limit, offset),
  incidentsPage: (org: string, limit: number, offset: number) =>
    orgKey(org, "autoobserve", "incidents", limit, offset),
};
