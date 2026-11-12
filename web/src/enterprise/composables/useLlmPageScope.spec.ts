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

import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { TranslateFn } from "@/types/i18n";

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "default" } } }),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: async () => ({ list: [{ name: "agents_stream" }, { name: "other_stream" }] }),
  }),
}));

vi.mock("@/services/gen-ai-agent-mapping.service", () => ({
  default: {
    listAgents: async () => ({
      agents: [
        { name: "omp", source_stream: "agents_stream" },
        { name: "shared", source_stream: "agents_stream" },
        { name: "shared", source_stream: "other_stream" },
      ],
    }),
  },
}));

import { useLlmPageScope } from "./useLlmPageScope";

describe("useLlmPageScope", () => {
  async function loaded() {
    // Labels are never read here; an identity function stands in for i18n.
    const scope = useLlmPageScope(((key: string) => key) as unknown as TranslateFn);
    await scope.load(1, 2);
    expect(scope.stream.value).toBe("agents_stream");
    return scope;
  }

  // Before, the agent stayed picked and scoped the new stream's query to no rows.
  it("drops the agent when the new stream does not have it", async () => {
    const { stream, agentName, scope } = await loaded();
    agentName.value = "omp";
    stream.value = "other_stream";
    await nextTick();
    expect(agentName.value).toBeNull();
    expect(scope.value).toBe("");
  });

  it("keeps the agent when the new stream has it too", async () => {
    const { stream, agentName } = await loaded();
    agentName.value = "shared";
    stream.value = "other_stream";
    await nextTick();
    expect(agentName.value).toBe("shared");
  });
});
