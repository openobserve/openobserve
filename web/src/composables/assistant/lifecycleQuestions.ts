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
  getCurrentInstance,
  onBeforeUnmount,
  shallowReactive,
  shallowRef,
  type ComputedRef,
} from "vue";
import { onBeforeRouteLeave } from "vue-router";

import { trackAssistant } from "@/services/assistantAnalytics";
import type { I18nText } from "@/types/i18n";

import type { DockHostId } from "./assistantStore.types";

/** A discarded leave guard lets the navigation it was asked for through, and only that one. */
export const GUARD_RELEASE_MS = 2_000;

/** The one question the lifecycle dialogs show; never two at once. `invoker` takes focus back when the menu that asked is gone. */
export type LifecycleQuestion =
  | { kind: "sign_out"; count: number; invoker?: HTMLElement | null }
  | {
      kind: "org_switch";
      count: number;
      waiting: number;
      org: string;
      invoker?: HTMLElement | null;
    }
  | { kind: "leave_guard"; name: I18nText };

export type LifecycleChoice<Q extends LifecycleQuestion["kind"]> = Q extends "sign_out"
  ? "proceed" | "cancel"
  : Q extends "org_switch"
    ? "stop" | "keep" | "cancel"
    : "keep" | "discard";

/** What `AssistantLifecycleDialogs` renders while a question is open. */
export interface OpenQuestion {
  question: LifecycleQuestion;
  answer(choice: string): void;
}

/** A host whose unsaved changes a navigation, an org switch or a sign-out must ask about first. */
export interface LeaveGuard {
  host: DockHostId | "alert" | "settings";
  isDirty(): boolean;
  name(): I18nText;
}

const question = /* @__PURE__ */ shallowRef<OpenQuestion | null>(null);

const guards = /* @__PURE__ */ shallowReactive(new Set<LeaveGuard>());

const released = new Set<LeaveGuard>();

let dialogHosts = 0;

/** The open question, read by the dialogs component. */
export function useLifecycleQuestion(): ComputedRef<OpenQuestion | null> {
  return computed(() => question.value);
}

/** The dialogs component registers while mounted; with none mounted a question takes its safe default. */
export function registerLifecycleDialogs(): () => void {
  dialogHosts += 1;
  return () => {
    dialogHosts = Math.max(0, dialogHosts - 1);
    if (dialogHosts === 0) question.value?.answer("cancel");
  };
}

/** Asks one question; a second while one is open is refused, so the user is never asked two things. */
export function askLifecycle<Q extends LifecycleQuestion>(
  asked: Q,
): Promise<LifecycleChoice<Q["kind"]>> {
  type Choice = LifecycleChoice<Q["kind"]>;
  const fallback = (asked.kind === "leave_guard" ? "discard" : "cancel") as Choice;
  if (dialogHosts === 0) return Promise.resolve(defaultChoice(asked) as Choice);
  if (question.value)
    return Promise.resolve(fallback === "discard" ? ("keep" as Choice) : fallback);
  return new Promise((resolve) => {
    const open: OpenQuestion = {
      question: asked,
      answer(choice) {
        if (question.value !== open) return;
        question.value = null;
        resolve((validChoice(asked, choice) ? choice : fallback) as Choice);
      },
    };
    question.value = open;
  });
}

/** Unsaved-changes guard for a host: route leaves ask first, and so do sign-out and org switch. */
export function useAssistantLeaveGuard(guard: LeaveGuard): void {
  guards.add(guard);
  if (getCurrentInstance()) {
    onBeforeRouteLeave(async () => {
      if (released.delete(guard) || !guard.isDirty()) return true;
      return (await askGuard(guard)) === "discard";
    });
    onBeforeUnmount(() => {
      guards.delete(guard);
      released.delete(guard);
    });
  }
}

/** Asks every dirty guard in turn; false when the user chose to keep editing. */
export async function runLeaveGuards(): Promise<boolean> {
  for (const guard of [...guards]) {
    if (!guard.isDirty()) continue;
    if ((await askGuard(guard)) !== "discard") return false;
    releaseGuard(guard);
  }
  return true;
}

/** Lets the next route leave pass every guard unasked, for a forced sign-out. */
export function releaseLeaveGuards(): void {
  for (const guard of guards) releaseGuard(guard);
}

/** Asks one dirty guard only, for a move inside its own page; true when the user chose to discard. */
export async function askLeaveGuard(guard: LeaveGuard): Promise<boolean> {
  if (!guard.isDirty()) return true;
  return (await askGuard(guard)) === "discard";
}

/** Lets a spec start with no open question or guard; never called by app code. */
export function resetLifecycleForTests(): void {
  question.value?.answer("cancel");
  question.value = null;
  guards.clear();
  released.clear();
  dialogHosts = 0;
}

function releaseGuard(guard: LeaveGuard): void {
  released.add(guard);
  setTimeout(() => released.delete(guard), GUARD_RELEASE_MS);
}

function askGuard(guard: LeaveGuard): Promise<"keep" | "discard"> {
  return askLifecycle({ kind: "leave_guard", name: guard.name() }).then((choice) => {
    trackAssistant("ai_leave_guard", { host: guard.host, choice });
    return choice;
  });
}

function defaultChoice(asked: LifecycleQuestion): string {
  if (asked.kind === "sign_out") return "proceed";
  if (asked.kind === "org_switch") return "keep";
  return "discard";
}

function validChoice(asked: LifecycleQuestion, choice: string): boolean {
  if (asked.kind === "sign_out") return choice === "proceed" || choice === "cancel";
  if (asked.kind === "org_switch") return ["stop", "keep", "cancel"].includes(choice);
  return choice === "keep" || choice === "discard";
}
