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

import { shallowRef, type ShallowRef } from "vue";

import { useAssistantStore } from "@/composables/assistant";

/** The RCA run the side panel follows in place of its chat. */
export interface RcaFollowTarget {
  org: string;
  incidentId: string;
  runId: string;
}

// One panel per tab, so one followed run; the chat underneath stays mounted and comes back on close.
const followed = shallowRef<RcaFollowTarget | null>(null);

/** The run the side panel shows, if any. */
export function followedRcaRun(): Readonly<ShallowRef<RcaFollowTarget | null>> {
  return followed;
}

/** Clears the followed run, so the panel shows its chat again. */
export function stopFollowingRca(): void {
  followed.value = null;
}

/** Follow in thread: the side panel opens on the run instead of starting another one. */
export function useRcaFollow(): {
  follow(target: RcaFollowTarget, invoker?: HTMLElement | null): void;
} {
  const store = useAssistantStore();
  return {
    follow(target, invoker = null) {
      followed.value = { ...target };
      store.open({ kind: "sidebar" }, { focus: "none", invoker });
    },
  };
}
