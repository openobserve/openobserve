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
import { feedbackBySession, sessionFeedbackSql } from "./sessionFeedback";

describe("sessionFeedbackSql", () => {
  it("reads the newest feedback votes for the page's sessions in one query", () => {
    const sql = sessionFeedbackSql("harness_test", ["s-1", "s'2"]);
    expect(sql).toContain("session_id IN ('s-1', 's''2')");
    expect(sql).toContain("_latest_score_rank = 1");
    expect(sql).toContain("ORDER BY _timestamp DESC");
  });

  // Session ids repeat across streams: another stream's votes must not land here.
  it("reads only votes cast on the page's trace stream", () => {
    const sql = sessionFeedbackSql("it's", ["s-1"]);
    expect(sql).toContain("source_type = 'feedback'");
    expect(sql).toContain("source_stream = 'it''s'");
    expect(sql).toContain("source_stream_type = 'traces'");
  });
});

describe("feedbackBySession", () => {
  it("counts votes per session and keeps the newest complaint's comment", () => {
    const rows = [
      { session_id: "s-1", value_boolean: false, reasoning: "wrong order" },
      { session_id: "s-1", value_boolean: "false", reasoning: "older complaint" },
      { session_id: "s-1", value_boolean: true, reasoning: null },
      { session_id: "s-2", value_boolean: true },
      { session_id: "s-3", value_boolean: false, reasoning: "" },
    ];
    expect(feedbackBySession(rows)).toEqual({
      "s-1": { helpful: 1, notHelpful: 2, comment: "wrong order" },
      "s-2": { helpful: 1, notHelpful: 0, comment: null },
      "s-3": { helpful: 0, notHelpful: 1, comment: null },
    });
  });

  it("skips rows with no session or no Boolean value", () => {
    expect(
      feedbackBySession([
        { session_id: "", value_boolean: false },
        { session_id: "s-1", value_boolean: null },
        { session_id: "s-1" },
      ]),
    ).toEqual({});
  });
});
