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
import { effectScope } from "vue";

const mocks = vi.hoisted(() => ({
  list: [] as any[],
  detail: {} as Record<string, any>,
  save: vi.fn(),
  bulk: vi.fn(),
  check: vi.fn(),
  order: [] as string[],
}));

vi.mock("@tanstack/vue-query", async (original) => ({
  ...(await original<any>()),
  useMutation: (factory: () => { mutationFn: unknown }) => ({
    mutateAsync: factory().mutationFn,
  }),
}));
vi.mock("@/services/alerts.queries", () => ({
  alertDetailQuery: (_org: string, id: string) => ({ kind: "detail", id }),
  alertsByTagsQuery: () => ({ kind: "list" }),
  saveAlertMutation: () => ({ mutationFn: mocks.save }),
  bulkToggleAlertsMutation: () => ({ mutationFn: mocks.bulk }),
}));
vi.mock("@/services/stream.queries", () => ({ streamNameListQuery: () => ({ kind: "streams" }) }));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: async (query: any) => {
    if (query.kind === "list") return mocks.list;
    if (query.kind === "detail") return mocks.detail[query.id];
    return [];
  },
}));
vi.mock("./useWouldFire", () => ({ useWouldFire: () => ({ check: mocks.check }) }));
vi.mock("./useRewriteChecks", () => ({
  useRewriteChecks: () => ({
    sql: vi.fn(),
    promql: vi.fn(async () => ({ type: "selector", name: "a", matchers: [] })),
  }),
}));

import { LIMIT_ATTRIBUTE, useTurnOnAlerts } from "./useTurnOnAlerts";

const alert = (id: string, priority: number) => ({
  id,
  name: id,
  priority,
  stream_type: "metrics",
  stream_name: "a",
  destinations: [],
  enabled: false,
  query_condition: {
    type: "promql",
    promql: "a",
    promql_condition: { operator: ">=", value: 1 },
  },
});

const quiet = { incidents: 0, runs: 0, checkedSeconds: 3600, noData: false };
const noisy = { incidents: 3, runs: 5, checkedSeconds: 3600, noData: false };
const choice = { critical: "pager", warning: "chat", clusters: [] };

const flow = {
  pack: { id: "kubernetes" },
  load: vi.fn(),
  trackAlertEdit: vi.fn((_pack, _ids, work) => work()),
} as any;

const setup = async () => {
  const scope = effectScope();
  const turnOn = scope.run(() => useTurnOnAlerts("default", flow))!;
  await turnOn.load();
  return turnOn;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order = [];
  mocks.detail = { a: alert("a", 1), b: alert("b", 3) };
  mocks.list = [
    { alert_id: "a", folder_id: "f", enabled: false },
    { alert_id: "b", folder_id: "f", enabled: false },
  ];
  mocks.check.mockResolvedValue(quiet);
  mocks.save.mockImplementation(async ({ payload }) => {
    mocks.order.push(`save:${payload.id}`);
  });
  mocks.bulk.mockImplementation(async ({ ids }) => {
    mocks.order.push(`enable:${ids.join()}`);
    return { data: { successful: ids } };
  });
});

