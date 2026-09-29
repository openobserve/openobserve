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
import { saveMonitorMutation } from "./synthetics.queries";
import { syntheticsKeys } from "./synthetics.querykeys";

vi.mock("./synthetics", () => ({
  default: {
    create: vi.fn().mockResolvedValue({ data: {} }),
    update: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const ORG = "test-org";

// Runs a mutation through the real MutationCache, so its `meta.invalidates` goes through the same key matching the app uses.
const run = async (options: any, variables: unknown) => {
  const mutation = queryClient.getMutationCache().build(queryClient, options);
  await mutation.execute(variables);
};

const isInvalidated = (queryKey: readonly unknown[]) =>
  queryClient.getQueryState(queryKey)?.isInvalidated ?? false;

describe("saveMonitorMutation", () => {
  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(syntheticsKeys.monitors(ORG, "default"), []);
    queryClient.setQueryData(syntheticsKeys.monitors(ORG), []);
    queryClient.setQueryData(syntheticsKeys.agentTokens(ORG), []);
  });

  it.each([
    ["create", { payload: {}, folderId: "default" }],
    ["update", { id: "m1", payload: {}, folderId: "default" }],
  ])("%s drops every monitor list but keeps agent tokens", async (_label, variables) => {
    await run(saveMonitorMutation(ORG), variables);

    expect(isInvalidated(syntheticsKeys.monitors(ORG, "default"))).toBe(true);
    expect(isInvalidated(syntheticsKeys.monitors(ORG))).toBe(true);
    expect(isInvalidated(syntheticsKeys.agentTokens(ORG))).toBe(false);
  });
});
