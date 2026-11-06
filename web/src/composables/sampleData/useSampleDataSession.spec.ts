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
      mutationFn: (vars: unknown) => mocks.remove(org, vars),
    }),
  };
});

const loaded = { counts: { logs: 10, spans: 2, metrics: 3 }, failedSteps: [] };

describe("useSampleDataSession remove", () => {
  let mod: typeof import("./useSampleDataSession");
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
    mod = await import("./useSampleDataSession");
    session = mod.useSampleDataSession();
  });

  it.each([
    ["ends", () => Promise.resolve([])],
    ["fails", () => Promise.reject(new Error("boom"))],
  ])("marks a removal as running until it %s", async (_, finish) => {
    let settle!: () => void;
    mocks.remove.mockReturnValue(new Promise<void>((r) => (settle = r)).then(finish));
    const removal = session.remove("org-a");
    await flushPromises();
    expect(session.removing.value).toBe(true);
    settle();
    await removal.catch(() => {});
    expect(session.removing.value).toBe(false);
  });

  it("ignores a second remove while one runs, so only one removal and one result", async () => {
    let settle!: (kept: string[]) => void;
    mocks.remove.mockReturnValue(new Promise<string[]>((r) => (settle = r)));
    const first = session.remove("org-a");
    await flushPromises();
    expect(await session.remove("org-a")).toEqual([]);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    settle(["fn_a"]);
    expect(await first).toEqual(["fn_a"]);
  });

  it("keeps another org's running load and its progress", async () => {
    const load = session.start("org-a");
    await flushPromises();
    await session.remove("org-b");

    expect(mocks.remove).toHaveBeenCalledWith("org-b", expect.anything());
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

  it("refuses to start a load while a removal runs", async () => {
    let settle!: () => void;
    mocks.remove.mockReturnValue(new Promise<void>((r) => (settle = r)));
    const removal = session.remove("org-a");
    await flushPromises();
    await session.start("org-a");
    await session.loadInDialog("org-a");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(session.status.value).toBe("idle");
    settle();
    await removal;
  });

  it("refuses to remove the org whose load is still running, so the load cannot bring it back", async () => {
    const load = session.start("org-a");
    await flushPromises();
    await expect(session.remove("org-a")).rejects.toBeInstanceOf(mod.SampleLoadRunningError);
    expect(mocks.remove).not.toHaveBeenCalled();

    finishLoad(loaded);
    await load;
    expect(session.status.value).toBe("loaded");
  });

  it("asks the browser to confirm leaving only while a load runs", async () => {
    const leave = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const load = session.start("org-a");
    await flushPromises();
    expect(leave()).toBe(true);
    finishLoad(loaded);
    await load;
    expect(leave()).toBe(false);
  });

  it("resets the session when it removes the org that was loaded", async () => {
    const load = session.start("org-a");
    await flushPromises();
    finishLoad(loaded);
    await load;
    await session.remove("org-a");

    expect(session.status.value).toBe("idle");
    expect(session.counts.logs).toBe(0);
  });

  it("removeInDialog opens the dialog and ends done with the kept names", async () => {
    mocks.remove.mockResolvedValue(["fn_a"]);
    await session.removeInDialog("org-a");
    expect(session.removeDialogOpen.value).toBe(true);
    expect(session.removePhase.value).toBe("done");
    expect(session.removeKept.value).toEqual(["fn_a"]);
    expect(session.removeOrg.value).toBe("org-a");
  });

  it("removeInDialog ends failed without throwing", async () => {
    const boom = new Error("boom");
    mocks.remove.mockRejectedValue(boom);
    await expect(session.removeInDialog("org-a")).resolves.toBeUndefined();
    expect(session.removePhase.value).toBe("failed");
    expect(session.removeError.value).toBe(boom);
  });

  it("removeInDialog does not run a second removal while one runs", async () => {
    let settle!: () => void;
    mocks.remove.mockReturnValue(new Promise<void>((r) => (settle = r)));
    const first = session.removeInDialog("org-a");
    await flushPromises();
    await session.removeInDialog("org-a");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    settle();
    await first;
  });

  it("closeRemoveDialog closes and resets once the removal is done", async () => {
    await session.removeInDialog("org-a");
    session.closeRemoveDialog();
    expect(session.removeDialogOpen.value).toBe(false);
    expect(session.removePhase.value).toBe("idle");
    expect(session.removeKept.value).toEqual([]);
  });

  it("removeFraction counts done and failed steps", async () => {
    mocks.remove.mockImplementation(async (_org, vars) => {
      vars.onStep("alerts", "running");
      vars.onStep("alerts", "done");
      vars.onStep("alertDelivery", "failed");
      vars.onStep("dashboards", "running");
      expect(session.removeFraction.value).toBe(2 / 6);
      return [];
    });
    await session.removeInDialog("org-a");
    expect(session.removeSteps.value.map((s) => s.status)).toEqual([
      "done",
      "failed",
      "running",
      "pending",
      "pending",
      "pending",
    ]);
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

describe("useSampleDataSession refused load", () => {
  it("flags a load the server refused, and the next load clears the flag", async () => {
    vi.resetModules();
    mocks.load
      .mockReset()
      .mockRejectedValueOnce({
        response: { status: 403, data: { message: "Unauthorized Access" } },
      })
      .mockResolvedValueOnce(loaded);
    const session = (await import("./useSampleDataSession")).useSampleDataSession();
    await session.start("org-a");
    expect(session.status.value).toBe("failed");
    expect(session.forbidden.value).toBe(true);
    await session.start("org-a");
    expect(session.forbidden.value).toBe(false);
  });
});

describe("useSampleDataSession progress", () => {
  it("settles each asset step as soon as it reports its end", async () => {
    vi.resetModules();
    const counts = loaded.counts;
    mocks.load.mockReset().mockImplementation((_org, vars) => {
      vars.onProgress({ step: "functions", fraction: 0, counts });
      vars.onProgress({ step: "functions", fraction: 1, counts });
      vars.onProgress({ step: "pipeline", fraction: 0, counts });
      vars.onProgress({ step: "pipeline", fraction: 1, counts, failed: true });
      vars.onProgress({ step: "dashboards", fraction: 0, counts });
      return new Promise(() => {});
    });
    const session = (await import("./useSampleDataSession")).useSampleDataSession();
    void session.start("org-a");
    await flushPromises();

    expect(session.status.value).toBe("loading");
    expect(session.steps).toMatchObject({
      functions: "done",
      pipeline: "failed",
      dashboards: "running",
    });
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
