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

import {
  computed,
  effectScope,
  getCurrentScope,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
} from "vue";

import { raw } from "@/types/i18n";
import type { ChatMessage } from "@/ts/interfaces/chat";

import { lastAnswerOf } from "./answers";
import { isRunning, useAssistantStore, type AssistantStoreInternal } from "./assistantStore";
import type {
  AssistantCapability,
  AssistantError,
  AssistantSession,
  GateReason,
  Sid,
} from "./assistantStore.types";
import type { TurnTerminal } from "./turnStates";
import { useAssistantCapability } from "./useAssistantCapability";

/** Why the analysis cannot run here; decided before the click. */
export type IncidentAnalysisGate =
  | { state: "ai_off"; reason: GateReason }
  | { state: "no_permission"; reason: GateReason }
  | { state: "rca_off" };

/** A refusal for this incident only: a run already going, or analysis off for its priority. */
export type IncidentRefusal = "running_elsewhere" | "priority_off";

export interface IncidentAnalysisRun {
  /** The server re-runs instead of returning the saved report. */
  reanalysis: boolean;
  buildOnPrevious: boolean;
}

export interface IncidentAnalysis {
  gate: ComputedRef<IncidentAnalysisGate | null>;
  session: ComputedRef<AssistantSession | null>;
  running: ComputedRef<boolean>;
  /** The report streamed by the latest run, partial while running or after Stop. */
  answer: ComputedRef<ChatMessage | null>;
  /** The latest click's refusal for this incident; cleared by the next run. */
  refusal: ComputedRef<IncidentRefusal | null>;
  analyze(run: IncidentAnalysisRun): Promise<TurnTerminal | null>;
  /** The refused run ended or was stopped; the refusal no longer holds. */
  dismissRefusal(): void;
  stop(): Promise<void>;
  resolveConsent(accepted: boolean): void;
}

export interface IncidentAnalysisOptions {
  store?: Pick<
    AssistantStoreInternal,
    "state" | "createSession" | "stage" | "send" | "stop" | "dropSession" | "resolveConsent"
  >;
  capability?: ComputedRef<Pick<AssistantCapability, "gate" | "rcaEnabled">>;
  org: () => string;
  /** True when `/config` carries `rca_enabled`; otherwise only the route's refusal tells. */
  rcaFlagKnown?: () => boolean;
}

const AI_OFF_GATES: ReadonlySet<string> = new Set([
  "not_entitled",
  "not_configured",
  "off_for_org",
]);