describe("useTurnOnAlerts", () => {
  it("enables nothing by loading, counting or choosing", async () => {
    const turnOn = await setup();
    turnOn.choose("a", false);
    await turnOn.retryRow("b");
    expect(mocks.bulk).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("starts a noisy alert unchecked and lets a click overrule that", async () => {
    mocks.check.mockImplementation(async (body) => (body.id === "b" ? noisy : quiet));
    const turnOn = await setup();
    expect(turnOn.rows.value.find(({ id }) => id === "b")?.chosen).toBe(false);
    turnOn.choose("b", true);
    await turnOn.retryRow("b");
    expect(turnOn.rows.value.find(({ id }) => id === "b")?.chosen).toBe(true);
  });

  it("saves destinations by severity before enabling", async () => {
    const turnOn = await setup();
    expect(await turnOn.turnOn(choice)).toBe(2);
    expect(mocks.order).toEqual(["save:a", "save:b", "enable:a,b"]);
    expect(mocks.save.mock.calls[0][0].payload.destinations).toEqual(["pager"]);
    expect(mocks.save.mock.calls[1][0].payload.destinations).toEqual(["chat"]);
  });

  it("never enables an alert with no destination", async () => {
    const turnOn = await setup();
    await turnOn.turnOn({ ...choice, critical: "" });
    expect(mocks.bulk).toHaveBeenCalledWith(expect.objectContaining({ ids: ["b"] }));
    expect(turnOn.failedIds.value).toEqual(["a"]);
  });

  it("does not enable an alert whose destination save failed, and retries only the failed", async () => {
    mocks.save.mockImplementationOnce(async () => {
      throw new Error("nope");
    });
    const turnOn = await setup();
    await turnOn.turnOn(choice);
    expect(mocks.bulk.mock.calls[0][0].ids).toEqual(["b"]);
    expect(turnOn.failedIds.value).toEqual(["a"]);
    mocks.bulk.mockClear();
    await turnOn.turnOn(choice, turnOn.failedIds.value);
    expect(mocks.bulk.mock.calls[0][0].ids).toEqual(["a"]);
    expect(turnOn.failedIds.value).toEqual([]);
  });

  it("reports ids the bulk reply did not confirm", async () => {
    mocks.bulk.mockResolvedValue({ data: { successful: ["b"] } });
    const turnOn = await setup();
    expect(await turnOn.turnOn(choice)).toBe(1);
    expect(turnOn.failedIds.value).toEqual(["a"]);
  });

  it("saves the query unchanged when no cluster is chosen", async () => {
    mocks.detail.a.query_condition.type = "custom";
    const turnOn = await setup();
    await turnOn.turnOn(choice);
    expect(mocks.save.mock.calls[0][0].payload.query_condition.promql).toBe("a");
    expect(turnOn.failedIds.value).toEqual([]);
  });

  it("remembers the limit and replaces only that on a later turn-on", async () => {
    const turnOn = await setup();
    await turnOn.turnOn({ ...choice, clusters: ["eu"] });
    const saved = mocks.save.mock.calls[0][0].payload;
    expect(saved.context_attributes[LIMIT_ATTRIBUTE]).toBe('["eu"]');
    mocks.detail.a = saved;
    mocks.save.mockClear();
    const again = await setup();
    await again.turnOn({ ...choice, clusters: ["us"] }, ["a"]);
    const next = mocks.save.mock.calls[0][0].payload;
    expect(next.query_condition.promql).toBe('a{k8s_cluster=~"us"}');
    expect(next.context_attributes[LIMIT_ATTRIBUTE]).toBe('["us"]');
  });

  it("writes a cluster limit into the query at turn-on only", async () => {
    const turnOn = await setup();
    await turnOn.turnOn({ ...choice, clusters: ["eu"] });
    expect(mocks.save.mock.calls[0][0].payload.query_condition.promql).toBe('a{k8s_cluster=~"eu"}');
  });

  it("passes only the edited alerts to the tracked path", async () => {
    const turnOn = await setup();
    await turnOn.setThreshold("b", 2);
    expect(flow.trackAlertEdit).toHaveBeenCalledWith(flow.pack, ["b"], expect.any(Function));
  });

  it("flags a refused write so the screen can ask an admin", async () => {
    mocks.save.mockRejectedValue({ response: { status: 403 } });
    const turnOn = await setup();
    await turnOn.turnOn(choice);
    expect(turnOn.forbidden.value).toBe(true);
    expect(mocks.bulk).not.toHaveBeenCalled();
  });

  it("keeps the threshold edit inside the tracked path and recounts", async () => {
    const turnOn = await setup();
    await turnOn.setThreshold("a", 9);
    expect(flow.trackAlertEdit).toHaveBeenCalled();
    expect(mocks.save.mock.calls[0][0].payload.query_condition.promql_condition.value).toBe(9);
    expect(mocks.bulk).not.toHaveBeenCalled();
    expect(mocks.check).toHaveBeenCalledTimes(3);
  });

  it("turns alerts off by folder", async () => {
    const turnOn = await setup();
    await turnOn.turnOff(turnOn.rows.value);
    expect(mocks.bulk).toHaveBeenCalledWith({ ids: ["a", "b"], enabled: false, folderId: "f" });
  });
});
