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

import { computed, ref } from "vue";
import { vi } from "vitest";

import type { AssistantRuns, RunRow } from "@/composables/assistant";

/** A row as the list builds it; specs name only what they test. */
export function runRow(sid: string, over: Partial<RunRow> = {}): RunRow {
  return {
    sid,
    org: "default",
    title: `Chat ${sid}` as RunRow["title"],
    group: "answering",
    status: "working",
    agent: null,
    at: 1_000,
    startedAt: 1_000,
    turnId: `t-${sid}`,
    request: null,
    expiresAt: null,
    extendsLeft: null,
    card: null,
    consent: false,
    otherOrg: false,
    stale: false,
    ...over,
  };
}

/** The runtime's list with writable rows, so a component spec drives it directly. */
export function fakeRuns(initial: RunRow[] = []) {
  const rows = ref<RunRow[]>(initial);
  const decisions = ref<RunRow[]>([]);
  const active = ref(0);
  const requested = ref(false);
  const runs = {
    rows: computed(() => rows.value),
    otherOrg: computed(() => rows.value.filter((row) => row.otherOrg)),
    cap: computed(() => 3),
    active: computed(() => active.value),
    needsCount: computed(() => rows.value.filter((row) => row.group === "needs_you").length),
    decisions: computed(() => decisions.value),
    openRequested: requested,
    requestOpen: vi.fn(async () => void (requested.value = true)),
    takeOpenRequest: vi.fn(() => void (requested.value = false)),
    stop: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    light: () => null,
    dispose: () => undefined,
  } satisfies AssistantRuns;
  return { runs, rows, decisions, active };
}