// The route answers these three refusals with a bare 400; until it sends a code, its fixed text is the only key.
const ROUTE_REFUSALS: readonly [RegExp, "rca_off" | IncidentRefusal][] = [
  [/rca is not enabled/i, "rca_off"],
  [/already in progress/i, "running_elsewhere"],
  [/turned off for this incident's priority/i, "priority_off"],
];

// Learned from the route's "not enabled" refusal; remembered per org for the session.
const rcaOffOrgs = new Set<string>();

// Panels holding each analysis session; a settled session no panel holds is dropped.
const claims = new Map<Sid, number>();

/** Lets specs start from a fresh session cache; never called by app code. */
export function resetIncidentAnalysisForTests(): void {
  rcaOffOrgs.clear();
  claims.clear();
}

/** The typed meaning of the analysis route's refusal; `null` for any other failure. */
export function rcaRefusalOf(error: AssistantError): "rca_off" | IncidentRefusal | null {
  if (error.httpStatus !== 400) return null;
  const text = error.serverMessage ?? "";
  return ROUTE_REFUSALS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** One incident's analysis as an ephemeral assistant session over the incident route. */
export function useIncidentAnalysis(
  incidentId: () => string,
  opts: IncidentAnalysisOptions,
): IncidentAnalysis {
  const store = opts.store ?? useAssistantStore();
  const capability = opts.capability ?? useAssistantCapability();
  const sid = ref<Sid | null>(null);
  const offTick = ref(0);
  const refusal = ref<IncidentRefusal | null>(null);

  const session = computed<AssistantSession | null>(() =>
    sid.value ? (store.state.sessions[sid.value] ?? null) : null,
  );
  const running = computed(() => !!session.value && isRunning(session.value.turn));

  const gate = computed<IncidentAnalysisGate | null>(() => {
    void offTick.value;
    const code = capability.value.gate;
    if (code === "no_permission") return { state: "no_permission", reason: "no_permission" };
    if (AI_OFF_GATES.has(code)) return { state: "ai_off", reason: code as GateReason };
    if (code === "loading") return null;
    if (opts.rcaFlagKnown?.() && !capability.value.rcaEnabled) return { state: "rca_off" };
    return rcaOffOrgs.has(opts.org()) ? { state: "rca_off" } : null;
  });

  const answer = computed<ChatMessage | null>(() => lastAnswerOf(session.value));

  function existingFor(id: string): Sid | null {
    const found = Object.values(store.state.sessions).find(
      (candidate) => candidate.incidentId === id && candidate.origin.container === "rca",
    );
    return found?.sid ?? null;
  }

  function hold(next: Sid | null): void {
    const was = sid.value;
    if (was === next) return;
    if (was) release(was);
    if (next) claims.set(next, (claims.get(next) ?? 0) + 1);
    sid.value = next;
  }

  // A run outlives the tab; once it settles with no panel holding it, its session goes.
  function release(id: Sid): void {
    const left = (claims.get(id) ?? 1) - 1;
    if (left > 0) {
      claims.set(id, left);
      return;
    }
    claims.delete(id);
    const current = store.state.sessions[id];
    if (!current) return;
    if (!isRunning(current.turn)) {
      store.dropSession(id, "cleared");
      return;
    }
    const scope = effectScope(true);
    scope.run(() =>
      watch(
        () => {
          const turn = store.state.sessions[id]?.turn;
          return !!turn && isRunning(turn);
        },
        (still) => {
          if (still) return;
          scope.stop();
          if (!claims.has(id) && store.state.sessions[id]) store.dropSession(id, "cleared");
        },
      ),
    );
  }

  hold(existingFor(incidentId()));

  const ensureSession = (): Sid => {
    const id = incidentId();
    const current = sid.value ? store.state.sessions[sid.value] : undefined;
    if (current && current.incidentId === id) return current.sid;
    const kept = existingFor(id);
    if (kept) {
      hold(kept);
      return kept;
    }
    hold(
      store.createSession({
        origin: { entryKind: "object_verb", objectKind: "incident", container: "rca" },
        title: raw(`Incident · ${id}`),
        ephemeral: true,
        incidentId: id,
      }),
    );
    return sid.value!;
  };

  const analyze = async (run: IncidentAnalysisRun): Promise<TurnTerminal | null> => {
    if (gate.value || running.value || !incidentId()) return null;
    refusal.value = null;
    const id = ensureSession();
    const target = store.state.sessions[id];
    if (target)
      target.rcaRun = { reanalysis: run.reanalysis, buildOnPrevious: run.buildOnPrevious };
    // Model input, not screen copy: the incident route ignores the text and reads the incident itself.
    store.stage(id, { text: raw("Analyze incident"), mode: "replace" });
    const terminal = await store.send(id, { mode: "rca", ephemeral: true });
    const refused =
      terminal.state === "failed" || terminal.state === "refused"
        ? rcaRefusalOf(terminal.error)
        : null;
    if (refused === "rca_off") {
      rcaOffOrgs.add(opts.org());
      offTick.value += 1;
    } else if (refused) refusal.value = refused;
    return terminal;
  };

  const stop = async () => {
    if (sid.value && running.value) await store.stop(sid.value);
  };

  const resolveConsent = (accepted: boolean) => {
    if (sid.value) void store.resolveConsent(sid.value, accepted, accepted);
  };

  // The drawer may show another incident in the same tab; its analysis is a different session.
  watch(incidentId, (id) => {
    refusal.value = null;
    hold(existingFor(id));
  });

  if (getCurrentScope()) onScopeDispose(() => hold(null));

  return {
    gate,
    session,
    running,
    answer,
    refusal: computed(() => refusal.value),
    analyze,
    dismissRefusal: () => {
      refusal.value = null;
    },
    stop,
    resolveConsent,
  };
}
