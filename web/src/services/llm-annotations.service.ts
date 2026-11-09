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

import http from "@/services/http";
import { publicVotePath } from "@/enterprise/components/onlineEvals/utils/feedbackCollect";
import analytics from "./product_analytics";

// ─── LLM Annotation · Direct annotation ─────────────────────────────────────
// Scoring a trace/span/session WITHOUT a queue: the reviewer picks dimensions
// and records their judgment there and then. The queue path
// (annotation_queues/…/reviews) is the same act inside a managed work pool.

export type AnnotationScope = "span" | "trace" | "session";

export interface AnnotationScoreInput {
  /** Physical row id of the pinned Score Config version being scored. */
  scoreConfigRowId: string;
  value: number | string | boolean;
  /** The reviewer's "why this score" note. */
  reasoning?: string | null;
}

export interface AnnotatePayload {
  scope: AnnotationScope;
  targetId: string;
  /** Required for a span; useful context on a trace. */
  traceId?: string | null;
  sessionId?: string | null;
  /** The evaluated object's timestamp, MICROSECONDS. */
  refTimestamp: number;
  sourceStream: string;
  scores: AnnotationScoreInput[];
}

export interface AnnotateResult {
  annotationId: string;
  scoreIds: string[];
  annotatedAt: number;
}

const llmAnnotationsService = {
  /** Record one annotation covering every dimension the reviewer filled in. */
  async annotate(orgId: string, payload: AnnotatePayload): Promise<AnnotateResult> {
    const res = await http().post(`/api/${orgId}/annotations`, {
      scope: payload.scope,
      targetId: payload.targetId,
      traceId: payload.traceId ?? null,
      sessionId: payload.sessionId ?? null,
      refTimestamp: payload.refTimestamp,
      sourceStream: payload.sourceStream,
      scores: payload.scores.map((score) => ({
        scoreConfigRowId: score.scoreConfigRowId,
        value: score.value,
        reasoning: score.reasoning?.trim() ? score.reasoning.trim() : null,
      })),
    });
    analytics.track("llm_annotation_created", { scope: payload.scope });
    const data = res.data ?? {};
    return {
      annotationId: data.annotationId ?? data.annotation_id ?? "",
      scoreIds: Array.isArray(data.scoreIds ?? data.score_ids)
        ? (data.scoreIds ?? data.score_ids)
        : [],
      annotatedAt: Number(data.annotatedAt ?? data.annotated_at ?? 0),
    };
  },

  /**
   * End-user feedback (AIO-40): mint, as the signed-in user, the token an
   * app's server would mint, then post one vote with it the way the app's
   * browser would — a plain `fetch` with no session, so a refused token is
   * a 401 for this call only, not a sign-out. `stream` is the trace stream
   * the snippet shows; empty when the org has none, which a test vote allows.
   */
  async sendTestFeedbackVote(
    orgId: string,
    scoreConfig: string,
    userId: string,
    stream: string,
  ): Promise<void> {
    const api = http();
    const res = await api.post(`/api/${orgId}/annotations/token`, {
      scope: "trace",
      traceId: `test-vote-${Date.now()}`,
      stream: stream || undefined,
      scoreConfig,
      userId,
      test: true,
    });
    const vote = await fetch(
      `${api.defaults.baseURL ?? ""}${publicVotePath(orgId)}?token=${encodeURIComponent(res.data?.token ?? "")}`,
      {
        method: "POST",
        body: JSON.stringify({ value: true, comment: "Test vote from OpenObserve" }),
      },
    );
    if (!vote.ok) {
      const body = await vote.json().catch(() => ({}));
      throw new Error(body?.message || body?.error || `HTTP ${vote.status}`);
    }
  },
};

export default llmAnnotationsService;
