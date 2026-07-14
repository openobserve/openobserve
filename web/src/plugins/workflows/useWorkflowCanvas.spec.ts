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

// Guard tests for the workflow run-history mapping (loadWorkflowRun). This is
// the most merge-sensitive workflow logic: it adapts the backend /errors/{run_id}
// response (errors as an ARRAY, per-node inputs as a MAP) into the shared
// testRun.result shape the canvas badges + step drawer read.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/workflows", () => ({
  default: { getWorkflowRun: vi.fn() },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => p,
  getUUID: () => "uuid",
}));

import workflowService from "@/services/workflows";
import {
  workflowObj,
  loadWorkflowRun,
} from "@/plugins/workflows/useWorkflowCanvas";

const mockRun = workflowService.getWorkflowRun as unknown as ReturnType<
  typeof vi.fn
>;

describe("loadWorkflowRun — history run response mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // trigger(n1) -> function(n2) -> destination(n3)
    workflowObj.currentSelectedWorkflow = {
      id: "wf1",
      name: "wf",
      nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    } as any;
    workflowObj.testRun.result = null;
  });

  it("maps errors.data (array) to a node-keyed map and node_map to nodeInputs", async () => {
    const envelope = [{ meta: { alert_name: "t" }, data: [{ a: 1 }] }];
    mockRun.mockResolvedValue({
      data: {
        errors: { run_id: "r1", data: [{ node_id: "n2", error: ["boom"] }] },
        data: { complete: envelope, node_map: { n2: envelope } },
      },
    });

    const r = await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r1" });
    expect(r.ok).toBe(true);

    const res: any = workflowObj.testRun.result;
    expect(res.mode).toBe("history");
    expect(res.runId).toBe("r1");
    // array -> keyed map, in the { error_count, errors: [[msg]] } badge shape
    expect(res.errors.n2).toEqual({ error_count: 1, errors: [["boom"]] });
    // per-node input carried through verbatim (the {meta,data} envelope)
    expect(res.nodeInputs.n2).toEqual(envelope);
    expect(res.fullInput).toEqual(envelope);
    // every node counts as "ran"; n3 is downstream of the errored n2 -> blocked
    expect(res.ranNodeIds).toEqual(["n1", "n2", "n3"]);
    expect(res.blockedNodeIds).toContain("n3");
    expect(res.blockedNodeIds).not.toContain("n2");
  });

  it("normalizes a non-array error field into a single-message list", async () => {
    mockRun.mockResolvedValue({
      data: {
        errors: { data: [{ node_id: "n2", error: "single" }] },
        data: { node_map: {} },
      },
    });
    await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r2" });
    expect((workflowObj.testRun.result as any).errors.n2).toEqual({
      error_count: 1,
      errors: [["single"]],
    });
  });

  it("handles a clean run (no errors) with empty maps", async () => {
    mockRun.mockResolvedValue({
      data: { errors: { data: [] }, data: { node_map: {} } },
    });
    const r = await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r3" });
    expect(r.ok).toBe(true);
    const res: any = workflowObj.testRun.result;
    expect(Object.keys(res.errors)).toHaveLength(0);
    expect(res.blockedNodeIds).toHaveLength(0);
  });

  it("returns ok:false with the backend message on failure", async () => {
    mockRun.mockRejectedValue({ response: { data: { message: "nope" } } });
    const r = await loadWorkflowRun({ orgId: "o", workflowId: "wf1", runId: "r4" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("nope");
  });
});
