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

// End-user feedback (AIO-40): the "Collect from your app" tab on a Score Config.

import { escapeSqlString } from "./scoreThreshold";
import { latestScoresFromSql } from "./latestScoreSql";

/** Under `/api/v2/` like every token-authenticated route: it sits outside session auth. */
export function publicVotePath(org: string): string {
  return `/api/v2/${org}/annotations/public`;
}

export interface FeedbackSnippets {
  /** The app's server mints a token per trace and user. */
  server: string;
  /** The app's browser posts the vote with it. */
  browser: string;
}

/**
 * The two snippets, filled in with this instance, org, Score Config and the
 * org's LLM trace stream (a placeholder when it has none yet).
 */
export function buildFeedbackSnippets(
  apiEndpoint: string,
  org: string,
  configName: string,
  stream: string,
): FeedbackSnippets {
  const base = apiEndpoint.replace(/\/+$/, "");
  const body = JSON.stringify({
    scope: "trace",
    traceId: "<trace id>",
    stream: stream || "<trace stream>",
    scoreConfig: configName,
    userId: "<end user id>",
    sessionId: "<conversation id>",
  });
  return {
    server: [
      `curl -X POST "${base}/api/${org}/annotations/token" \\`,
      `  -u "$O2_SERVICE_ACCOUNT:$O2_SERVICE_ACCOUNT_TOKEN" \\`,
      `  -H "Content-Type: application/json" \\`,
      // A quote in the config name would end the single-quoted shell string.
      `  -d '${body.replace(/'/g, "'\\''")}'`,
      `# 200 {"token":"fbt_…","expiresIn":900}`,
    ].join("\n"),
    // No Content-Type header: a text/plain POST needs no CORS preflight.
    browser: [
      `await fetch(\`${base}${publicVotePath(org)}?token=\${token}\`, {`,
      `  method: "POST",`,
      `  body: JSON.stringify({ value: false, comment: "wrong order" }),`,
      `});`,
    ].join("\n"),
  };
}

/** Newest vote per user and trace (a changed vote replaces the old one), rolled up. */
export function feedbackStatusSql(scoreConfigId: string): string {
  const where = `source_type = 'feedback' AND score_config_id = '${escapeSqlString(scoreConfigId)}'`;
  return [
    "SELECT COUNT(*) AS votes,",
    "  SUM(CASE WHEN value_boolean THEN 1 ELSE 0 END) AS helpful,",
    "  MAX(_timestamp) AS last_vote",
    `FROM ${latestScoresFromSql(where)}`,
  ].join("\n");
}

export interface FeedbackStatus {
  votes: number;
  /** null with no votes. */
  helpfulPct: number | null;
  /** Epoch ms of the newest vote, or null with none. */
  lastVoteMs: number | null;
}

export function feedbackStatus(row: Record<string, unknown> | undefined): FeedbackStatus {
  const votes = Number(row?.votes) || 0;
  const lastVoteUs = Number(row?.last_vote);
  return {
    votes,
    helpfulPct: votes ? Math.round(((Number(row?.helpful) || 0) / votes) * 100) : null,
    lastVoteMs: votes && lastVoteUs > 0 ? Math.floor(lastVoteUs / 1000) : null,
  };
}
