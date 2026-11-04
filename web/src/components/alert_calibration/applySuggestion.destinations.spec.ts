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

import { describe, expect, it } from "vitest";
import type { FindingRecord } from "./digests";
import { applySuggestionsOf } from "./applySuggestion";

// The same literal is DESTINATIONS_FIXTURE in ENT autoobserve/insight.rs.
const DESTINATIONS_FIXTURE =
  '{"type":"apply_suggestion","alert_id":"a1","patch":[{"field":"destinations","from":[],"to":["ops-pager"]}]}';

describe("the no_destination writer's apply_suggestion", () => {
  it("the writer's destinations fixture survives applySuggestionsOf", () => {
    const record = {
      _timestamp: 1,
      org: "ops",
      config_id: "c1",
      window_start: 0,
      window_end: 1,
      schema_version: 2,
      kind: "finding",
      rule_id: "no_destination",
      severity: "High",
      confidence: "High",
      title: "ops_quiet fired 5 times and has no destination attached now",
      alert_id: "a1",
      alert_name: "ops_quiet",
      finding_id: "f1",
      insight_actions:
        "[" + DESTINATIONS_FIXTURE + ',{"type":"review_alert","alert_id":"a1","focus":"settings"}]',
    } as FindingRecord;
    expect(applySuggestionsOf(record)).toEqual([JSON.parse(DESTINATIONS_FIXTURE)]);
  });
});
