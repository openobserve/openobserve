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
  coverageAll: (org: string) => orgKey(org, "autoobserve", "coverage"),
  coverage: (org: string, view: AutoObserveCoverageView) =>
    orgKey(org, "autoobserve", "coverage", view),
  suggestions: (org: string) => orgKey(org, "autoobserve", "suggestions"),
  suggestionsPage: (org: string, limit: number, offset: number, kind?: string) =>
    orgKey(org, "autoobserve", "suggestions", "proposed", limit, offset, ...(kind ? [kind] : [])),
  suggestionRank: (org: string, id: string, kind?: string) =>
    orgKey(org, "autoobserve", "suggestions", "rank", id, kind ?? ""),
  gapSuggestions: (org: string, pageSize: number) =>
    orgKey(org, "autoobserve", "suggestions", "proposed", "coverage_gap", pageSize),
  incidentsPage: (org: string, limit: number, offset: number) =>
    orgKey(org, "autoobserve", "incidents", limit, offset),
  incidentsPages: (org: string, range: string, pageSize: number, cap: number) =>
    orgKey(org, "autoobserve", "incidents", "pages", range, pageSize, cap),
  pagingSettings: (org: string) => orgKey(org, "autoobserve", "settings", "paging"),
  decisionsEnabled: (org: string) => orgKey(org, "autoobserve", "decisions", "enabled"),
  decisionsPages: (org: string) => orgKey(org, "autoobserve", "decisions", "page"),
  appliedDecisions: (org: string) => orgKey(org, "autoobserve", "decisions", "page", "applied"),
  dismissedDecisions: (org: string, family: string) =>
    orgKey(org, "autoobserve", "decisions", "page", "dismissed", family),
  decisionsPage: (org: string, family: string, limit: number, offset: number, state: string) =>
    orgKey(org, "autoobserve", "decisions", "page", family, limit, offset, state),
  decisionPreview: (org: string, params: Record<string, unknown>) =>
    orgKey(org, "autoobserve", "decisions", "preview", params),
};
