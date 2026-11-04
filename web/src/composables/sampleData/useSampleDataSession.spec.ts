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

const mocks = vi.hoisted(() => ({ load: vi.fn(), remove: vi.fn() }));
vi.mock("@/services/sample_data.queries", () => ({
  loadSampleDataMutation: (org: string) => ({
    mutationFn: (vars: unknown) => mocks.load(org, vars),
  }),
  removeSampleDataMutation: (org: string) => ({ mutationFn: () => mocks.remove(org) }),
}));

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
