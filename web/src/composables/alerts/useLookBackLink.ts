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

import { computed, reactive, ref, watch } from "vue";
import { convertMinutesToCron } from "@/utils/zincutils";

/** Settings that follow Look back until the user sets them, unlinks them or undoes a move. */
export type LinkedField = "frequency" | "silence";

type Trigger = Record<string, any>;

interface LookBackLinkOptions {
  /** The trigger as the form holds it now (a fresh read, not a render snapshot). */
  trigger: () => Trigger;
  /** Reactive read of the period, to notice values written from outside (load, prefill). */
  period: () => unknown;
  minFrequency: () => number;
  emit: (trigger: Trigger) => void;
}

interface Move {
  fields: LinkedField[];
  period: number;
  previous: Partial<Record<LinkedField, unknown>>;
}

const getBrowserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const isBlank = (value: unknown) => value === undefined || value === null || value === "";

export function useLookBackLink(options: LookBackLinkOptions) {
  // Baseline the linked fields are measured against; re-taken whenever the period changes from outside the handler.
  let baselinePeriod = Number(options.period());
  let lastHandledPeriod: unknown;
  const followed = reactive<Record<LinkedField, number | null>>({ frequency: null, silence: null });
  const unlinked = reactive<Record<LinkedField, boolean>>({ frequency: false, silence: false });
  const move = ref<Move | null>(null);

  // Runs after the handler (pre-flush), so a user edit is recognised by lastHandledPeriod and kept as ours.
  watch(options.period, (period) => {
    if (String(period) === String(lastHandledPeriod)) return;
    baselinePeriod = Number(period);
    followed.frequency = null;
    followed.silence = null;
    unlinked.frequency = false;
    unlinked.silence = false;
    move.value = null;
  });

  // A new alert's default frequency is raised to the refresh floor, so that raised value is still linked.
  const followedValue = (field: LinkedField) =>
    followed[field] ??
    (field === "frequency" ? Math.max(baselinePeriod, options.minFrequency()) : baselinePeriod);

  // A baseline taken while the period was unset is not finite and leaves nothing to compare, so the field still follows.
  const follows = (field: LinkedField, value: unknown) => {
    if (unlinked[field]) return false;
    const target = followedValue(field);
    return !Number.isFinite(target) || isBlank(value) || Number(value) === target;
  };

  const isCron = (trigger: Trigger) => trigger?.frequency_type === "cron";

  /** Whether a field still follows Look back; a cron schedule has no Check every to follow. */
  const isLinked = (field: LinkedField) => {
    const trigger = options.trigger() ?? {};
    void options.period();
    if (field === "frequency" && isCron(trigger)) return false;
    return follows(field, trigger[field]);
  };

  const handlePeriodChange = (value: unknown) => {
    const next: Trigger = { ...options.trigger(), period: value };
    lastHandledPeriod = value;
    const period = Number(value);
    const moved: LinkedField[] = [];
    const previous: Move["previous"] = {};
    const follow = (field: LinkedField) => {
      followed[field] = period;
      if (Number(next[field]) === period) return;
      moved.push(field);
      previous[field] = next[field];
      next[field] = period;
    };
    if (period > 0) {
      // A cron schedule the user wrote is what runs the alert, so the period must not replace it.
      if (!isCron(next)) {
        if (period >= options.minFrequency() && follows("frequency", next.frequency))
          follow("frequency");
        next.cron = convertMinutesToCron(period);
      }
      if (!next.timezone) next.timezone = getBrowserTimezone();
      if (follows("silence", next.silence)) follow("silence");
    }
    if (moved.length) move.value = { fields: moved, period, previous };
    options.emit(next);
  };

  /** The last move, while every field it set still holds the value it was given. */
  const lastMove = computed<Move | null>(() => {
    const current = move.value;
    if (!current) return null;
    const trigger = options.trigger() ?? {};
    void options.period();
    const holds =
      Number(trigger.period) === current.period &&
      current.fields.every((field) => Number(trigger[field]) === current.period);
    return holds ? current : null;
  });

  const undo = () => {
    const current = lastMove.value;
    move.value = null;
    if (!current) return;
    const next: Trigger = { ...options.trigger() };
    for (const field of current.fields) {
      next[field] = current.previous[field];
      unlinked[field] = true;
    }
    options.emit(next);
  };

  const unlink = (field: LinkedField) => {
    unlinked[field] = true;
    if (move.value?.fields.includes(field)) move.value = null;
  };

  const relink = (field: LinkedField) => {
    unlinked[field] = false;
    move.value = null;
    const period = Number(options.trigger()?.period);
    if (!(period > 0)) return;
    followed[field] = period;
    if (field === "frequency" && period < options.minFrequency()) return;
    options.emit({ ...options.trigger(), [field]: period });
  };

  return { handlePeriodChange, isLinked, lastMove, undo, unlink, relink };
}
