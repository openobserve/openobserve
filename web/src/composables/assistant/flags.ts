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

declare global {
  interface Window {
    __O2_ASSISTANT_V2__?: boolean;
  }
}

/** Which input decided the flag for this page load. */
export type AssistantV2Source = "harness" | "local" | "build";

interface ResolvedFlag {
  on: boolean;
  source: AssistantV2Source;
}

/** The per-browser opt-in; "1" turns the revamp on for this browser only. */
export const ASSISTANT_V2_STORAGE_KEY = "o2.assistant.v2";

// A mount point reads the flag once in setup; a mid-session flip would split the page between two runtimes.
let resolved: ResolvedFlag | null = null;

/** True when the revamped assistant renders; false keeps every legacy surface untouched. */
export function isAssistantV2(): boolean {
  return resolveFlag().on;
}

export function assistantV2Source(): AssistantV2Source {
  return resolveFlag().source;
}

/** Drops the per-load cache so a spec can resolve the flag again; never called by app code. */
export function resetAssistantV2ForTests(): void {
  resolved = null;
}

function resolveFlag(): ResolvedFlag {
  resolved ??= readFlag();
  return resolved;
}

function readFlag(): ResolvedFlag {
  const harness = typeof window === "undefined" ? undefined : window.__O2_ASSISTANT_V2__;
  if (typeof harness === "boolean") return { on: harness, source: "harness" };
  if (readLocalOptIn()) return { on: true, source: "local" };
  return { on: import.meta.env.VITE_ASSISTANT_V2 === "true", source: "build" };
}

function readLocalOptIn(): boolean {
  try {
    return localStorage.getItem(ASSISTANT_V2_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
