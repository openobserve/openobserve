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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { queryClient } from "@/composables/query/queryClient";
import {
  createAnnotationMutation,
  updateAnnotationMutation,
  deleteAnnotationMutation,
} from "./dashboard_annotations.queries";
import { annotationKeys } from "./dashboard_annotations.querykeys";
import { dashboardKeys } from "./dashboards.querykeys";

vi.mock("./dashboard_annotations", () => ({
  annotationService: {
    create_timed_annotations: vi.fn().mockResolvedValue({ data: {} }),
    update_timed_annotations: vi.fn().mockResolvedValue({ data: {} }),
    delete_timed_annotations: vi.fn().mockResolvedValue({ data: {} }),
    get_timed_annotations: vi.fn(),
  },
}));

const ORG = "test-org";
const params = { panels: ["p1"], start_time: 1, end_time: 2 };

// Runs a mutation through the real MutationCache, so its `meta.invalidates` goes through the same key matching the app uses.
const run = async (options: any, variables: unknown) => {
  const mutation = queryClient.getMutationCache().build(queryClient, options);
  await mutation.execute(variables);
};

const isInvalidated = (queryKey: readonly unknown[]) =>
  queryClient.getQueryState(queryKey)?.isInvalidated ?? false;

describe("annotation mutations", () => {
  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(annotationKeys.list(ORG, "dash-a", params), []);
    queryClient.setQueryData(annotationKeys.list(ORG, "dash-b", params), []);
    queryClient.setQueryData(dashboardKeys.byFolder(ORG, "default"), []);
  });

  it.each([
    ["create", () => createAnnotationMutation(ORG, "dash-a"), [{ title: "x" }]],
    [
      "update",
      () => updateAnnotationMutation(ORG, "dash-a"),
      { annotationId: "a1", annotation: { title: "y" } },
    ],
    ["delete", () => deleteAnnotationMutation(ORG, "dash-a"), ["a1"]],
  ])("%s drops only the edited dashboard's annotations", async (_label, build, variables) => {
    await run(build(), variables);

    expect(isInvalidated(annotationKeys.list(ORG, "dash-a", params))).toBe(true);
    expect(isInvalidated(annotationKeys.list(ORG, "dash-b", params))).toBe(false);
    expect(isInvalidated(dashboardKeys.byFolder(ORG, "default"))).toBe(false);
  });
});
