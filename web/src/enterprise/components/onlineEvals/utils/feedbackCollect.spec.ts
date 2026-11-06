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
import {
  buildFeedbackSnippets,
  feedbackStatus,
  feedbackStatusSql,
  publicVotePath,
} from "./feedbackCollect";

describe("buildFeedbackSnippets", () => {
  it("fills in this instance, org, Score Config and trace stream", () => {
    const { server, browser } = buildFeedbackSnippets(
      "https://o2.example.com/",
      "team1",
      "user_feedback",
      "llm_traces",
    );
    expect(server).toContain('curl -X POST "https://o2.example.com/api/team1/annotations/token"');
    expect(server).toContain('"scope":"trace"');
    expect(server).toContain('"scoreConfig":"user_feedback"');
    expect(server).toContain('"stream":"llm_traces"');
    expect(server).toContain('"expiresIn":900');
    expect(browser).toContain(
      "await fetch(`https://o2.example.com/api/v2/team1/annotations/public?token=${token}`",
    );
    expect(browser).toContain('JSON.stringify({ value: false, comment: "wrong order" })');
    // A CORS-simple request: no Content-Type, no preflight.
    expect(browser).not.toContain("Content-Type");
  });

  it("shows a stream placeholder when the org has no trace stream yet", () => {
    const { server } = buildFeedbackSnippets("http://localhost:5080", "team1", "user_feedback", "");
    expect(server).toContain('"stream":"<trace stream>"');
  });

  it("keeps the shell string closed around a quote in the config name", () => {
    const { server } = buildFeedbackSnippets(
      "http://localhost:5080",
      "default",
      "it's ok",
      "default",
    );
    expect(server).toContain(`"scoreConfig":"it'\\''s ok"`);
  });
});

describe("publicVotePath", () => {
  it("sits under /api/v2 like every token-authenticated route", () => {
    expect(publicVotePath("default")).toBe("/api/v2/default/annotations/public");
  });
});

describe("feedbackStatusSql", () => {
  it("rolls up the newest feedback vote per identity for one config", () => {
    const sql = feedbackStatusSql("cfg-'1");
    expect(sql).toContain("source_type = 'feedback' AND score_config_id = 'cfg-''1'");
    expect(sql).toContain("_latest_score_rank = 1");
    expect(sql).toContain("COUNT(*) AS votes");
  });
});

describe("feedbackStatus", () => {
  it("derives the status line from the rollup row", () => {
    expect(feedbackStatus({ votes: 4, helpful: 3, last_vote: 1_700_000_000_000_000 })).toEqual({
      votes: 4,
      helpfulPct: 75,
      lastVoteMs: 1_700_000_000_000,
    });
  });

  it("reads no votes as no status", () => {
    expect(feedbackStatus(undefined)).toEqual({ votes: 0, helpfulPct: null, lastVoteMs: null });
    expect(feedbackStatus({ votes: 0, helpful: null, last_vote: null })).toEqual({
      votes: 0,
      helpfulPct: null,
      lastVoteMs: null,
    });
  });
});
