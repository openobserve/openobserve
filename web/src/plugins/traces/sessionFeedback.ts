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

// End-user feedback (AIO-40) for the Sessions list's Feedback column.

import { ref, watch, type Ref } from "vue";
import config from "@/aws-exports";
import { escapeSqlString } from "@/enterprise/components/onlineEvals/utils/scoreThreshold";
import { latestScoresFromSql } from "@/enterprise/components/onlineEvals/utils/latestScoreSql";
import { useLLMStreamQuery } from "./composables/useLLMStreamQuery";

/** Ceiling on votes read for one page of sessions. */
const MAX_VOTES = 5000;

export interface SessionFeedback {
  helpful: number;
  notHelpful: number;
  /** The newest Not helpful vote's comment. */
  comment: string | null;
}

/**
 * One query for the page's sessions: the newest vote per user and trace. Session
 * ids are only unique within a stream, so votes are read for the page's stream.
 */
export function sessionFeedbackSql(stream: string, sessionIds: string[]): string {
  const ids = sessionIds.map((id) => `'${escapeSqlString(id)}'`).join(", ");
  const where = [
    "source_type = 'feedback'",
    `source_stream = '${escapeSqlString(stream)}'`,
    "source_stream_type = 'traces'",
    `session_id IN (${ids})`,
  ].join(" AND ");
  return [
    "SELECT session_id, value_boolean, reasoning, _timestamp",
    `FROM ${latestScoresFromSql(where)}`,
    "ORDER BY _timestamp DESC",
    `LIMIT ${MAX_VOTES}`,
  ].join("\n");
}

/** Folds vote rows (newest first) into per-session counts. A complaint outranks praise. */
export function feedbackBySession(
  rows: Record<string, unknown>[],
): Record<string, SessionFeedback> {
  const bySession: Record<string, SessionFeedback> = {};
  for (const row of rows) {
    const sessionId = String(row.session_id ?? "");
    const value = row.value_boolean == null ? "" : String(row.value_boolean);
    // Helpful / Not helpful is a Boolean config's vocabulary; other types have no column value.
    if (!sessionId || (value !== "true" && value !== "false")) continue;
    const entry = (bySession[sessionId] ??= { helpful: 0, notHelpful: 0, comment: null });
    if (value === "true") {
      entry.helpful += 1;
    } else {
      entry.notHelpful += 1;
      entry.comment ??= typeof row.reasoning === "string" && row.reasoning ? row.reasoning : null;
    }
  }
  return bySession;
}

/**
 * Votes for the sessions on the current page of `stream`. `_llm_scores` is
 * enterprise only, so OSS never queries and the column stays hidden.
 */
export function useSessionFeedback(
  sessions: Ref<{ sessionId: string }[]>,
  stream: () => string,
  startTimeUs: () => number,
) {
  const { executeQueryOnce } = useLLMStreamQuery();
  const feedback = ref<Record<string, SessionFeedback>>({});
  const enabled = config.isEnterprise === "true" || config.isCloud === "true";

  watch(
    sessions,
    async (rows) => {
      feedback.value = {};
      const ids = rows.map((row) => row.sessionId).filter(Boolean);
      const streamName = stream();
      if (!enabled || !ids.length || !streamName) return;
      try {
        const hits = await executeQueryOnce(
          sessionFeedbackSql(streamName, ids),
          // Votes land after the session, so the window runs to now.
          Math.max(0, Math.floor(startTimeUs()) - 1),
          Date.now() * 1000,
          "logs",
        );
        // A newer page owns the column now.
        if (rows === sessions.value) feedback.value = feedbackBySession(hits ?? []);
      } catch {
        // No `_llm_scores` yet, or the query failed: no column, not an error.
      }
    },
    { immediate: true },
  );

  return feedback;
}
