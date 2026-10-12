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

vi.mock("@/services/http", () => ({ default: () => ({ post: mockPost }) }));

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
