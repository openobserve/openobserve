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

// The four Evaluations lists are cached per org for minutes, and every page that
// reads one (Evaluations, Playground, Experiment detail, trace score chips) reads
// the cache without forcing. So a write that does not invalidate leaves the next
// read serving the pre-write list. These tests pin that every write path drops it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MutationObserver, type MutationObserverOptions } from "@tanstack/vue-query";
import type { EvalJobPayload } from "./online-evals.service";

const server = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/services/http", () => {
  const collection = (url: string) => url.split("/")[3];
  return {
    default: () => ({
      get: vi.fn(async (url: string) => ({
        data: { list: [...(server.rows[collection(url)] ?? [])] },
      })),
      post: vi.fn(async (url: string, body: Record<string, unknown>) => {
        const [, , , name, id, action] = url.split("/");
        if (action) {
          const row = server.rows[name].find((r) => r.id === id)!;
          row.status = action === "activate" ? "active" : "paused";
          return { data: row };
        }
        const row = { id: `${name}-${server.rows[name].length + 1}`, ...body };
        server.rows[name].push(row);
        return { data: row };
      }),
      put: vi.fn(async (url: string, body: Record<string, unknown>) => {
        const [, , , name, id] = url.split("/");
        const row = server.rows[name].find((r) => r.id === id)!;
        Object.assign(row, body);
        return { data: row };
      }),
      delete: vi.fn(async (url: string) => {
        const [, , , name, id] = url.split("/");
        server.rows[name] = server.rows[name].filter((r) => r.id !== id);
        return {};
      }),
    }),
  };
});

import { queryClient } from "@/composables/query/queryClient";
import {
  deleteEvalEntityMutation,
  evalJobsQuery,
  saveEvalJobMutation,
  saveProviderMutation,
  saveScoreConfigMutation,
  saveScorerMutation,
  scoreConfigsQuery,
  scorersQuery,
  providersQuery,
  setJobActiveMutation,
} from "./online-evals.service.queries";

const ORG = "acme";

// Runs a declared write the way `useMutation` does, so the client's shared
// `meta.invalidates` handling applies exactly as it does in the app.
function write<TData, V>(options: MutationObserverOptions<TData, Error, V>, vars: V) {
  return new MutationObserver(queryClient, options).mutate(vars);
}

beforeEach(() => {
  server.rows = {
    providers: [{ id: "providers-1", name: "openai" }],
    scorers: [{ id: "scorers-1", name: "helpfulness" }],
    score_configs: [{ id: "score_configs-1", name: "quality", healthyThreshold: 0.5 }],
    eval_jobs: [{ id: "eval_jobs-1", name: "nightly", status: "draft" }],
  };
});

describe("Evaluations list cache after a write", () => {
  it("a scorer created from the form or an import is in the next scorers read", async () => {
    expect(await queryClient.fetchQuery(scorersQuery(ORG))).toHaveLength(1);

    await write(saveScorerMutation(ORG), { payload: { name: "faithfulness" } });

    const rows = await queryClient.fetchQuery(scorersQuery(ORG));
    expect(rows.map((r) => r.name)).toEqual(["helpfulness", "faithfulness"]);
  });

  it("a score config edit reaches the next score-config read", async () => {
    await queryClient.fetchQuery(scoreConfigsQuery(ORG));

    await write(saveScoreConfigMutation(ORG), {
      id: "score_configs-1",
      payload: { healthyThreshold: 0.8 },
    });

    const [config] = await queryClient.fetchQuery(scoreConfigsQuery(ORG));
    expect(config.healthyThreshold).toBe(0.8);
  });

  it("a job created and activated from the form reads back as active", async () => {
    await queryClient.fetchQuery(evalJobsQuery(ORG));

    // The fake server stores whatever it is sent; only the name matters to the assertion.
    const payload = { name: "hourly" } as unknown as EvalJobPayload;
    const created = await write(saveEvalJobMutation(ORG), { payload });
    await write(setJobActiveMutation(ORG), { id: created.id, active: true });

    const rows = await queryClient.fetchQuery(evalJobsQuery(ORG));
    expect(rows.find((r) => r.id === created.id)?.status).toBe("active");
  });

  it("a delete drops the row from the next read", async () => {
    await queryClient.fetchQuery(scorersQuery(ORG));

    await write(deleteEvalEntityMutation(ORG), { tab: "scorers", id: "scorers-1" });

    expect(await queryClient.fetchQuery(scorersQuery(ORG))).toEqual([]);
  });

  it("a provider saved in Settings is in the providers list Playground and Evaluations read", async () => {
    await queryClient.fetchQuery(providersQuery(ORG));

    await write(
      saveProviderMutation(
        ORG,
        () => false,
        () => "",
      ),
      { name: "anthropic" },
    );

    const rows = await queryClient.fetchQuery(providersQuery(ORG));
    expect(rows.map((r) => r.name)).toEqual(["openai", "anthropic"]);
  });

  it("an unchanged list is served from the cache, not refetched", async () => {
    await queryClient.fetchQuery(scorersQuery(ORG));
    server.rows.scorers.push({ id: "scorers-2", name: "written-behind-the-cache" });

    expect(await queryClient.fetchQuery(scorersQuery(ORG))).toHaveLength(1);
  });
});
