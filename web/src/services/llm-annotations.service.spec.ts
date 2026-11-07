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

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/services/http", () => ({
  default: () => ({ post: mockPost, defaults: { baseURL: "http://o2" } }),
}));

import llmAnnotationsService, { type AnnotatePayload } from "./llm-annotations.service";
import analytics from "./product_analytics";

const payload: AnnotatePayload = {
  scope: "span",
  targetId: "span-1",
  traceId: "trace-1",
  refTimestamp: 1,
  sourceStream: "default",
  scores: [{ scoreConfigRowId: "row-1", value: 1 }],
};

beforeEach(() => {
  mockPost.mockReset();
  vi.mocked(analytics.track).mockClear();
});

describe("annotate() analytics", () => {
  it("tracks llm_annotation_created with the scope once the server confirms", async () => {
    mockPost.mockResolvedValue({ data: { annotationId: "a1" } });
    await llmAnnotationsService.annotate("acme", payload);
    expect(analytics.track).toHaveBeenCalledWith("llm_annotation_created", { scope: "span" });
  });

  it("does not track when the annotation is rejected", async () => {
    mockPost.mockRejectedValue(new Error("boom"));
    await expect(llmAnnotationsService.annotate("acme", payload)).rejects.toThrow("boom");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});

describe("sendTestFeedbackVote()", () => {
  beforeEach(() => {
    mockPost.mockResolvedValue({ data: { token: "fbt_t" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("mints a test token for the org's trace stream, then votes with it", async () => {
    await llmAnnotationsService.sendTestFeedbackVote("team3", "user_feedback", "u@x", "llm");
    expect(mockPost).toHaveBeenCalledWith(
      "/api/team3/annotations/token",
      expect.objectContaining({ stream: "llm", scoreConfig: "user_feedback", test: true }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://o2/api/v2/team3/annotations/public?token=fbt_t",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("leaves the stream to the server when the org has none", async () => {
    await llmAnnotationsService.sendTestFeedbackVote("team1", "user_feedback", "u@x", "");
    expect(mockPost.mock.calls[0][1].stream).toBeUndefined();
  });
});
