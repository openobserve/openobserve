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

import { effectScope, onScopeDispose, watch } from "vue";
import { useRoute, useRouter, type RouteLocationNormalizedLoaded, type Router } from "vue-router";

import { fullThreadLocation, threadParam } from "@/composables/assistant/pure";

/** The part of a session that says whether the history holds it. */
export interface ThreadUrlSession {
  record: { serverBacked?: boolean };
  turn: { state: string; saved?: string };
}

/** The slice of the assistant store the thread URL follows. */
export interface ThreadUrlStore {
  state: { shell: { activeSid: string | null }; sessions: Record<string, ThreadUrlSession> };
}

/** Only a chat the history can read back belongs in the URL; a reload of any other id would 404. */
export function isSavedSession(session: ThreadUrlSession | undefined): boolean {
  if (!session) return false;
  if (session.record.serverBacked) return true;
  return (
    session.turn.state === "done" && !!session.turn.saved && session.turn.saved !== "not_saved"
  );
}

/** Keeps `?thread=` naming the chat on screen: the saved active chat fills an empty value, a deleted one clears it. */
export function useThreadUrl(
  store: ThreadUrlStore,
  route: RouteLocationNormalizedLoaded,
  router: Router,
): void {
  const thread = () => (route.name === "home" ? threadParam(route.query) : null);
  const replace = (sid: string | null) =>
    void router.replace(fullThreadLocation(sid, route.query)).catch(() => undefined);

  watch(
    () => {
      const active = store.state.shell.activeSid;
      return thread() === "" && active && isSavedSession(store.state.sessions[active])
        ? active
        : null;
    },
    (sid) => {
      if (sid) replace(sid);
    },
    { immediate: true },
  );

  watch(
    () => {
      const sid = thread();
      return sid ? ([sid, !!store.state.sessions[sid]] as const) : null;
    },
    (now, before) => {
      if (now && before && now[0] === before[0] && before[1] && !now[1]) replace(null);
    },
  );
}

/** Home's wiring: follows the store once the lazily loaded assistant chunk arrives. */
export function useThreadUrlSync(assistant: Promise<{ assistantStore: ThreadUrlStore }>): void {
  const route = useRoute();
  const router = useRouter();
  const scope = effectScope();
  onScopeDispose(() => scope.stop());
  void assistant.then(
    ({ assistantStore }) => {
      if (scope.active) scope.run(() => useThreadUrl(assistantStore, route, router));
    },
    () => undefined,
  );
}
