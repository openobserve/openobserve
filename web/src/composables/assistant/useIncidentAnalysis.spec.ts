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

import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, effectScope, nextTick, reactive, ref } from "vue";

import type { GateCode } from "./assistantStore.types";
import type { TurnTerminal } from "./turnStates";
import { resetIncidentAnalysisForTests, useIncidentAnalysis } from "./useIncidentAnalysis";

function fakeStore() {
  const state = reactive({ sessions: {} as Record<string, any> });
  let finish: ((terminal: TurnTerminal) => void) | null = null;
  const store = {
    state,
    createSession: vi.fn((init: any) => {
      const sid = `rca${Object.keys(state.sessions).length + 1}`;
      state.sessions[sid] = {
        sid,
        origin: init.origin,
        incidentId: init.incidentId,
        ephemeral: init.ephemeral,
        title: init.title,
        turn: { state: "idle" },
        turnMeta: { startedAt: null, ownedByThisTab: true },
        messages: [],
      };
      return sid;
    }),
    stage: vi.fn(),
    send: vi.fn((sid: string) => {
      state.sessions[sid].turn = { state: "responding.writing" };
      state.sessions[sid].messages.push({ role: "user", content: "Analyze incident" });
      state.sessions[sid].messages.push({ role: "assistant", content: "## Root" });
      return new Promise<TurnTerminal>((resolve) => {
        finish = (terminal) => {
          state.sessions[sid].turn = terminal;
          resolve(terminal);
        };
      });
    }),
    stop: vi.fn(async () => finish?.({ state: "stopped", steps: 0, partial: true })),
    dropSession: vi.fn((sid: string) => delete state.sessions[sid]),
    resolveConsent: vi.fn(),
  };
  return { store, end: (terminal: TurnTerminal) => finish?.(terminal) };
}

function setup(gate: GateCode = "available", org = "default") {
  const fake = fakeStore();
  const code = ref<GateCode>(gate);
  const capability = computed(() => ({ gate: code.value, rcaEnabled: false }));
  const scope = effectScope();
  const analysis = scope.run(() =>
    useIncidentAnalysis(() => "inc-1", {
      store: fake.store as any,
      capability,
      org: () => org,
    }),
  )!;
  return { ...fake, code, scope, analysis };
}

afterEach(() => {
  resetIncidentAnalysisForTests();
});

describe("useIncidentAnalysis", () => {
  it("decides the gate before any click", () => {
    expect(setup("not_configured").analysis.gate.value).toEqual({
      state: "ai_off",
      reason: "not_configured",
    });
    expect(setup("no_permission").analysis.gate.value).toEqual({
      state: "no_permission",
      reason: "no_permission",
    });
    expect(setup("available").analysis.gate.value).toBeNull();
  });

  it("refuses to send behind a gate", async () => {
    const { store, analysis } = setup("off_for_org");
    expect(await analysis.analyze({ reanalysis: false, buildOnPrevious: false })).toBeNull();
    expect(store.send).not.toHaveBeenCalled();
  });

  it("runs an ephemeral rca session for the incident with the run's flags", async () => {
    const { store, end, analysis } = setup();
    const run = analysis.analyze({ reanalysis: true, buildOnPrevious: true });
    await nextTick();
    expect(store.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        incidentId: "inc-1",
        origin: { entryKind: "object_verb", objectKind: "incident", container: "rca" },
      }),
    );
    expect(store.state.sessions.rca1.rcaRun).toEqual({ reanalysis: true, buildOnPrevious: true });
    expect(store.send).toHaveBeenCalledWith("rca1", { mode: "rca", ephemeral: true });
    expect(analysis.running.value).toBe(true);
    expect(analysis.answer.value?.content).toBe("## Root");
    end({ state: "done", saved: "not_saved" });
    expect((await run)?.state).toBe("done");
  });

  const refused = (serverMessage?: string) =>
    ({
      state: "failed",
      error: {
        code: "unknown",
        phase: "pre_admission",
        retryable: false,
        action: "none",
        httpStatus: 400,
        ...(serverMessage && { serverMessage }),
      },
    }) as TurnTerminal;

  it("reads only the route's not-enabled refusal as analysis off for the org, for the session", async () => {
    const first = setup();
    const run = first.analysis.analyze({ reanalysis: false, buildOnPrevious: false });
    await nextTick();
    first.end(refused("RCA is not enabled"));
    await run;
    expect(first.analysis.gate.value).toEqual({ state: "rca_off" });
    expect(setup().analysis.gate.value).toEqual({ state: "rca_off" });
    expect(setup("available", "other").analysis.gate.value).toBeNull();
  });

  it("gives a run in progress and a priority turned off their own states, leaving the org on", async () => {
    const first = setup();
    let run = first.analysis.analyze({ reanalysis: false, buildOnPrevious: false });
    await nextTick();
    first.end(refused("Analysis already in progress"));
    await run;
    expect(first.analysis.refusal.value).toBe("running_elsewhere");
    expect(first.analysis.gate.value).toBeNull();
    run = first.analysis.analyze({ reanalysis: false, buildOnPrevious: false });
    expect(first.analysis.refusal.value).toBeNull();
    await nextTick();
    first.end(refused("AI SRE is turned off for this incident's priority"));
    await run;
    expect(first.analysis.refusal.value).toBe("priority_off");
    expect(setup().analysis.gate.value).toBeNull();
  });

  it("does not guess from a 400 the route did not explain", async () => {
    const first = setup();
    const run = first.analysis.analyze({ reanalysis: false, buildOnPrevious: false });
    await nextTick();
    first.end(refused());
    await run;
    expect(first.analysis.gate.value).toBeNull();
    expect(first.analysis.refusal.value).toBeNull();
  });

  it("drops the session once a run settles after every panel left", async () => {
    const first = setup();
    const run = first.analysis.analyze({ reanalysis: false, buildOnPrevious: false });
    await nextTick();
    first.scope.stop();
    expect(first.store.dropSession).not.toHaveBeenCalled();
    first.end({ state: "done", steps: 1 } as TurnTerminal);
    await run;
    await nextTick();
    expect(first.store.dropSession).toHaveBeenCalledWith("rca1", "cleared");
  });

  it("drops a settled session as soon as its panel goes", async () => {
    const first = setup();
    const run = first.analysis.analyze({ reanalysis: false, buildOnPrevious: false });
    await nextTick();
    first.end({ state: "done", steps: 1 } as TurnTerminal);
    await run;
    first.scope.stop();
    expect(first.store.dropSession).toHaveBeenCalledWith("rca1", "cleared");
  });

  it("stops through the store and keeps the partial answer", async () => {
    const { store, analysis } = setup();
    void analysis.analyze({ reanalysis: false, buildOnPrevious: false });
    await nextTick();
    await analysis.stop();
    expect(store.stop).toHaveBeenCalledWith("rca1");
    expect(analysis.answer.value?.content).toBe("## Root");
  });

  it("leaves a running analysis alive when the tab goes, and the next mount picks it up", async () => {
    const first = setup();
    void first.analysis.analyze({ reanalysis: false, buildOnPrevious: false });
    await nextTick();
    first.scope.stop();
    expect(first.store.dropSession).not.toHaveBeenCalled();
    const scope = effectScope();
    const again = scope.run(() =>
      useIncidentAnalysis(() => "inc-1", {
        store: first.store as any,
        capability: computed(() => ({ gate: "available" as GateCode, rcaEnabled: false })),
        org: () => "default",
      }),
    )!;
    expect(again.session.value?.sid).toBe("rca1");
    expect(again.running.value).toBe(true);
  });
});
