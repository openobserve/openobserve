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

import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";

import type { I18nKey } from "@/types/i18n";

import type { GateCode } from "./assistantStore.types";
import type { TurnLockReason } from "./lifecycle";
import type { AssistantRuntime } from "./runtime";

// Host editors read the runtime through this, so their own chunk never imports it.
const current = /* @__PURE__ */ shallowRef<AssistantRuntime | null>(null);

/** The built runtime, or `null` before the first assistant surface built it. */
export function runtimeHandle(): ShallowRef<AssistantRuntime | null> {
  return current;
}

/** Called by `runtime.ts` when it builds or drops the runtime. */
export function setRuntimeHandle(runtime: AssistantRuntime | null): void {
  current.value = runtime;
}

/** Builds the runtime on demand; the dynamic import keeps it out of the caller's chunk. */
export function ensureRuntime(): Promise<AssistantRuntime> {
  if (current.value) return Promise.resolve(current.value);
  return import("./runtime").then((module) => module.getAssistantRuntime());
}

/** The live gate for a page control outside the assistant; `loading` until the runtime exists. */
export function useAssistantGate(): ComputedRef<GateCode> {
  if (!current.value) void ensureRuntime();
  return computed(() => current.value?.capability.gate.value ?? "loading");
}

/** True once another tab of this browser signed out, until this tab's own user signs in again. */
export function useSignedOutElsewhere(): ComputedRef<boolean> {
  return computed(() => current.value?.lifecycle.signedOutElsewhere.value ?? false);
}

/** True when another account signed in while this tab was signed out; its chats stay locked until a reload. */
export function useOtherAccountSignedIn(): ComputedRef<boolean> {
  return computed(() => current.value?.lifecycle.otherAccountSignedIn.value ?? false);
}

/** This tab's sign-in came back: the lock lifts if the stored login names this tab's user. */
export function markSignedIn(): void {
  current.value?.lifecycle.onSignedIn();
}

/** Stop on a turn another tab's card holds: that tab declines the card before the cancel. */
export function stopElsewhere(sid: string): Promise<void> {
  return current.value?.lifecycle.stopElsewhere(sid) ?? Promise.resolve();
}

/** Why nothing may start a turn in `sid` right now (Send, Continue, Retry, Ask again, Regenerate, Edit), or `null`. */
export function useTurnLock(sid: () => string | null): ComputedRef<TurnLockReason | null> {
  return computed(() => current.value?.lifecycle.turnLock(sid()) ?? null);
}

/** The line every locked control and door shows for a lock reason. */
export function turnLockKey(reason: TurnLockReason): I18nKey {
  if (reason === "account_changed") return "assistant.shell.otherAccount";
  if (reason === "approval_elsewhere") return "assistant.shell.approvalElsewhere";
  return "assistant.shell.signedOutElsewhere";
}
