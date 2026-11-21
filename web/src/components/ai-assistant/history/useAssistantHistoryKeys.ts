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

import { ref, watch, type Ref } from "vue";

import type { Sid } from "@/composables/assistant";

/** Typed letters within this window extend one type-ahead search. */
export const TYPE_AHEAD_MS = 500;

export interface HistoryKeyRow {
  sid: Sid;
  title: string;
}

/** Roving tabindex and type-ahead for the list with actions; arrows move between row buttons only. */
export function useAssistantHistoryKeys(
  rows: Ref<HistoryKeyRow[]>,
  preferred: Ref<Sid | null>,
  focusRow: (sid: Sid) => void,
) {
  const active = ref<Sid | null>(null);
  let typed = "";
  let typedAt = 0;

  // The tabbable row survives filtering; else the current chat, else the first row.
  watch(
    [rows, preferred],
    () => {
      const sids = rows.value.map((row) => row.sid);
      if (active.value && sids.includes(active.value)) return;
      active.value =
        preferred.value && sids.includes(preferred.value) ? preferred.value : (sids[0] ?? null);
    },
    { immediate: true },
  );

  const move = (sid: Sid | undefined) => {
    if (!sid) return;
    active.value = sid;
    focusRow(sid);
  };

  const onKeydown = (event: KeyboardEvent, from: Sid) => {
    const list = rows.value;
    const index = list.findIndex((row) => row.sid === from);
    if (index < 0) return;
    const key = event.key;
    let target: Sid | undefined;
    if (key === "ArrowDown") target = list[Math.min(index + 1, list.length - 1)]?.sid;
    else if (key === "ArrowUp") target = list[Math.max(index - 1, 0)]?.sid;
    else if (key === "Home") target = list[0]?.sid;
    else if (key === "End") target = list.at(-1)?.sid;
    else if (
      key.length === 1 &&
      /\S/.test(key) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    )
      target = typeAhead(key, index);
    else return;
    event.preventDefault();
    move(target);
  };

  const typeAhead = (key: string, index: number): Sid | undefined => {
    const now = Date.now();
    typed = now - typedAt < TYPE_AHEAD_MS ? typed + key.toLowerCase() : key.toLowerCase();
    typedAt = now;
    const list = rows.value;
    // A repeated single letter cycles; a longer prefix keeps the row it already matches.
    const start = typed.length === 1 ? index + 1 : index;
    for (let step = 0; step < list.length; step += 1) {
      const row = list[(start + step) % list.length]!;
      if (row.title.toLowerCase().startsWith(typed)) return row.sid;
    }
    return undefined;
  };

  return {
    active,
    onKeydown,
    focusFirst: () => move(rows.value[0]?.sid),
    setActive: (sid: Sid) => {
      active.value = sid;
    },
  };
}
