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
import { flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({ load: vi.fn(), remove: vi.fn(), resolveTarget: vi.fn() }));
vi.mock("@/utils/sampleData/tour", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/sampleData/tour")>()),
  resolveTourTarget: (...args: unknown[]) => mocks.resolveTarget(...args),
}));
// the real options keep their meta, so the mutation cache expires what it would in the app
vi.mock("@/services/sample_data.queries", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/sample_data.queries")>();
  return {
    loadSampleDataMutation: (org: string) => ({
      ...real.loadSampleDataMutation(org),
      mutationFn: (vars: unknown) => mocks.load(org, vars),
    }),
    removeSampleDataMutation: (org: string) => ({
      ...real.removeSampleDataMutation(org),
      mutationFn: () => mocks.remove(org),
    }),
  };
});

const loaded = { counts: { logs: 10, spans: 2, metrics: 3 }, hours: 4, failedSteps: [] };

describe("useSampleDataSession remove", () => {
  let session: ReturnType<typeof import("./useSampleDataSession").useSampleDataSession>;
  let finishLoad: (value: typeof loaded) => void;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.load.mockReset().mockImplementation((_org, vars) => {
      vars.onProgress({ step: "telemetry", fraction: 0.5, counts: loaded.counts });
      return new Promise((resolve) => (finishLoad = resolve));
    });
    session = (await import("./useSampleDataSession")).useSampleDataSession();
  });

  it("keeps another org's running load and its progress", async () => {
    const load = session.start("org-a");
    await flushPromises();
    await session.remove("org-b");

    expect(mocks.remove).toHaveBeenCalledWith("org-b");
    expect(session.status.value).toBe("loading");
    expect(session.loadingOrg.value).toBe("org-a");
    expect(session.counts.logs).toBe(10);
    expect(session.steps.telemetry).toBe("running");
    // the one-load-at-a-time guard still holds
    await session.start("org-b");
    expect(mocks.load).toHaveBeenCalledTimes(1);

    finishLoad(loaded);
    await load;
    expect(session.status.value).toBe("loaded");
  });

  it("refuses to remove the org whose load is still running, so the load cannot bring it back", async () => {
    const load = session.start("org-a");
    await flushPromises();
    await expect(session.remove("org-a")).rejects.toThrow();
    expect(mocks.remove).not.toHaveBeenCalled();

    finishLoad(loaded);
    await load;
    expect(session.status.value).toBe("loaded");
  });

  it("resets the session when it removes the org that was loaded", async () => {
    const load = session.start("org-a");
    await flushPromises();
    finishLoad(loaded);
    await load;
    await session.remove("org-a");

    expect(session.status.value).toBe("idle");
    expect(session.result.value).toBeUndefined();
    expect(session.counts.logs).toBe(0);
  });
});

describe("useSampleDataSession load end", () => {
  it.each([
    ["loads", () => Promise.resolve(loaded)],
    ["fails part-way", () => Promise.reject(new Error("ingest failed"))],
  ])("refetches whether the org has data when its load %s", async (_, finish) => {
    vi.resetModules();
    mocks.load.mockReset().mockImplementation(finish);
    const { queryClient } = await import("@/composables/query/queryClient");
    const { streamKeys } = await import("@/services/stream.querykeys");
    const { organizationKeys } = await import("@/services/organizations.querykeys");
    const own = [streamKeys.nameList("org-a", "logs"), organizationKeys.summary("org-a")];
    const other = streamKeys.nameList("org-b", "logs");
    for (const key of [...own, other]) queryClient.setQueryData(key, []);

    await (await import("./useSampleDataSession")).useSampleDataSession().start("org-a");

    for (const key of own) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
  });
});

describe("useSampleDataSession startTourAndShow", () => {
  let session: ReturnType<typeof import("./useSampleDataSession").useSampleDataSession>;
  let resolveTarget: (to: string) => void;
  const push = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    push.mockReset();
    mocks.resolveTarget
      .mockReset()
      .mockImplementation(() => new Promise((resolve) => (resolveTarget = resolve)));
    session = (await import("./useSampleDataSession")).useSampleDataSession();
  });

  it("opens the first chapter once its target resolves", async () => {
    const shown = session.startTourAndShow("org-a", () => "org-a", { push });
    expect(session.tour.value).toMatchObject({ org: "org-a", index: 0 });
    resolveTarget("/dashboards");
    await shown;
    expect(push).toHaveBeenCalledWith("/dashboards");
  });

  it("opens another org's tour started from its finished-load toast", async () => {
    const shown = session.startTourAndShow("org-b", () => "org-a", { push });
    resolveTarget("/dashboards");
    await shown;
    expect(push).toHaveBeenCalledWith("/dashboards");
  });

  it.each([
    ["closed the tour", () => session.stopTour()],
    ["moved to the next chapter", () => session.setTourIndex(1)],
  ])("does not navigate when the user %s meanwhile", async (_, act) => {
    const shown = session.startTourAndShow("org-a", () => "org-a", { push });
    act();
    resolveTarget("/dashboards");
    await shown;
    expect(push).not.toHaveBeenCalled();
  });

  it("does not navigate when the user switched org meanwhile", async () => {
    let selected = "org-a";
    const shown = session.startTourAndShow("org-a", () => selected, { push });
    selected = "org-b";
    resolveTarget("/dashboards");
    await shown;
    expect(push).not.toHaveBeenCalled();
  });
});
